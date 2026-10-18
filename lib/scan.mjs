// Heuristic repo scan → a skeleton IA map (scan.json). It is evidence, not the
// truth: an agent curates before.json from it, the code and the running app.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".output", "coverage", ".lathe", ".ux", "out", ".turbo", ".vercel", ".netlify", ".cache", "public", "vendor"]);
const CODE = /\.(tsx|jsx|ts|js|mjs|astro|vue|svelte|mdx?)$/;

function walk(dir, root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".") { if (IGNORE.has(e.name) || e.isDirectory()) continue; }
    if (IGNORE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else out.push(path.relative(root, p));
  }
  return out;
}

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; } };
const titleCase = (s) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

function idFor(p) {
  if (p === "/") return "home";
  if (p === "*" || p === "/*") return "not-found";
  return p.replace(/^\//, "").replace(/[:[\]$.*]/g, "").replace(/\//g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "page";
}

function labelFor(p, comp) {
  if (comp && !/^(Page|Index|Route)$/.test(comp)) return comp.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  if (p === "/") return "Home";
  if (p === "*") return "Not found";
  const seg = p.split("/").filter(Boolean).filter((s) => !s.startsWith(":")).pop();
  return seg ? titleCase(seg) : "Detail";
}

// ---------- route discovery, per package ----------

function frameworkOf(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "next";
  if (deps.astro) return "astro";
  if (deps.nuxt) return "nuxt";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps["@remix-run/react"] || deps["@react-router/dev"]) return "remix";
  if (deps["@tanstack/react-router"]) return "tanstack";
  if (deps["react-router-dom"] || deps["react-router"] || deps["wouter"]) return "react-router";
  if (deps["vue-router"]) return "vue-router";
  return null;
}

const segToPath = (segs) => "/" + segs
  .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@") && s !== "index")
  .map((s) => s.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, ":$1*").replace(/^\[(\w+)\]$/, ":$1").replace(/^\$(\w+)$/, ":$1"))
  .join("/");

function fileRoutes(files, base, fw) {
  const rel = (f) => path.relative(base, f);
  const routes = [];
  for (const f of files) {
    const r = rel(f);
    if (r.startsWith("..")) continue;
    let m;
    if (fw === "next" && (m = r.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.(tsx|jsx|ts|js|mdx)$/))) routes.push({ path: segToPath((m[1] || "").split("/")), file: f });
    else if (fw === "next" && (m = r.match(/^(?:src\/)?pages\/(.+)\.(tsx|jsx|ts|js|mdx)$/)) && !/^(api\/|_)/.test(m[1])) routes.push({ path: segToPath(m[1].split("/")), file: f });
    else if (fw === "astro" && (m = r.match(/^src\/pages\/(.+)\.(astro|md|mdx|html)$/))) routes.push({ path: m[1] === "404" ? "*" : segToPath(m[1].split("/")), file: f });
    else if (fw === "nuxt" && (m = r.match(/^(?:app\/)?pages\/(.+)\.vue$/))) routes.push({ path: segToPath(m[1].split("/")), file: f });
    else if (fw === "sveltekit" && (m = r.match(/^src\/routes\/(?:(.*)\/)?\+page\.svelte$/))) routes.push({ path: segToPath((m[1] || "").split("/")), file: f });
    else if (fw === "remix" && (m = r.match(/^app\/routes\/([^/]+?)(?:\/route)?\.(tsx|jsx|ts|js)$/)) && !/^(api|resources)\b/.test(m[1]))
      routes.push({ path: segToPath(m[1].replace(/_index$/, "index").split(".").map((s) => s.replace(/^_/, "").replace(/_$/, ""))), file: f });
  }
  return routes;
}

function resolveImport(root, fromFile, comp, src) {
  const re = new RegExp(`import\\s+(?:${comp}|\\{[^}]*\\b${comp}\\b[^}]*\\})\\s+from\\s+["']([^"']+)["']|${comp}\\s*=\\s*(?:React\\.)?lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(["']([^"']+)["']`);
  const m = src.match(re);
  const spec = m && (m[1] || m[2]);
  if (!spec || !spec.startsWith(".")) return null;
  const abs = path.resolve(path.dirname(path.join(root, fromFile)), spec);
  for (const c of [abs, ...[".tsx", ".jsx", ".ts", ".js", ".vue"].map((e) => abs.replace(/\.(tsx|jsx|ts|js)$/, "") + e), ...["tsx", "jsx", "ts", "js"].map((e) => path.join(abs, `index.${e}`))])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(root, c);
  return null;
}

function codeRoutes(root, files) {
  const routes = [];
  let routerFile = null;
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(f)) continue;
    const src = read(root, f);
    if (!/<Route\b|createBrowserRouter|createRouter|routes\s*[:=]\s*\[|useRoutes/.test(src)) continue;
    const found = [];
    for (const m of src.matchAll(/<Route\b[^>]*?\bpath=["']([^"']+)["'][^>]*?(?:element=\{\s*<(\w+)|component=\{(\w+)\}|Component=\{(\w+)\})/g))
      found.push({ path: m[1], comp: m[2] || m[3] || m[4], idx: m.index });
    for (const m of src.matchAll(/\bpath:\s*["']([^"']+)["'][^}]*?(?:element:\s*<(\w+)|component:\s*(\w+)|Component:\s*(\w+)|import\(["']([^"']+)["']\))/g))
      found.push({ path: m[1], comp: m[2] || m[3] || m[4], spec: m[5], idx: m.index });
    if (!found.length) continue;
    routerFile ||= f;
    for (const r of found) {
      const file = r.comp ? resolveImport(root, f, r.comp, src) : r.spec ? resolveImport(root, f, "__x", `import __x from "${r.spec}"`) : null;
      const p = r.path === "*" ? "*" : r.path.startsWith("/") ? r.path : "/" + r.path;
      routes.push({ path: p, file: file || f, comp: r.comp, line: lineOf(src, r.idx), routerFile: f });
    }
  }
  return { routes, routerFile };
}

// ---------- sections inside a page ----------

const WRAPPERS = new Set(["Link", "NavLink", "Fragment", "Reveal", "Suspense", "Route", "Routes", "Navigate", "Outlet", "Trans", "Image", "Head", "Helmet", "Seo", "SEO", "Meta", "Container", "Box", "Flex", "Stack", "Grid", "Text", "Button", "Icon", "Metric", "ErrorBoundary", "Provider", "Layout", "Section", "Fade", "Motion"]);

function kindOf(text) {
  const t = text.toLowerCase();
  const rules = [["header", /header|topbar|navbar/], ["footer", /footer/], ["nav", /\bnav|menu|tabs|breadcrumb/], ["gate", /paywall|gate|verify|login|sign ?in|auth/],
    ["hero", /hero|banner|masthead/], ["cta", /cta|call to action|get started|book|signup|sign up/], ["form", /form|input|search|contact|checkout/],
    ["data", /score|chart|trend|metric|stats|gauge|table|dashboard|benchmark|graph/], ["cards", /grid|cards|plans|pricing|features|dimension|tiles/],
    ["list", /list|findings|feed|news|posts|faq|results/], ["media", /video|gallery|image|media|embed|calendly/]];
  for (const [k, re] of rules) if (re.test(t)) return k;
  return "content";
}

const clean = (s) => s.replace(/\{[^}]*\}/g, "").replace(/&[a-z]+;/g, "'").replace(/\s+/g, " ").replace(/^[\s/·•:-]+|[\s·•:-]+$/g, "").trim();

export function sectionsOf(src, file, nodeId) {
  // Components imported from packages (a design system's Card, Input, Tag…) are
  // building blocks, not sections. Local feature components can be.
  const fromPackages = new Set();
  for (const m of src.matchAll(/^import\s+(?!type\s)([^;]*?)\s+from\s+["']([^"'.][^"']*)["']/gm))
    for (const n of m[1].replace(/[{}]/g, " ").split(/[\s,]+/)) if (/^[A-Z]/.test(n) && n !== "as") fromPackages.add(n);

  const tokens = [];
  for (const m of src.matchAll(/<(section|header|footer|nav|form|aside)\b([^>]*)>|<\/(section|header|footer|nav|aside)>|<([A-Z]\w+)\b/g)) {
    if (m[4] && /[\w.$]/.test(src[m.index - 1] || "")) continue; // a generic like useState<Draft>, not JSX
    tokens.push({ idx: m.index, open: m[1], attrs: m[2] || "", close: m[3], comp: m[4] });
  }
  const out = [];
  let depth = 0, n = 0;
  const seen = new Set();
  const jsxStart = src.search(/return\s*\(|=>\s*\(|<>/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.close) { depth = Math.max(0, depth - 1); continue; }
    if (t.open && t.open !== "form") {
      if (depth === 0) {
        const end = tokens.slice(i + 1).find((x) => x.close === t.open)?.idx ?? t.idx + 2000;
        const body = src.slice(t.idx, end);
        const head = body.match(/className="[^"]*\b(?:kicker|eyebrow|title|h-section|heading)[^"]*"[^>]*>([^<]+)/) || body.match(/<h[1-3][^>]*>([^<]+)/);
        const cls = (t.attrs.match(/className="([\w-]+)/) || [])[1];
        const id = (t.attrs.match(/\bid="([\w-]+)"/) || [])[1];
        let label = head ? clean(head[1]) : "";
        if (!label || label.length < 2) label = titleCase(id || cls || t.open);
        out.push({ label: label.slice(0, 48), kind: kindOf(`${t.open} ${cls || ""} ${id || ""} ${label}`), idx: t.idx, hint: id || cls });
      }
      depth++;
      continue;
    }
    if (!t.comp || jsxStart < 0 || t.idx < jsxStart) continue;
    // A titled container (<Card title="…">, <Section heading="…">) is a section, whoever made it.
    const tag = src.slice(t.idx, t.idx + 600).match(/^<\w+((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*)>/);
    const titleAttr = tag && tag[1].match(/\b(?:title|heading)=(?:"([^"]{2,60})"|\{["'`]([^"'`]{2,60})["'`]\})/);
    if (titleAttr && /(Card|Section|Panel|Block|Region|Pane|Group|Module|Fieldset|Sheet|Box)$/.test(t.comp)) {
      const label = clean(titleAttr[1] || titleAttr[2]);
      const eyebrow = (tag[1].match(/\beyebrow="([^"]{2,60})"/) || [])[1];
      out.push({ label, kind: kindOf(`${label} ${eyebrow || ""} ${t.comp}`), idx: t.idx, hint: label, comp: t.comp });
      continue;
    }
    if (depth === 0 && !WRAPPERS.has(t.comp) && !fromPackages.has(t.comp) && !seen.has(t.comp) && !/(DTO|Props|State|Type|Context)$/.test(t.comp)) {
      seen.add(t.comp);
      out.push({ label: t.comp.replace(/([a-z])([A-Z])/g, "$1 $2"), kind: kindOf(t.comp), idx: t.idx, comp: t.comp });
    }
  }
  return out.filter((s) => s.label && !/[`${}]/.test(s.label)).slice(0, 24).map((s) => ({
    id: `${nodeId}.${(s.hint || s.comp || s.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || ++n}`,
    label: s.label, kind: s.kind, source: `${file}:${lineOf(src, s.idx)}`, ...(s.comp && !/(Card|Section|Panel)$/.test(s.comp) ? { component: s.comp } : {}),
  })).filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
}

// ---------- links between pages ----------

function matchRoute(href, routes) {
  const clean = href.split(/[?#]/)[0].replace(/\$\{[^}]+\}/g, ":x").replace(/\/$/, "") || "/";
  const segs = clean.split("/");
  return routes.find((r) => {
    if (r.path === "*") return false;
    const rs = r.path.replace(/\/$/, "").split("/");
    if (r.path === "/") return clean === "/";
    return rs.length === segs.length && rs.every((s, i) => s.startsWith(":") || segs[i].startsWith(":") || s === segs[i]);
  });
}

function linksOf(root, files, routes) {
  const pageByFile = Object.fromEntries(routes.map((r) => [r.file, r]));
  const importers = {};
  const links = [], nav = { header: [], footer: [] };
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js|astro|vue|svelte)$/.test(f)) continue;
    const src = read(root, f);
    for (const m of src.matchAll(/import\s+[^"']*?from\s+["'](\.[^"']+)["']/g)) {
      const abs = path.resolve(path.dirname(path.join(root, f)), m[1]).replace(/\.(tsx|jsx|ts|js)$/, "");
      (importers[path.relative(root, abs)] ||= []).push(f);
    }
  }
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js|astro|vue|svelte|html)$/.test(f)) continue;
    const src = read(root, f);
    const hrefs = [];
    for (const m of src.matchAll(/\b(?:to|href)=\{?\s*["'`](\/[^"'`]*)["'`]|navigate\(\s*["'`](\/[^"'`]*)["'`]|\bto:\s*["'`](\/[^"'`]*)["'`]/g)) hrefs.push(m[1] || m[2] || m[3]);
    if (!hrefs.length) continue;
    const base = path.basename(f).replace(/\.\w+$/, "");
    const menu = /header|navbar|topbar|^nav$|sidebar/i.test(base) ? "header" : /footer/i.test(base) ? "footer" : null;
    let owners = pageByFile[f] ? [pageByFile[f]] : [];
    if (!owners.length && !menu) owners = (importers[f.replace(/\.\w+$/, "")] || []).map((x) => pageByFile[x]).filter(Boolean);
    for (const h of hrefs) {
      const target = matchRoute(h, routes);
      if (!target) continue;
      if (menu) { if (!nav[menu].includes(target.id)) nav[menu].push(target.id); continue; }
      for (const o of owners) if (o.id !== target.id && !links.some((l) => l.from === o.id && l.to === target.id))
        links.push({ from: o.id, to: target.id, kind: "link", source: f });
    }
  }
  return { links, nav };
}

// ---------- main ----------

export function scan(root) {
  const files = walk(root, root);
  const pkgs = files.filter((f) => path.basename(f) === "package.json");
  let routes = [], routerFile = null;
  const frameworks = new Set();
  for (const p of pkgs.length ? pkgs : ["package.json"]) {
    let pkg = {};
    try { pkg = JSON.parse(read(root, p)); } catch {}
    const fw = frameworkOf(pkg);
    if (!fw) continue;
    frameworks.add(fw);
    const base = path.dirname(p) === "." ? "" : path.dirname(p);
    const inPkg = files.filter((f) => !base || f.startsWith(base + "/"));
    if (["react-router", "vue-router", "tanstack"].includes(fw)) {
      const r = codeRoutes(root, inPkg.filter((f) => CODE.test(f)));
      routes.push(...r.routes);
      routerFile ||= r.routerFile;
    } else routes.push(...fileRoutes(inPkg, base, fw));
  }
  if (!routes.length) {
    const html = files.filter((f) => f.endsWith(".html") && !/(^|\/)(dist|build)\//.test(f));
    routes = html.map((f) => ({ path: "/" + f.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, ""), file: f }));
    if (html.length) frameworks.add("static-html");
  }

  const seen = new Set();
  routes = routes.filter((r) => !seen.has(r.path) && seen.add(r.path));
  for (const r of routes) r.id = idFor(r.path);

  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  const nodes = routes.map((r) => {
    const segs = r.path.split("/").filter(Boolean);
    let parent = null;
    for (let i = segs.length - 1; i > 0 && !parent; i--) parent = byPath["/" + segs.slice(0, i).join("/")]?.id || null;
    if (!parent && r.path !== "/" && r.path !== "*" && byPath["/"]) parent = "home";
    const src = read(root, r.file);
    return {
      id: r.id, label: labelFor(r.path, r.comp), path: r.path,
      group: r.path === "*" || /404|not-?found/i.test(r.file) ? "utility" : /admin/.test(r.path) ? "admin" : "main",
      parent: r.path === "*" ? null : parent,
      source: r.file, confidence: "scan",
      sections: src.length < 200_000 ? sectionsOf(src, r.file, r.id) : [],
    };
  });

  const { links, nav } = linksOf(root, files, routes);
  const inbound = new Set([...links.map((l) => l.to), ...nav.header, ...nav.footer]);
  for (const n of nodes) if (n.id !== "home" && n.path !== "*" && !inbound.has(n.id)) n.notes = "No inbound links found by the scan.";

  let commit = null;
  try { commit = execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  let product = path.basename(root);
  try { product = titleCase(JSON.parse(read(root, "package.json")).name || product); } catch {}

  const usedGroups = [...new Set(nodes.map((n) => n.group))];
  const groupLabels = { main: "Main", admin: "Admin", utility: "Utility" };
  return {
    version: 1,
    product,
    title: "Scan",
    snapshot: { commit, date: new Date().toISOString().slice(0, 10), sources: ["scan"], frameworks: [...frameworks], routes: routerFile },
    groups: usedGroups.map((g) => ({ id: g, label: groupLabels[g] || titleCase(g) })),
    nodes, links, nav,
  };
}
