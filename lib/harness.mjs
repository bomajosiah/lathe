// Isolation harness: run the project's own Vite (its config, plugins, CSS,
// aliases) plus one injected plugin that renders a single component on its own.
// Nothing is installed in or written to the project outside .lathe/.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { workDir, WORK_DIRS } from "./workdir.mjs";
import { loadTagger } from "./tagger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ...WORK_DIRS, ".next", "coverage", "out"]);
const J = JSON.stringify;
export const safeId = (id) => id.replace(/[^\w.-]+/g, "_");

function findConfigs(dir, root, depth = 0, out = []) {
  if (depth > 4) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findConfigs(p, root, depth + 1, out);
    else if (/^vite\.config\.(ts|js|mjs|mts|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Locate the Vite + React app inside the repo (or use --app). */
export function findApp(root, hint) {
  const configs = findConfigs(root, root).filter((c) => !hint || path.relative(root, path.dirname(c)) === hint.replace(/\/$/, ""));
  const apps = configs.map((configFile) => {
    const dir = path.dirname(configFile);
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch {}
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return { dir, configFile, react: !!deps.react, router: !!deps["react-router-dom"] || !!deps["react-router"] };
  }).filter((a) => a.react);
  if (!apps.length) return { error: hint ? `No Vite + React app at ${hint}` : "No Vite + React app found. Isolation supports Vite apps for now (pass --app <dir> if it's nested)." };
  const count = (d) => { try { return execSync(`find src -name "*.tsx" -o -name "*.jsx" | wc -l`, { cwd: d, shell: "/bin/sh" }).toString().trim() | 0; } catch { return 0; } };
  apps.sort((a, b) => count(b.dir) - count(a.dir));
  const app = apps[0];

  // index.html: what the real app puts in <head> (fonts, theme script) and its entry module.
  const html = fs.existsSync(path.join(app.dir, "index.html")) ? fs.readFileSync(path.join(app.dir, "index.html"), "utf8") : "";
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || "";
  app.headHtml = head.replace(/<script[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, "").replace(/<title>[\s\S]*?<\/title>/i, "<title>lathe harness</title>").replace(/<meta[^>]+charset[^>]*>/i, "");
  app.htmlAttrs = (html.match(/<html([^>]*)>/i) || [])[1] || "";
  app.bodyAttrs = (html.match(/<body([^>]*)>/i) || [])[1] || "";
  const entrySrc = (html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i) || [])[1];
  const entry = entrySrc ? path.join(app.dir, entrySrc.replace(/^\//, "")) : null;

  // Global CSS: side-effect style imports in the entry and the root component.
  const css = [];
  const collect = (file) => {
    if (!file || !fs.existsSync(file)) return;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s+["']([^"']+\.(?:css|scss|sass|less|pcss))["']/gm)) {
      if (m[1].startsWith(".")) css.push(path.relative(root, path.resolve(path.dirname(file), m[1])));
      else if (m[1].startsWith("/")) css.push(path.relative(root, path.join(app.dir, m[1].slice(1))));
      else css.push(`pkg:${m[1]}`); // a package or alias (e.g. @acme/design/styles.css): let Vite resolve it
    }
    const appImport = src.match(/import\s+(?:App|\{\s*App\s*\})\s+from\s+["'](\.[^"']+)["']/);
    if (appImport && !file.endsWith(`App.tsx`)) {
      const p = path.resolve(path.dirname(file), appImport[1]);
      collect([p, `${p}.tsx`, `${p}.jsx`].find((x) => fs.existsSync(x) && fs.statSync(x).isFile()));
    }
  };
  collect(entry);
  app.css = [...new Set(css)];
  app.rel = path.relative(root, app.dir) || ".";
  return app;
}

// Rewrite (prefers-color-scheme: …) in every stylesheet to always/never match, so a
// frame shows the theme it was asked for whatever the viewer's OS is set to. Runs on
// the CSSOM, so it also covers CSS that PostCSS or Tailwind generated, and re-runs
// when Vite hot-swaps a stylesheet.
const pinScheme = (scheme) => `{
  const YES = "(min-width: 0px)", NO = "(max-width: 0px) and (min-width: 1px)";
  const fix = (rules) => { for (const r of rules) {
    if (r.media && /prefers-color-scheme/.test(r.media.mediaText)) {
      try { r.media.mediaText = r.media.mediaText.replace(/\\(\\s*prefers-color-scheme\\s*:\\s*(dark|light)\\s*\\)/g, (_, s) => s === ${J(scheme)} ? YES : NO); } catch {}
    }
    if (r.cssRules) fix(r.cssRules);
  } };
  const pin = () => { for (const sh of document.styleSheets) { try { fix(sh.cssRules); } catch {} } };
  pin();
  new MutationObserver(pin).observe(document.head, { childList: true, subtree: true, characterData: true });
  document.documentElement.style.colorScheme = ${J(scheme)};
}`;

function harnessPlugin({ root, app }) {
  const uiDir = path.join(workDir(root), "ui");
  const uiRel = path.relative(root, uiDir);
  const fixturesDir = path.join(uiDir, "fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });
  // Token overrides: a stylesheet the workbench rewrites; Vite hot-swaps it.
  const overridesCss = path.join(uiDir, "overrides.css");
  if (!fs.existsSync(overridesCss)) fs.writeFileSync(overridesCss, "/* lathe token overrides */\n");
  const tokensJson = path.join(uiDir, "tokens.json");
  // Put a theme on <html> the same way the app does (attribute or class).
  const themeSnippet = (q) => {
    const attr = q.get("themeAttr"), val = q.get("themeVal"), cls = q.get("themeCls");
    const scheme = q.get("scheme") === "dark" ? "dark" : "light";
    return `{ const h = document.documentElement; ${attr ? `h.setAttribute(${J(attr)}, ${J(val || "")});` : ""} ${cls ? `h.classList.add(${J(cls)});` : ""} ${q.get("theme") === "default" ? `["data-theme","data-mode","data-color-scheme"].forEach((a) => h.removeAttribute(a)); h.classList.remove("dark","light");` : ""} }
${pinScheme(scheme)}`;
  };
  const errorsFile = path.join(uiDir, "harness-errors.json");

  const entryCode = (q) => {
    const file = q.get("file") || "", name = q.get("name") || "default", side = q.get("side") === "base" ? "base" : "work";
    const id = q.get("id") || `${file}#${name}`, variant = q.get("variant") || "";
    const base = side === "base" ? path.join(uiDir, "base") : root;
    const comp = path.join(base, file);
    const fs_ = (p) => `/@fs${p}`;
    const css = app.css.map((c) => (c.startsWith("pkg:") ? c : path.join(base, c))).filter((p) => p.startsWith("pkg:") || fs.existsSync(p));
    const fx = ["tsx", "jsx", "ts", "js", "json"].map((e) => path.join(fixturesDir, `${safeId(id)}.${e}`)).find((p) => fs.existsSync(p));
    const wrapper = ["tsx", "jsx"].map((e) => path.join(uiDir, `wrapper.${e}`)).find((p) => fs.existsSync(p));
    // Storybook stories, when the inventory linked some to this component: they replace fixtures.
    let inv = null;
    try { inv = JSON.parse(fs.readFileSync(path.join(uiDir, "inventory.json"), "utf8")); } catch {}
    const linked = inv?.parts?.find((p) => p.id === id)?.stories || [];
    const storyFiles = [...new Set(linked.map((x) => x.file))].filter((f) => fs.existsSync(path.join(base, f)));
    const preview = inv?.storybook?.preview && fs.existsSync(path.join(base, inv.storybook.preview)) ? path.join(base, inv.storybook.preview) : null;
    const order = linked.map((x) => `${x.file}#${x.export}`);
    // Prop values picked in the inspector: a preview on top of the story or fixture, both sides.
    let live = {};
    try { const a = JSON.parse(q.get("args") || "{}"); if (a && typeof a === "object" && !Array.isArray(a)) live = a; } catch {}
    return `
import React from "react";
import { createRoot } from "react-dom/client";
${css.map((c) => `import ${J(c.startsWith("pkg:") ? c.slice(4) : fs_(c))};`).join("\n")}
${side === "work" ? `import ${J(fs_(overridesCss))};` : ""}
${themeSnippet(q)}
${app.router ? `import { MemoryRouter, Routes, Route } from "react-router-dom";` : ""}
${wrapper ? `import Wrapper from ${J(fs_(wrapper))};` : "const Wrapper = null;"}
${fx && !storyFiles.length ? `import * as fxm from ${J(fs_(fx))};\nconst fx = fxm.default ?? fxm;` : "const fx = null;"}
${preview && storyFiles.length ? `import * as previewMod from ${J(fs_(preview))};` : "const previewMod = null;"}
${storyFiles.map((f, i) => `import * as story${i} from ${J(fs_(path.join(base, f)))};`).join("\n")}
const storyMods = [${storyFiles.map((f, i) => `[${J(f)}, story${i}]`).join(", ")}];
const meta = ${J({ id, side, variant, name, fixture: `${uiRel}/fixtures/${safeId(id)}.json`, wrapper: `${uiRel}/wrapper.tsx`, stories: storyFiles })};
const report = (kind, e) => {
  const message = String((e && (e.message || e)) || e);
  if (kind === "error") window.__latheError = { error: message };
  try { parent.postMessage({ type: "lathe:" + kind, id: meta.id, side: meta.side, message }, "*"); } catch {}
  fetch("/__lathe/report", { method: "POST", body: JSON.stringify({ ...meta, kind, message, stack: String((e && e.stack) || ""), at: new Date().toISOString() }) }).catch(() => {});
};
// Workbench shortcuts keep working after a click inside the frame.
const KEYS = /^( |Arrow(Left|Right|Up|Down)|[0-9]|s|S|r|R|l|L|t|T|i|I|\\/|Escape)$/;
addEventListener("keydown", (e) => {
  const a = document.activeElement;
  const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  const meta = (e.metaKey || e.ctrlKey) && (e.code === "Backslash" || e.key === "|");
  if (typing && !meta) return;
  if (!meta && !KEYS.test(e.key)) return;
  if (!meta && true && a && a !== document.body && /^(BUTTON|A|SUMMARY)$/.test(a.tagName) && e.key === " ") return;
  e.preventDefault();
  parent.postMessage({ type: "lathe:key", key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, "*");
});
addEventListener("error", (e) => report("error", e.error || e.message));
addEventListener("unhandledrejection", (e) => report("error", e.reason));
const noop = () => {};
const revive = (v) => v === "$fn" ? noop : Array.isArray(v) ? v.map(revive)
  : v && typeof v === "object" && !React.isValidElement(v) && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : v;
// Stories: every CSF export of the linked files, in source order, keyed by export name.
const ORDER = ${J(order)};
const stories = {};
for (const [file, mod] of storyMods) {
  const m = mod.default || {};
  const keep = (k) => (!m.includeStories || [].concat(m.includeStories).some((r) => r instanceof RegExp ? r.test(k) : r === k))
    && !(m.excludeStories && [].concat(m.excludeStories).some((r) => r instanceof RegExp ? r.test(k) : r === k));
  const keys = Object.keys(mod).filter((k) => k !== "default" && k !== "__namedExportsOrder" && /^[A-Z]/.test(k) && keep(k))
    .sort((a, b) => ((ORDER.indexOf(file + "#" + a) + 1) || 1e9) - ((ORDER.indexOf(file + "#" + b) + 1) || 1e9));
  for (const k of keys) stories[k in stories ? file.split("/").pop().replace(/\.stories\.\w+$/, "") + ":" + k : k] = [m, mod[k], k];
}
const fromStories = Object.keys(stories).length > 0;
const variants = fromStories ? stories : (fx && (fx.variants || fx)) || { default: {} };
const names = Object.keys(variants);
const vname = names.includes(meta.variant) ? meta.variant : names[0];
const { $route, $path, $width, ...raw } = fromStories ? {} : variants[vname] || {};
const LIVE = ${J(live)};
const props = { ...revive(raw), ...LIVE };
// CSF, composed the way Storybook does it: project → component → story for args and
// parameters; decorators wrap story-first; the render falls back to <component {...args} />.
const P = previewMod ? { ...(previewMod.default || {}), ...previewMod } : {};
function composeStory([m, st, exportName], Component) {
  const s = typeof st === "function" ? { render: st, args: st.args, decorators: st.decorators, parameters: st.parameters, name: st.storyName } : st || {};
  const args = { ...(P.args || {}), ...(m.args || {}), ...(s.args || {}), ...LIVE };
  const parameters = { ...(P.parameters || {}), ...(m.parameters || {}), ...(s.parameters || {}) };
  const render = s.render || m.render || P.render || ((a) => React.createElement(m.component || Component, a));
  const decorators = [...[].concat(s.decorators || []), ...[].concat(m.decorators || []), ...[].concat(P.decorators || [])];
  const globals = { ...(P.initialGlobals || P.globals || {}) };
  const ctx = { args, initialArgs: args, argTypes: { ...(m.argTypes || {}), ...(s.argTypes || {}) }, parameters, globals,
    id: meta.id, name: s.name || exportName, story: s.name || exportName, title: m.title || "", kind: m.title || "", component: m.component || Component,
    viewMode: "story", loaded: {}, tags: [...(m.tags || []), ...(s.tags || [])], abortSignal: new AbortController().signal,
    canvasElement: document.getElementById("lathe-root"), hooks: {}, step: async (_, fn) => fn() };
  let fn = (c) => render(c.args, c);
  for (const d of decorators) {
    const inner = fn;
    fn = (c) => {
      const Story = (update) => inner(update && typeof update === "object" && !update.$$typeof && update.args ? { ...c, args: { ...c.args, ...update.args } } : c);
      return d(Story, c);
    };
  }
  function StoryRoot() { return fn(ctx); }
  return { el: React.createElement(StoryRoot), layout: parameters.layout };
}
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(e) { report("error", e); }
  render() {
    if (!this.state.error) return this.props.children;
    return React.createElement("pre", { style: { margin: 0, padding: 20, font: "12px/1.6 ui-monospace, monospace", color: "#f06262", whiteSpace: "pre-wrap", background: "#121314", minHeight: "100vh" } },
      "Render failed: " + (this.state.error.message || this.state.error) + (fromStories ? "\\n\\nStory: " + vname + " in " + meta.stories.join(", ") + "\\nProviders/mocks Storybook gets from elsewhere go in " + meta.wrapper + "." : "\\n\\nGive it props in " + meta.fixture + "\\nor providers/mocks in " + meta.wrapper + "."));
  }
}
// Inspect: hover outlines tagged elements, a click picks one and reports its source,
// the component it's written in, and the tokens its CSS uses (resolved in this theme).
const INS = { on: false, sel: null };
const mkBox = (color) => {
  const b = document.createElement("div");
  b.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:1.5px solid " + color + ";border-radius:2px;display:none;box-sizing:border-box";
  const l = document.createElement("span");
  l.style.cssText = "position:absolute;left:-1.5px;bottom:100%;background:" + color + ";color:#fff;font:500 10.5px/1.6 ui-monospace,Menlo,monospace;padding:0 5px;border-radius:2px 2px 0 0;white-space:nowrap";
  b.append(l); document.documentElement.append(b); return b;
};
const hov = mkBox("#4f8cff"), pick = mkBox("#e5489b");
const place = (b, el) => {
  if (!el || !el.isConnected) { b.style.display = "none"; return; }
  const r = el.getBoundingClientRect();
  Object.assign(b.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  b.firstChild.textContent = (el.dataset.latheIn ? el.dataset.latheIn + " · " : "") + el.tagName.toLowerCase();
};
const tagged = (e) => e.target && e.target.closest ? e.target.closest("[data-lathe-src]") : null;
const describe = (el) => {
  const cs = getComputedStyle(el), uses = [], seen = new Set();
  // Read declarations from cssText: longhands of a shorthand that uses var() read back empty.
  const take = (style, selector) => {
    for (const decl of (style.cssText || "").split(/;(?![^(]*\\))/)) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim(), v = decl.slice(i + 1).replace(/!important/, "").trim();
      if (!prop || prop.startsWith("--")) continue;
      const toks = [...new Set([...v.matchAll(/var\\(\\s*(--[\\w-]+)/g)].map((x) => x[1]))];
      if (!toks.length || seen.has(prop + "|" + v)) continue;
      seen.add(prop + "|" + v);
      uses.push({ prop, value: v.trim(), tokens: toks, selector: selector.slice(0, 90) });
    }
  };
  const walk = (rules) => { for (const r of rules) {
    if (!r.selectorText) { if (r.media && !matchMedia(r.media.mediaText).matches) continue; if (r.cssRules) walk(r.cssRules); continue; }
    let m = false; try { m = el.matches(r.selectorText); } catch {}
    if (m && r.style) take(r.style, r.selectorText);
  } };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch {} }
  take(el.style, "style=…");
  const resolved = {};
  for (const u of uses) for (const t of u.tokens) resolved[t] = cs.getPropertyValue(t).trim();
  const m = (el.dataset.latheSrc || "").match(/^(.*):(\\d+):(\\d+)$/);
  return { file: m ? m[1] : el.dataset.latheSrc, line: m ? +m[2] : 0, col: m ? +m[3] : 0, owner: el.dataset.latheIn || null,
    tag: el.tagName.toLowerCase(), classes: [...el.classList].slice(0, 12), text: (el.textContent || "").trim().slice(0, 60), uses: uses.slice(0, 40), resolved };
};
addEventListener("mousemove", (e) => { if (INS.on) place(hov, tagged(e)); }, true);
for (const t of ["pointerdown", "mousedown", "mouseup", "pointerup"]) addEventListener(t, (e) => { if (INS.on && tagged(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
addEventListener("click", (e) => {
  if (!INS.on) return;
  const el = tagged(e);
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  INS.sel = el; place(pick, el);
  parent.postMessage({ type: "lathe:picked", id: meta.id, side: meta.side, el: describe(el) }, "*");
}, true);
const replace = () => { place(pick, INS.sel); };
addEventListener("scroll", replace, true); addEventListener("resize", replace);
addEventListener("message", (e) => {
  if (e.data?.type !== "lathe:inspect") return;
  INS.on = !!e.data.on;
  document.documentElement.style.cursor = INS.on ? "crosshair" : "";
  if (!INS.on) place(hov, null);
  if (e.data.clear || !INS.on) { INS.sel = null; place(pick, null); }
});
// Smells overlay: outline the tagged element each candidate most likely sits in
// (same file, nearest element at or above the line, narrowed by the finding's text).
const SM = { list: [], boxes: [] };
const drawSmells = () => {
  for (const b of SM.boxes) b.remove();
  SM.boxes = [];
  if (!SM.list.length) return;
  const els = [...document.querySelectorAll("[data-lathe-src]")].map((el) => { const m = el.dataset.latheSrc.match(/^(.*):(\\d+):\\d+$/); return m && { el, file: m[1], line: +m[2] }; }).filter(Boolean);
  const words = (t) => String(t || "").replace(/^[^:]{0,60}:\\s*/, "").split(/[^\\w']+/).filter((w) => w.length > 3).slice(0, 6);
  for (const f of SM.list) {
    const same = els.filter((x) => x.file === f.file && x.line <= f.line);
    if (!same.length) continue;
    const top = Math.max(...same.map((x) => x.line));
    let hits = same.filter((x) => x.line === top);
    const w = words(f.text), byText = hits.filter((x) => w.some((k) => x.el.textContent.includes(k)));
    if (byText.length) hits = byText;
    for (const h of hits.slice(0, 6)) {
      const r = h.el.getBoundingClientRect();
      if (!r.width) continue;
      const b = document.createElement("div");
      b.style.cssText = "position:absolute;pointer-events:none;z-index:2147483646;outline:1.5px dashed #f59e0b;outline-offset:2px;left:" + (r.left + scrollX) + "px;top:" + (r.top + scrollY) + "px;width:" + r.width + "px;height:" + r.height + "px";
      const l = document.createElement("span");
      l.textContent = f.rule;
      l.style.cssText = "position:absolute;right:-4px;top:-18px;background:#f59e0b;color:#111;font:600 10px/14px ui-monospace,Menlo,monospace;padding:0 4px;border-radius:3px";
      b.append(l); document.documentElement.append(b); SM.boxes.push(b);
    }
  }
};
addEventListener("message", (e) => {
  if (e.data?.type !== "lathe:smells") return;
  SM.list = Array.isArray(e.data.list) ? e.data.list : [];
  drawSmells(); setTimeout(drawSmells, 400); setTimeout(drawSmells, 1500);
});
addEventListener("resize", () => SM.list.length && drawSmells());
(async () => {
  let Mod;
  try { Mod = await import(${J(fs_(comp))}); }
  catch (e) { report("error", e); document.getElementById("lathe-root").textContent = "Import failed: " + e.message; return; }
  const C = meta.name === "default" ? Mod.default : Mod[meta.name];
  if (!C) { report("error", "Export " + meta.name + " not found in ${file}"); return; }
  let el;
  if (fromStories) {
    const composed = composeStory(variants[vname], C);
    el = composed.el;
    const root = document.getElementById("lathe-root");
    if (composed.layout === "centered") Object.assign(root.style, { display: "flex", alignItems: "center", justifyContent: "center" });
    else if (composed.layout === "padded" && !parseInt(root.style.padding || getComputedStyle(root).paddingTop)) root.style.padding = "16px";
  } else el = React.createElement(C, props);
  if (Wrapper) el = React.createElement(Wrapper, { variant: vname, side: meta.side }, el);
  ${app.router ? `el = React.createElement(MemoryRouter, { initialEntries: [$route || "/"] }, $path ? React.createElement(Routes, null, React.createElement(Route, { path: $path, element: el })) : el);` : ""}
  createRoot(document.getElementById("lathe-root")).render(React.createElement(Boundary, null, el));
  const ready = { type: "lathe:ready", id: meta.id, side: meta.side, variants: names, variant: vname, source: fromStories ? "stories" : fx ? "fixture" : "none" };
  // Headless screenshots poll this; frames hear the message.
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__latheReady = ready; }));
  parent.postMessage(ready, "*");
})();
`;
  };

  return {
    name: "lathe-harness",
    configureServer(server) {
      server.watcher.add(uiDir);
      const reload = (f) => { if (f.startsWith(fixturesDir) || /wrapper\.[jt]sx$/.test(f)) server.ws.send({ type: "full-reload" }); };
      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
      // A re-scan can link new stories: drop the cached entry modules so they regenerate.
      server.watcher.on("change", (f) => {
        if (f !== path.join(uiDir, "inventory.json")) return;
        for (const m of server.moduleGraph.idToModuleMap.values()) if (m.id?.startsWith("\0lathe-harness-entry")) server.moduleGraph.invalidateModule(m);
        server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/__lathe/harness.html") {
          const q = new URLSearchParams(u.search);
          const page = `<!doctype html><html${app.htmlAttrs}><head><meta charset="utf-8" />${app.headHtml}<style>html,body{margin:0}#lathe-root{min-height:100vh;box-sizing:border-box;padding:${Math.min(96, +q.get("pad") || 0)}px}</style></head><body${app.bodyAttrs}><div id="lathe-root"></div><script type="module" src="/@lathe-harness/entry.js?${q}"></script></body></html>`;
          res.setHeader("content-type", "text/html");
          res.end(await server.transformIndexHtml(req.url, page));
          return;
        }
        if (u.pathname === "/__lathe/specimen.html") {
          const q = new URLSearchParams(u.search);
          const page = `<!doctype html><html${app.htmlAttrs}><head><meta charset="utf-8" />${app.headHtml}</head><body${app.bodyAttrs}><div id="lathe-spec"></div><script type="module" src="/@lathe-harness/specimen.js?${q}"></script></body></html>`;
          res.setHeader("content-type", "text/html");
          res.end(await server.transformIndexHtml(req.url, page));
          return;
        }
        if (u.pathname === "/__lathe/report" && req.method === "POST") {
          let s = ""; req.on("data", (c) => (s += c));
          req.on("end", () => {
            let list = [];
            try { list = JSON.parse(fs.readFileSync(errorsFile, "utf8")); } catch {}
            try { list.unshift(JSON.parse(s)); } catch {}
            fs.writeFileSync(errorsFile, JSON.stringify(list.slice(0, 30), null, 2) + "\n");
            res.end("{}");
          });
          return;
        }
        next();
      });
    },
    resolveId(id) {
      if (id.startsWith("/@lathe-harness/entry.js")) return "\0lathe-harness-entry?" + (id.split("?")[1] || "");
      if (id.startsWith("/@lathe-harness/specimen.js")) return "\0lathe-harness-specimen?" + (id.split("?")[1] || "");
    },
    load(id) {
      if (id.startsWith("\0lathe-harness-entry")) return entryCode(new URLSearchParams(id.split("?")[1] || ""));
      if (id.startsWith("\0lathe-harness-specimen")) {
        const q = new URLSearchParams(id.split("?")[1] || "");
        const css = app.css.map((c) => (c.startsWith("pkg:") ? c : path.join(root, c))).filter((p) => p.startsWith("pkg:") || fs.existsSync(p));
        return `${css.map((c) => `import ${J(c.startsWith("pkg:") ? c.slice(4) : `/@fs${c}`)};`).join("\n")}
${q.get("ov") !== "0" ? `import ${J(`/@fs${overridesCss}`)};` : ""}
import inv from ${J(`/@fs${tokensJson}`)};
import { renderSpecimen } from ${J(`/@fs${path.join(HERE, "specimen.mjs")}`)};
${themeSnippet(q)}
renderSpecimen(inv, ${J({ group: q.get("group") || "color", side: q.get("ov") === "0" ? "base" : "work", themed: q.get("themed") === "1" })});`;
      }
    },
  };
}

function findUp(dir, rel, stop) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, rel))) return path.join(d, rel);
    if (d === stop || d === path.dirname(d)) return null;
  }
}

function tagsPlugin(tag, baseDir) {
  return { name: "lathe-source-tags", enforce: "pre", async transform(code, id) { return tag(code, id, baseDir); } };
}

export async function startHarness({ root, app, port = 4748 }) {
  const tag = await loadTagger({ root, appDir: app.dir });
  const vitePkg = findUp(app.dir, "node_modules/vite/package.json", path.dirname(root));
  if (!vitePkg) throw new Error(`Vite isn't installed for ${app.rel}. Install the app's dependencies first.`);
  const pkg = JSON.parse(fs.readFileSync(vitePkg, "utf8"));
  let entry = pkg.exports?.["."];
  entry = typeof entry === "string" ? entry : entry?.import ?? entry?.["module-sync"] ?? entry?.default;
  if (typeof entry === "object") entry = entry.default;
  const vite = await import(pathToFileURL(path.join(path.dirname(vitePkg), entry || "dist/node/index.js")).href);
  const server = await vite.createServer({
    configFile: app.configFile,
    root: app.dir,
    clearScreen: false,
    logLevel: "warn",
    server: { port, strictPort: false, host: "127.0.0.1", open: false, fs: { allow: [root, HERE] } },
    plugins: [...(tag ? [tagsPlugin(tag, path.join(workDir(root), "ui", "base"))] : []), harnessPlugin({ root, app })],
  });
  await server.listen();
  return { server, tags: !!tag, url: (server.resolvedUrls?.local?.[0] || `http://127.0.0.1:${port}/`).replace(/\/$/, "") };
}

/** Snapshot a git ref into .lathe/ui/base so "before" renders side by side with the working tree. */
export function makeBase(root, ref = "HEAD") {
  if (!/^[\w./~^@{}-]+$/.test(ref)) throw new Error("bad ref");
  const dest = path.join(workDir(root), "ui", "base");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execSync(`git archive --format=tar ${ref} | tar -x -C "${dest}"`, { cwd: root, shell: "/bin/sh", stdio: ["ignore", "ignore", "pipe"] });
  // Reuse the working tree's installed dependencies so both sides share one React.
  const link = (dir, depth) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORE.has(e.name) && e.name !== "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name), rel = path.relative(root, p);
      if (e.name === "node_modules") {
        const target = path.join(dest, rel);
        if (fs.existsSync(path.dirname(target)) && !fs.existsSync(target)) fs.symlinkSync(p, target, "dir");
      } else link(p, depth + 1);
    }
  };
  link(root, 0);
  const commit = execSync(`git rev-parse ${ref}`, { cwd: root }).toString().trim();
  const info = { ref, commit, at: new Date().toISOString() };
  fs.writeFileSync(path.join(workDir(root), "ui", "base.json"), JSON.stringify(info, null, 2) + "\n");
  return info;
}

/** Files changed in the working tree since the base snapshot (tracked + untracked). */
export function changedSince(root, commit) {
  if (!commit) return [];
  try {
    const diff = execSync(`git diff --name-only ${commit} --`, { cwd: root }).toString();
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: root }).toString();
    return [...new Set((diff + untracked).split("\n").filter((f) => f && !WORK_DIRS.some((d) => f.startsWith(`${d}/`))))];
  } catch { return []; }
}
