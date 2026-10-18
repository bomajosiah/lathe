// Storybook, when a repo has it: find .storybook/main, match its `stories`
// globs, and link each story file to the component its meta names. The stories
// then render as that component's variants in Lathe's own harness. Lathe never
// needs Storybook running or installed for this; without it, fixtures are used.
import fs from "node:fs";
import path from "node:path";
import { WORK_DIRS } from "./workdir.mjs";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "out", "storybook-static", ...WORK_DIRS]);
const STORY = /\.(stories|story)\.(tsx|ts|jsx|js|mjs)$/;
const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function walk(dir, root, test, out = [], depth = 0) {
  if (depth > 8) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name) || (e.name.startsWith(".") && e.name !== ".storybook")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, test, out, depth + 1);
    else if (test(e.name, p)) out.push(p);
  }
  return out;
}

// '../src/**/*.stories.@(ts|tsx)' → RegExp over absolute paths.
function globRe(glob) {
  let s = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) { s += "(?:.*/)?"; i += 2; }
    else if (glob.startsWith("**", i)) { s += ".*"; i += 1; }
    else if (c === "*") s += "[^/]*";
    else if (c === "?") s += "[^/]";
    else if ("@!+".includes(c) && glob[i + 1] === "(") { /* extglob: the group follows */ }
    else if (c === "(") s += "(?:";
    else if (c === ")" || c === "|") s += c;
    else if (c === "{") s += "(?:";
    else if (c === "}") s += ")";
    else if (c === ",") s += glob.lastIndexOf("{", i) > glob.lastIndexOf("}", i) ? "|" : ",";
    else s += c.replace(/[.+^$[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${s}$`);
}

/** The repo's Storybook config, if any: { dir, main, preview, globs } (paths relative to root). */
export function findStorybook(root) {
  const mains = walk(root, root, (n, p) => /^main\.(ts|js|mjs|cjs|mts)$/.test(n) && path.basename(path.dirname(p)) === ".storybook");
  if (!mains.length) return null;
  const main = mains.sort((a, b) => a.length - b.length)[0];
  const dir = path.dirname(main);
  const txt = fs.readFileSync(main, "utf8");
  const globs = [];
  const arr = (txt.match(/stories\s*:\s*\[([\s\S]*?)\]\s*,?\s*\n/) || [])[1] || "";
  for (const m of arr.matchAll(/(?:directory\s*:\s*)?["'`]([^"'`]+)["'`]/g)) globs.push(m[1]);
  // { directory: '../src', files: '**/*.stories.tsx' } → one glob
  const specs = [...arr.matchAll(/\{\s*([^}]*)\}/g)].map((m) => ({
    directory: (m[1].match(/directory\s*:\s*["'`]([^"'`]+)/) || [])[1],
    files: (m[1].match(/files\s*:\s*["'`]([^"'`]+)/) || [])[1] || "**/*.@(mdx|stories.@(js|jsx|mjs|ts|tsx))",
  })).filter((s) => s.directory);
  const plain = globs.filter((g) => !specs.some((s) => s.directory === g || s.files === g));
  const all = [...plain, ...specs.map((s) => `${s.directory.replace(/\/$/, "")}/${s.files}`)];
  const preview = ["ts", "tsx", "js", "jsx", "mjs", "mts"].map((e) => path.join(dir, `preview.${e}`)).find((p) => fs.existsSync(p));
  return {
    dir: path.relative(root, dir),
    main: path.relative(root, main),
    preview: preview ? path.relative(root, preview) : null,
    globs: all,
    matchers: all.map((g) => globRe(path.resolve(dir, g).split(path.sep).join("/"))),
  };
}

const storyName = (exp) => exp.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

function resolveImport(from, spec, root) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const e of EXTS) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(root, p);
  }
  return null;
}

/** Parse one CSF file statically: its component, title and story exports in source order. */
export function parseStoryFile(abs, root) {
  const src = fs.readFileSync(abs, "utf8");
  const imports = {};
  for (const m of src.matchAll(/import\s+(?!type\b)([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    const [clause, spec] = [m[1], m[2]];
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def) imports[def[1]] = { spec, name: "default" };
    const named = clause.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(",")) {
      const [orig, alias] = part.replace(/\btype\s+/, "").trim().split(/\s+as\s+/);
      if (orig) imports[(alias || orig).trim()] = { spec, name: orig.trim() };
    }
  }
  const firstStory = src.search(/export\s+const\s+[A-Z_$]/);
  const head = firstStory > 0 ? src.slice(0, firstStory) : src;
  const comp = (head.match(/\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/) || [])[1];
  const title = (head.match(/\btitle\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1] || null;
  const stories = [...src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
    .filter((e) => e !== "__namedExportsOrder" && /^[A-Z]/.test(e))
    .map((e) => ({ export: e, name: storyName(e) }));
  let component = null;
  if (comp && imports[comp]) {
    const file = resolveImport(abs, imports[comp].spec, root);
    if (file) component = { file, export: imports[comp].name, local: comp };
  }
  const localImports = Object.values(imports).map((i) => resolveImport(abs, i.spec, root)).filter(Boolean);
  return { file: path.relative(root, abs), title, component, stories, imports: [...new Set(localImports)] };
}

/** Find stories and attach them to inventory parts as `stories: [{ file, export, name }]`. */
export function attachStories(root, parts) {
  const sb = findStorybook(root);
  if (!sb) return null;
  const files = walk(root, root, (n, p) => STORY.test(n) && (!sb.matchers.length || sb.matchers.some((re) => re.test(p.split(path.sep).join("/")))));
  const byFileExport = {};
  for (const p of parts) byFileExport[`${p.file}#${p.export}`] = p;
  let count = 0, unlinked = [];
  for (const abs of files) {
    const f = parseStoryFile(abs, root);
    let target = f.component && byFileExport[`${f.component.file}#${f.component.export}`];
    if (!target && f.title) {
      // No meta.component: match the title's last segment to a component the file imports.
      const last = f.title.split("/").pop().replace(/\s+/g, "");
      target = parts.find((p) => f.imports.includes(p.file) && p.name.toLowerCase() === last.toLowerCase());
    }
    if (!target) { unlinked.push(f.file); continue; }
    target.stories ||= [];
    for (const s of f.stories) target.stories.push({ file: f.file, export: s.export, name: s.name });
    count += f.stories.length;
  }
  return { dir: sb.dir, main: sb.main, preview: sb.preview, globs: sb.globs, files: files.length, stories: count, unlinked };
}
