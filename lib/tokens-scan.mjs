// Repo → design-token inventory (.lathe/ui/tokens.json): CSS custom properties
// per theme, what they're for (their comments), where they reach (rules →
// classes → components → pages), and checks: hard-coded values, near
// duplicates, unused tokens, contrast of real colour/background pairs.
import fs from "node:fs";
import path from "node:path";
import { parseColor, toHex, contrast, colorDistance, resolver } from "./tokens-core.mjs";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".output", "coverage", ".lathe", ".ux", "out", ".turbo", ".vercel", ".netlify", ".cache", "vendor"]);
const STYLE = /\.(css|scss|sass|less|pcss)$/;
const CODE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|html)$/;

function walk(dir, root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if ((STYLE.test(e.name) || CODE.test(e.name)) && !/\.(min|d)\.\w+$/.test(e.name)) out.push(path.relative(root, p));
  }
  return out;
}

// ---------- a small CSS reader: rules with selector, media and declarations ----------
export function parseCss(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (idx) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  const rules = [], stack = [];
  let buf = "", start = -1;
  const flush = () => {
    const top = stack[stack.length - 1];
    if (top && !top.at && buf.includes(":")) {
      const k = buf.indexOf(":");
      const prop = buf.slice(0, k).trim(), value = buf.slice(k + 1).trim();
      if (prop && value && /^[\w-]+$/.test(prop)) top.decls.push({ prop, value, line: lineAt(start), idx: start });
    }
    buf = ""; start = -1;
  };
  for (let i = 0; i < text.length;) {
    if (text.startsWith("/*", i)) { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    const ch = text[i];
    if (ch === '"' || ch === "'") { const e = text.indexOf(ch, i + 1); if (start < 0) start = i; buf += text.slice(i, e < 0 ? text.length : e + 1); i = e < 0 ? text.length : e + 1; continue; }
    if (ch === "(") { // keep url(...)/var(...) intact even with ; inside
      let depth = 0, j = i;
      for (; j < text.length; j++) { if (text[j] === "(") depth++; else if (text[j] === ")" && --depth === 0) break; }
      if (start < 0) start = i; buf += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "{") {
      const prelude = buf.trim();
      const at = prelude.startsWith("@");
      stack.push({ prelude, at, media: at && /^@media/.test(prelude) ? prelude : null, decls: [], line: lineAt(start < 0 ? i : start) });
      buf = ""; start = -1; i++; continue;
    }
    if (ch === "}") {
      flush();
      const blk = stack.pop();
      if (blk && !blk.at) {
        const media = [...stack].reverse().find((s) => s.media)?.media || null;
        rules.push({ selector: blk.prelude, media, decls: blk.decls, line: blk.line });
      }
      i++; continue;
    }
    if (ch === ";") { flush(); i++; continue; }
    if (start < 0 && !/\s/.test(ch)) start = i;
    buf += ch; i++;
  }
  return { rules, lineAt };
}

// The comment that explains a declaration: same line, else the comment lines just above.
function commentFor(lines, line) {
  const here = lines[line - 1] || "";
  const same = here.match(/;\s*\/\*\s*([\s\S]*?)\s*\*\//);
  const clean = (s) => s.replace(/@kind\s+\w+/g, "").replace(/^[\s\-=─—*]+|[\s\-=─—*]+$/g, "").trim();
  if (same && clean(same[1])) return clean(same[1]);
  const out = [];
  for (let i = line - 2; i >= 0 && i >= line - 4; i--) {
    const l = lines[i].trim();
    if (!l.startsWith("/*") && !l.endsWith("*/") && !l.startsWith("*")) break;
    out.unshift(l.replace(/^\/\*+|\*+\/$/g, "").replace(/^\*\s?/, ""));
  }
  const c = clean(out.join(" "));
  // Skip section rules and commented-out code.
  return c && !/^-{3,}|^={3,}/.test(c) && !/--[\w-]+\s*:|;\s*$|:\s*[\d#]/.test(c) ? c : "";
}
const kindHint = (lines, line) => (lines[line - 1] || "").match(/@kind\s+(\w+)/)?.[1] || null;

// Which theme a rule defines: default, light, dark, or a named variant.
export function themeOf(selector, media) {
  if (media && /prefers-color-scheme:\s*dark/.test(media)) return { id: "dark", media: "dark" };
  if (media && /prefers-color-scheme:\s*light/.test(media)) return { id: "light", media: "light" };
  if (media) return null;
  const s = selector.trim();
  if (/^(:root|html|:host)$/.test(s)) return { id: "default" };
  let m = s.match(/\[data-([\w-]+)=["']?([\w-]+)["']?\]/);
  if (m) return { id: m[2], attr: `data-${m[1]}`, value: m[2] };
  m = s.match(/^(?::root|html)?\.(dark|light|theme-[\w-]+)$/);
  if (m) return { id: m[1].replace(/^theme-/, ""), cls: m[1] };
  return null;
}

const GROUP_OF = { "font-family": "type", "font-size": "type", "font-weight": "type", "line-height": "type", "letter-spacing": "type", typography: "type", color: "color", space: "space", radius: "radius", shadow: "shadow", motion: "motion", "z-index": "other", breakpoint: "other", other: "other" };
export const GROUPS = [["color", "Color"], ["type", "Type"], ["space", "Space"], ["radius", "Radius"], ["shadow", "Shadow"], ["motion", "Motion"], ["other", "Other"]];

function categorize(name, value, hint, resolvedValue) {
  const n = name.toLowerCase(), v = String(resolvedValue ?? value);
  if (/family|^--font(-[\w]+)?$|^--ff-|^--font-(display|body|mono|sans|serif|heading|ui)/.test(n) && !/size|weight/.test(n)) return "font-family";
  if (/^--fs-|font-size|^--text-(xs|sm|base|md|lg|xl|\d)/.test(n)) return "font-size";
  if (/^--fw-|weight/.test(n)) return "font-weight";
  if (/^--lh-|line-height|leading/.test(n)) return "line-height";
  if (/^--ls-|letter|tracking/.test(n)) return "letter-spacing";
  if (/shadow|elevation|^--ring/.test(n)) return "shadow";
  if (/radius|rounded/.test(n)) return "radius";
  if (/duration|ease|easing|motion|transition|delay|^--dur/.test(n)) return "motion";
  if (/^--z-|z-index|^--layer/.test(n)) return "z-index";
  if (/^--(bp|breakpoint|screen)-/.test(n)) return "breakpoint";
  if (parseColor(v) || hint === "color") return "color";
  if (/^--(space|sp|gap|pad|gutter|s|size|container|measure|inset)-|spacing/.test(n) || /^-?[\d.]+(px|rem|em)$/.test(v) && /space|gap|pad|margin|gutter|size/.test(n)) return "space";
  if (hint === "font") return "typography";
  if (/^-?[\d.]+(px|rem)$/.test(v)) return "space";
  return "other";
}

function classesIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/class(?:Name)?=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]{0,400}?)\}(?=[\s/>]))/g)) {
    const text = m[1] ?? m[2] ?? (m[3].match(/(["'`])((?:(?!\1)[\s\S])*)\1/g) || []).map((q) => q.slice(1, -1)).join(" ");
    for (const c of text.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^[a-zA-Z_][\w-]*$/.test(c)) out.add(c);
  }
  return out;
}

export function scanTokens(root, { inventory } = {}) {
  const files = walk(root, root);
  const text = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));
  const styleFiles = files.filter((f) => STYLE.test(f));
  const parsed = Object.fromEntries(styleFiles.map((f) => [f, parseCss(text[f])]));

  // ---- definitions ----
  const tokens = {}, themes = { default: { id: "default", label: "Default" } }, sources = [], scopedDefs = {};
  for (const f of styleFiles) {
    const lines = text[f].split("\n");
    const gen = text[f].slice(0, 400).match(/generated from\s+([^\s.]+(?:\.[\w]+)?)|do not edit|auto-?generated/i);
    let count = 0;
    for (const r of parsed[f].rules) {
      const th = themeOf(r.selector, r.media);
      if (!th) {
        // A token redefined on a scope that isn't a theme (e.g. [data-tenant] mapping it to a
        // contract variable): remembered so overrides reach inside that scope too.
        for (const d of r.decls) if (d.prop.startsWith("--")) (scopedDefs[d.prop] ||= []).push({ file: f, line: d.line, selector: r.selector, media: r.media });
        continue;
      }
      for (const d of r.decls) {
        if (!d.prop.startsWith("--")) continue;
        count++;
        if (!themes[th.id]) themes[th.id] = { ...th, label: th.id[0].toUpperCase() + th.id.slice(1) };
        const t = (tokens[d.prop] ||= { name: d.prop, values: {}, defs: {}, comment: "", hint: null });
        t.values[th.id] = d.value;
        const def = { file: f, line: d.line, selector: r.media ? `${r.media} { ${r.selector} }` : r.selector, rawSelector: r.selector, media: r.media };
        // A theme can define a token twice (e.g. [data-theme=dark] and a prefers-color-scheme block):
        // the first is the one shown, the rest are kept so overrides and Apply reach every copy.
        if (t.defs[th.id]) (t.defs[th.id].more ||= []).push(def);
        else t.defs[th.id] = def;
        if (!t.comment) t.comment = commentFor(lines, d.line);
        t.hint ||= kindHint(lines, d.line);
      }
    }
    if (count) {
      let source = null;
      if (gen?.[1]) source = path.relative(root, path.resolve(path.dirname(path.join(root, f)), "..", gen[1].replace(/^src\/tokens\//, ""))).replace(/\\/g, "/");
      if (gen?.[1]) { const guess = files.find((x) => x.endsWith(gen[1])) || [...Object.keys(text)].find((x) => x.endsWith(path.basename(gen[1]))); if (guess) source = guess; }
      sources.push({ file: f, tokens: count, generated: !!gen, source });
    }
  }
  const list = Object.values(tokens);
  for (const t of list) if (scopedDefs[t.name]) t.scoped = scopedDefs[t.name];
  const R = resolver(list);
  for (const t of list) {
    t.resolved = Object.fromEntries(Object.keys(themes).map((th) => [th, R.value(t.name, th)]));
    t.category = categorize(t.name, t.values.default ?? Object.values(t.values)[0], t.hint, t.resolved.default);
    t.group = GROUP_OF[t.category] || "other";
    t.refs = [...new Set(Object.values(t.values).flatMap((v) => [...String(v).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])))].filter((n) => tokens[n]);
    t.generated = !!sources.find((s) => s.file === t.defs.default?.file || s.file === Object.values(t.defs)[0]?.file)?.generated;
  }
  const refBy = {};
  for (const t of list) for (const r of t.refs) (refBy[r] ||= []).push(t.name);

  // ---- direct usage: CSS rules and code ----
  const direct = {}; // name -> {uses, files:Set, classes:Set, elements:bool, rules: []}
  const use = (n) => (direct[n] ||= { uses: 0, files: new Set(), classes: new Set(), global: false });
  for (const f of styleFiles) for (const r of parsed[f].rules) {
    if (themeOf(r.selector, r.media)) continue; // token definition blocks
    const classes = [...r.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
    const element = /(^|[\s,>+~])(html|body|h[1-6]|p|a|button|input|select|textarea|ul|ol|li|table|code|pre|\*|::selection|:focus-visible)(?=$|[\s,:.[>+~])/.test(r.selector) && !classes.length;
    for (const d of r.decls) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const u = use(m[1]); u.uses++; u.files.add(f);
      classes.forEach((c) => u.classes.add(c));
      if (element) u.global = true;
    }
  }
  const partsByFile = {};
  for (const p of inventory?.parts || []) (partsByFile[p.file] ||= []).push(p);
  const fileClasses = {};
  for (const f of files.filter((x) => CODE.test(x))) {
    const src = text[f];
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) { const u = use(m[1]); u.uses++; u.files.add(f); }
    if (partsByFile[f]) fileClasses[f] = classesIn(src);
  }

  // ---- reach: through references, to classes → components → pages ----
  const memo = {};
  const reach = (name, seen = new Set()) => {
    if (memo[name]) return memo[name];
    if (seen.has(name)) return { files: new Set(), classes: new Set(), global: false, uses: 0 };
    seen.add(name);
    const d = direct[name] || { uses: 0, files: new Set(), classes: new Set(), global: false };
    const acc = { uses: d.uses, files: new Set(d.files), classes: new Set(d.classes), global: d.global };
    for (const parent of refBy[name] || []) {
      const r = reach(parent, seen);
      r.files.forEach((x) => acc.files.add(x)); r.classes.forEach((x) => acc.classes.add(x));
      acc.global ||= r.global;
    }
    return (memo[name] = acc);
  };
  for (const t of list) {
    const d = direct[t.name];
    const r = reach(t.name);
    const comps = new Set();
    for (const [f, cls] of Object.entries(fileClasses)) if ([...r.classes].some((c) => cls.has(c)) || r.files.has(f)) partsByFile[f].forEach((p) => comps.add(p.id));
    const parts = (inventory?.parts || []).filter((p) => comps.has(p.id));
    t.uses = d?.uses || 0;
    t.usedBy = refBy[t.name] || [];
    t.files = [...(d?.files || [])];
    t.classes = [...r.classes].slice(0, 40);
    t.global = r.global;
    t.components = [...comps];
    t.pages = [...new Set(parts.flatMap((p) => p.pages))];
  }

  // ---- checks ----
  const R0 = (n) => R.value(n, "default");
  const colorIndex = {}, lengthIndex = {};
  for (const t of list) {
    const c = parseColor(R0(t.name));
    if (t.category === "color" && c) (colorIndex[toHex(c)] ||= []).push(t.name);
    const v = String(R0(t.name) || "").trim();
    if (/^-?[\d.]+(px|rem|em)$/.test(v)) (lengthIndex[`${t.category}:${v}`] ||= []).push(t.name);
  }
  const prefer = (names) => names.slice().sort((a, b) => (tokens[a].refs.length - tokens[b].refs.length) || a.length - b.length);
  const drift = [];
  const pushDrift = (file, line, prop, value, kind) => {
    let suggest = null;
    if (kind === "color") { const c = parseColor(value); if (c) suggest = colorIndex[toHex(c)]?.length ? prefer(colorIndex[toHex(c)])[0] : null; }
    else { const cat = kind === "font-size" ? "font-size" : kind === "radius" ? "radius" : "space"; const n = lengthIndex[`${cat}:${value}`]; if (n) suggest = prefer(n)[0]; }
    drift.push({ file, line, prop, value, kind, suggest });
  };
  const COLOR_LIT = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  for (const f of styleFiles) for (const r of parsed[f].rules) {
    if (themeOf(r.selector, r.media)) continue;
    for (const d of r.decls) {
      if (d.prop.startsWith("--")) continue;
      const v = d.value.replace(/var\([^)]*\)/g, "");
      for (const m of v.matchAll(COLOR_LIT)) pushDrift(f, d.line, d.prop, m[0], "color");
      if (/^font-size$/.test(d.prop) && /\d(px|rem)/.test(v)) pushDrift(f, d.line, d.prop, d.value.trim(), "font-size");
      if (/radius/.test(d.prop) && /^\d+(\.\d+)?px$/.test(v.trim()) && v.trim() !== "0px") pushDrift(f, d.line, d.prop, v.trim(), "radius");
      if (/^(margin|padding|gap|row-gap|column-gap)(-\w+)?$/.test(d.prop)) for (const m of v.matchAll(/(?<![\w.-])([1-9]\d*(?:\.\d+)?px)/g)) pushDrift(f, d.line, d.prop, m[1], "space");
    }
  }
  for (const f of files.filter((x) => /\.(tsx|jsx)$/.test(x))) {
    const src = text[f];
    for (const m of src.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      const body = m[1], base = src.slice(0, m.index).split("\n").length;
      for (const c of body.matchAll(COLOR_LIT)) pushDrift(f, base, "style", c[0], "color");
      for (const c of body.matchAll(/fontSize:\s*["'`]?([^,"'`}]+)/g)) if (!/var\(/.test(c[1])) pushDrift(f, base, "fontSize", c[1].trim(), "font-size");
      for (const c of body.matchAll(/(?:margin|padding|gap)\w*:\s*["'`]?(\d+(?:px)?)["'`]?/g)) pushDrift(f, base, "spacing", /px$/.test(c[1]) ? c[1] : `${c[1]}px`, "space");
    }
  }

  const dupes = [];
  for (const [hex, names] of Object.entries(colorIndex)) {
    const literal = names.filter((n) => !/var\(/.test(tokens[n].values.default || ""));
    if (literal.length > 1) dupes.push({ kind: "same", value: hex, names: literal });
  }
  const lit = list.filter((t) => t.category === "color" && !/var\(/.test(t.values.default || "") && parseColor(t.resolved.default));
  for (let i = 0; i < lit.length; i++) for (let j = i + 1; j < lit.length; j++) {
    const a = parseColor(lit[i].resolved.default), b = parseColor(lit[j].resolved.default);
    const d = colorDistance(a, b);
    if (d > 0 && d < 7) dupes.push({ kind: "near", value: `${toHex(a)} ≈ ${toHex(b)}`, names: [lit[i].name, lit[j].name] });
  }
  const unused = list.filter((t) => !t.uses && !t.usedBy.length).map((t) => t.name);

  // Real colour/background pairs from rules (plus the page default).
  const pairs = [];
  for (const f of styleFiles) for (const r of parsed[f].rules) {
    if (themeOf(r.selector, r.media)) continue;
    const fg = r.decls.find((d) => d.prop === "color");
    const bg = r.decls.find((d) => d.prop === "background-color" || (d.prop === "background" && !/url\(|gradient/.test(d.value)));
    if (fg && bg && /var\(/.test(fg.value + bg.value)) pairs.push({ selector: r.selector.slice(0, 80), file: f, line: r.line, fg: fg.value, bg: bg.value });
  }
  const contrastChecks = [];
  for (const p of pairs) for (const th of Object.keys(themes)) {
    const fc = parseColor(R.resolve(p.fg, th)), bc = parseColor(R.resolve(p.bg, th));
    const ratio = contrast(fc, bc);
    if (ratio != null) contrastChecks.push({ ...p, theme: th, ratio, pass: ratio >= 4.5, large: ratio >= 3 });
  }

  return {
    version: 1,
    product: inventory?.product || path.basename(root),
    snapshot: { date: new Date().toISOString().slice(0, 10) },
    sources,
    themes: Object.values(themes),
    tokens: list.map(({ hint, ...t }) => t),
    checks: { drift, dupes, unused, contrast: contrastChecks, pairs },
  };
}

/** overrides {name: {theme: value}} → CSS, using each token's own selector per theme. */
export function overridesCss(inv, overrides) {
  const byName = Object.fromEntries((inv?.tokens || []).map((t) => [t.name, t]));
  const blocks = {};
  for (const [name, per] of Object.entries(overrides || {})) for (const [theme, value] of Object.entries(per)) {
    if (value == null || value === "") continue;
    const def = byName[name]?.defs?.[theme] || byName[name]?.defs?.default;
    const scoped = theme === "default" || !byName[name]?.defs?.[theme] ? (byName[name]?.scoped || []).map((x) => ({ rawSelector: x.selector, media: x.media })) : [];
    for (const d of def ? [def, ...(def.more || []), ...scoped] : [null, ...scoped]) {
      const key = d ? (d.media ? `${d.media}|${d.rawSelector}` : d.rawSelector) : ":root";
      (blocks[key] ||= []).push(`  ${name}: ${value};`);
    }
  }
  return "/* lathe token overrides: preview only, never part of the repo */\n" + Object.entries(blocks).map(([k, decls]) => {
    const [media, sel] = k.includes("|") ? k.split("|") : [null, k];
    const block = `${sel} {\n${decls.join("\n")}\n}`;
    return media ? `${media} {\n${block}\n}` : block;
  }).join("\n") + "\n";
}

/** Write overrides into the token source files. Skips generated files (edit their source instead). */
export function applyOverrides(root, inv, overrides) {
  const byName = Object.fromEntries(inv.tokens.map((t) => [t.name, t]));
  const changed = [], skipped = [];
  const edits = {};
  for (const [name, per] of Object.entries(overrides || {})) for (const [theme, value] of Object.entries(per)) {
    const t = byName[name], def = t?.defs?.[theme];
    if (!def) { skipped.push({ name, theme, reason: `not defined for ${theme}` }); continue; }
    const src = inv.sources.find((s) => s.file === def.file);
    if (src?.generated) { skipped.push({ name, theme, reason: `generated file; edit ${src.source || "its source"} and regenerate` }); continue; }
    for (const d of [def, ...(def.more || [])]) (edits[d.file] ||= []).push({ name, line: d.line, value });
  }
  for (const [file, list] of Object.entries(edits)) {
    const p = path.join(root, file);
    const lines = fs.readFileSync(p, "utf8").split("\n");
    for (const e of list) {
      const i = e.line - 1;
      const re = new RegExp(`(${e.name.replace(/[-]/g, "\\-")}\\s*:\\s*)([^;]+)(;)`);
      if (!re.test(lines[i])) { skipped.push({ name: e.name, reason: `couldn't find it on ${file}:${e.line}` }); continue; }
      lines[i] = lines[i].replace(re, `$1${e.value}$3`);
      changed.push(`${file}:${e.line}`);
    }
    fs.writeFileSync(p, lines.join("\n"));
  }
  return { changed, skipped };
}
