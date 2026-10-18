// Repo → component inventory (.lathe/ui/inventory.json): every React component,
// its props, where it's used, which pages it reaches, likely duplicates and
// design-debt signals. Heuristic, like the IA scan: an agent curates it.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { attachStories } from "./stories.mjs";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".output", "coverage", ".lathe", ".ux", "out", ".turbo", ".vercel", ".netlify", ".cache", "vendor"]);
const SRC = /\.(tsx|jsx)$/;
const CHROME = /^(Header|Footer|Nav|Navbar|NavBar|Sidebar|SideBar|Topbar|TopBar|Layout|Shell|AppShell|Menu)$|(Header|Footer|Nav|Layout)$/;
const AFFIX = /^(Primary|Secondary|Base|Custom|New|Old|Simple|Styled|My|App|Ui|UI)|(V\d|New|Old|2|Styled|Base|Component)$/g;

function walk(dir, root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name) || (e.name.startsWith(".") && e.isDirectory())) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (SRC.test(e.name) && !/\.(test|spec|stories)\.[jt]sx$/.test(e.name)) out.push(path.relative(root, p));
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// Text inside the bracket that opens at `start` (src[start] is the opener).
function balanced(src, start) {
  const open = src[start], close = { "(": ")", "{": "}", "<": ">" }[open];
  let depth = 0;
  for (let i = start; i < src.length && i < start + 4000; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start + 1, i);
  }
  return "";
}

// Split "a, b = 1, ...rest" at top-level commas.
function topSplit(s, sep = ",") {
  const out = []; let depth = 0, cur = "", prev = "";
  for (const ch of s) {
    if ("{([<".includes(ch)) depth++;
    if ("})]".includes(ch) || (ch === ">" && prev !== "=")) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    prev = ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function typeFields(body) {
  return topSplit(body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\n/g, ";"), ";")
    .flatMap((f) => topSplit(f, ","))
    .map((f) => f.match(/^(?:readonly\s+)?["']?([\w$]+)["']?(\?)?\s*:\s*([\s\S]+)$/))
    .filter(Boolean)
    .map((m) => ({ name: m[1], type: m[3].trim().replace(/[;,]+$/, "").replace(/\s+/g, " ").slice(0, 80), optional: !!m[2] }));
}

function propsOf(src, paramsText) {
  const p = paramsText.trim();
  if (!p) return [];
  let names = [], typeText = "";
  if (p.startsWith("{")) {
    const destr = balanced(p, 0);
    names = topSplit(destr).map((x) => x.replace(/^\.\.\./, "…").split(/[:=]/)[0].trim());
    typeText = p.slice(destr.length + 2).replace(/^\s*:\s*/, "");
  } else typeText = p.replace(/^\w+\s*:\s*/, "");
  let fields = [];
  if (typeText.startsWith("{")) fields = typeFields(balanced(typeText, 0));
  else {
    const tn = (typeText.match(/^([A-Z][\w]*)/) || [])[1];
    if (tn) {
      const decl = src.match(new RegExp(`(?:interface\\s+${tn}(?:\\s+extends[^{]+)?\\s*|type\\s+${tn}\\s*=\\s*)\\{`));
      if (decl) fields = typeFields(balanced(src, decl.index + decl[0].length - 1));
    }
  }
  if (!fields.length) return names.filter(Boolean).map((n) => ({ name: n }));
  if (names.length) return names.map((n) => fields.find((f) => f.name === n) || { name: n });
  return fields;
}

function componentsIn(src, file) {
  const found = new Map();
  const add = (name, idx, how) => {
    if (found.has(name)) return;
    const after = src.slice(idx);
    const paren = after.indexOf("(");
    const params = paren >= 0 && paren < 300 ? balanced(after, paren) : "";
    found.set(name, { name, line: lineOf(src, idx), how, params });
  };
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+(?:default\s+)?)?function\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*\(/g)) add(m[2], m.index + m[0].indexOf("function"), m[1] ? (m[1].includes("default") ? "default" : "named") : "local");
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?const\s+([A-Z]\w*)\s*(?::\s*[\w.<>, ]+)?\s*=\s*(?:React\.)?(?:memo|forwardRef)?\(?\s*(?:\([^)]*\)|\w+)\s*=>/g)) add(m[2], m.index + m[0].indexOf("const"), m[1] ? "named" : "local");
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?const\s+([A-Z]\w*)\s*=\s*(?:React\.)?(?:memo|forwardRef)\(\s*function/g)) add(m[2], m.index + m[0].indexOf("const"), m[1] ? "named" : "local");
  const defaultName = (src.match(/export\s+default\s+(?:React\.)?(?:memo\()?([A-Z]\w*)\)?\s*;?\s*$/m) || [])[1];
  const namedExports = [...src.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]));
  const out = [];
  for (const c of found.values()) {
    let how = c.how;
    if (c.name === defaultName) how = "default";
    else if (how === "local" && namedExports.includes(c.name)) how = "named";
    if (!/<[A-Za-z>]/.test(src)) continue; // must render something
    out.push({ ...c, how });
  }
  return out;
}

// Workspace packages (monorepos): "@acme/design" → its entry file, "@acme/design/x" → that subpath.
function workspacePackages(root) {
  const out = {};
  const visit = (dir, depth) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      const d = path.join(dir, e.name), pj = path.join(d, "package.json");
      if (fs.existsSync(pj)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
          const exp = pkg.exports?.["."];
          const entry = typeof exp === "string" ? exp : exp?.import || exp?.default || pkg.module || pkg.main || "index.js";
          if (pkg.name) out[pkg.name] = { dir: d, entry: path.join(d, typeof entry === "string" ? entry : "index.js") };
        } catch {}
      }
      visit(d, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function importsOf(src, file, root, pkgs = {}) {
  const out = [];
  for (const m of src.matchAll(/^import\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const spec = m[2];
    let base = null;
    if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(root, file)), spec);
    else {
      const name = Object.keys(pkgs).find((n) => spec === n || spec.startsWith(n + "/"));
      if (!name) continue;
      base = spec === name ? pkgs[name].entry.replace(/\.(tsx|jsx|ts|js|mjs)$/, "") : path.join(pkgs[name].dir, spec.slice(name.length + 1));
    }
    const clause = m[1];
    const names = [];
    const def = clause.match(/^([A-Z]\w*)/);
    if (def) names.push({ local: def[1], imported: "default" });
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) for (const part of braces[1].split(",")) {
      const [imp, local] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (imp && /^[A-Z]/.test(local || imp)) names.push({ local: local || imp, imported: imp });
    }
    out.push({ base, spec, names });
  }
  return out;
}

function resolveFile(base, files, root) {
  if (!base) return null;
  const rel = path.relative(root, base).replace(/\.(tsx|jsx|ts|js)$/, "");
  return files.find((f) => f.replace(/\.(tsx|jsx)$/, "") === rel) || files.find((f) => f.replace(/\.(tsx|jsx)$/, "") === `${rel}/index`) || null;
}

// Untyped .jsx components often ship a sibling .d.ts with their props.
function propsWithDts(root, f, src, c) {
  const own = propsOf(src, c.params);
  if (own.some((p) => p.type) || !/\.jsx$/.test(f)) return own;
  const dts = path.join(root, f.replace(/\.jsx$/, ".d.ts"));
  if (!fs.existsSync(dts)) return own;
  const d = fs.readFileSync(dts, "utf8");
  const decl = d.match(new RegExp(`(?:interface\\s+${c.name}Props(?:\\s+extends[^{]+)?\\s*|type\\s+${c.name}Props\\s*=\\s*[^{]*)\\{`));
  if (!decl) return own;
  const fields = typeFields(balanced(d, decl.index + decl[0].length - 1));
  return fields.length ? fields : own;
}

export function scanParts(root, { ia } = {}) {
  const files = walk(root, root);
  const srcs = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));
  const pkgs = workspacePackages(root);
  // Barrel files (index.js re-exporting components): name → [component file, export name].
  const reexports = {};
  const barrel = (abs) => {
    const rel = path.relative(root, abs);
    if (reexports[rel]) return reexports[rel];
    const map = (reexports[rel] = {});
    const file = [abs, ...[".js", ".mjs", ".ts", ".tsx", ".jsx"].map((e) => abs + e), ...["js", "ts", "tsx"].map((e) => path.join(abs, `index.${e}`))].find((x) => fs.existsSync(x) && fs.statSync(x).isFile());
    if (!file) return map;
    const txt = fs.readFileSync(file, "utf8");
    for (const m of txt.matchAll(/export\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
      const target = path.relative(root, path.resolve(path.dirname(file), m[2])).replace(/\.(tsx|jsx|ts|js)$/, "");
      for (const part of m[1].split(",")) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (orig) map[(alias || orig).trim()] = [target, orig.trim()];
      }
    }
    return map;
  };
  const pageFiles = {};
  for (const n of ia?.nodes || []) if (n.source) pageFiles[n.source.replace(/:\d+$/, "")] = n.id;

  const parts = [];
  const byFileName = {};
  for (const f of files) {
    for (const c of componentsIn(srcs[f], f)) {
      const id = `${f}#${c.name}`;
      const src = srcs[f];
      const p = {
        id, name: c.name, file: f, line: c.line,
        exported: c.how !== "local", export: c.how === "default" ? "default" : c.name,
        // A page file's main export is the page, default or named (export function Track…).
        kind: pageFiles[f] && c.how !== "local" && (c.how === "default" || c.name === path.basename(f).replace(/\.\w+$/, "") || componentsIn(src, f).filter((x) => x.how !== "local").length === 1) ? "page" : CHROME.test(c.name) ? "chrome" : "component",
        props: propsWithDts(root, f, src, c),
        usedBy: [], instances: 0, pages: [], dupes: [],
      };
      if (p.kind === "page") p.page = pageFiles[f];
      parts.push(p);
      byFileName[`${f}#${c.how === "default" ? "default" : c.name}`] = p;
      (byFileName[`${f}#${c.name}`] ||= p);
    }
  }

  // Usage: resolve imports, count JSX instances per importing file.
  for (const f of files) {
    const src = srcs[f];
    const scope = {};
    for (const imp of importsOf(src, f, root, pkgs)) {
      const target = resolveFile(imp.base, files, root);
      for (const n of imp.names) {
        let p = target && byFileName[`${target}#${n.imported}`];
        if (!p) { // through a barrel: export { Card } from "./components/data/Card.jsx"
          const hop = barrel(imp.base)[n.imported];
          const file = hop && resolveFile(path.join(root, hop[0]), files, root);
          if (file) p = byFileName[`${file}#${hop[1]}`];
        }
        if (p) scope[n.local] = p;
      }
    }
    for (const p of parts.filter((x) => x.file === f)) scope[p.name] = p;
    for (const [local, p] of Object.entries(scope)) {
      const count = [...src.matchAll(new RegExp(`<${local}[\\s/>]`, "g"))].length;
      if (!count) continue;
      p.usedBy.push({ file: f, count });
      p.instances += count;
    }
  }

  // Pages each part ends up on: walk up the usage graph to page files.
  const partsInFile = (f) => parts.filter((p) => p.file === f);
  for (const p of parts) {
    const seen = new Set(), pages = new Set(), queue = [p];
    if (p.page) pages.add(p.page);
    while (queue.length) {
      const cur = queue.shift();
      if (cur !== p && cur.name === "App" && p.kind !== "page") p.global = true; // rendered on every page
      for (const u of cur.usedBy) {
        if (pageFiles[u.file]) { pages.add(pageFiles[u.file]); continue; } // stop at pages
        if (seen.has(u.file)) continue;
        seen.add(u.file);
        queue.push(...partsInFile(u.file).filter((x) => x !== p));
      }
    }
    p.pages = [...pages];
  }

  // Likely duplicates: same name in different files, or same name once common affixes are stripped.
  const norm = (n) => n.replace(AFFIX, "").toLowerCase() || n.toLowerCase();
  const groups = {};
  for (const p of parts) if (p.kind !== "page") (groups[norm(p.name)] ||= []).push(p);
  for (const g of Object.values(groups)) if (g.length > 1 && new Set(g.map((x) => x.file)).size > 1)
    for (const p of g) p.dupes = g.filter((x) => x !== p).map((x) => x.id);

  // Design-debt signals per file (shared by the components in it).
  const signals = {};
  for (const f of files) {
    const s = srcs[f];
    signals[f] = {
      inlineStyles: (s.match(/style=\{\{/g) || []).length,
      hardcodedColors: (s.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []).length,
      lines: s.split("\n").length,
    };
  }
  for (const p of parts) p.signals = signals[p.file];

  // Storybook stories become variants of the component their meta names.
  const storybook = attachStories(root, parts);

  let commit = null;
  try { commit = execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  return {
    version: 1,
    product: ia?.product || path.basename(root),
    snapshot: { commit, date: new Date().toISOString().slice(0, 10), sources: storybook ? ["scan", "storybook"] : ["scan"] },
    storybook,
    parts: parts.sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name)),
  };
}

// Keep what an agent or human curated (notes, status, group, tags) across re-scans.
export function mergeInventory(fresh, old) {
  const keep = Object.fromEntries((old?.parts || []).map((p) => [p.id, p]));
  for (const p of fresh.parts) for (const k of ["notes", "status", "group", "tags", "why"]) if (keep[p.id]?.[k] !== undefined) p[k] = keep[p.id][k];
  return fresh;
}
