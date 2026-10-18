// Local workbench server: serves the viewer, reads/writes <repo>/.lathe/, and
// pushes a reload event whenever an agent edits a map file.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanParts, mergeInventory } from "./parts-scan.mjs";
import { findApp, startHarness, makeBase, changedSince } from "./harness.mjs";
import { scanTokens, overridesCss, applyOverrides } from "./tokens-scan.mjs";
import { workDir } from "./workdir.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, "..", "viewer");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".md": "text/markdown" };
const SAFE = /^[\w.-]+\.json$/;
const RESERVED = new Set(["comments.json"]);

export function serve({ root, port = 4747, app: appHint }) {
  const work = workDir(root);
  const ia = path.join(work, "ia");
  const ui = path.join(work, "ui");
  fs.mkdirSync(ia, { recursive: true });
  fs.mkdirSync(ui, { recursive: true });
  const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
  const inventoryFile = path.join(ui, "inventory.json");
  const scanInventory = () => {
    const inv = mergeInventory(scanParts(root, { ia: readJSON(path.join(ia, "before.json")) }), readJSON(inventoryFile));
    fs.writeFileSync(inventoryFile, JSON.stringify(inv, null, 2) + "\n");
    return inv;
  };
  const tokensFile = path.join(ui, "tokens.json"), overridesFile = path.join(ui, "overrides.json");
  const scanTok = () => {
    const inv = scanTokens(root, { inventory: readJSON(inventoryFile) || scanInventory() });
    fs.writeFileSync(tokensFile, JSON.stringify(inv, null, 2) + "\n");
    return inv;
  };
  const writeOverrides = (ov, inv = readJSON(tokensFile)) => {
    fs.writeFileSync(overridesFile, JSON.stringify(ov, null, 2) + "\n");
    fs.writeFileSync(path.join(ui, "overrides.css"), overridesCss(inv, ov));
  };
  // Isolation harness: started on first use, then kept running.
  const H = { state: "idle", url: null, error: null, app: null };
  const baseInfo = () => (fs.existsSync(path.join(ui, "base")) ? readJSON(path.join(ui, "base.json")) : null);
  const harnessInfo = () => ({ state: H.state, url: H.url, error: H.error, app: H.app?.rel || null, tags: !!H.tags, base: baseInfo() });
  const startH = async () => {
    if (H.state === "ready" || H.state === "starting") return H.promise;
    H.state = "starting"; H.error = null;
    H.promise = (async () => {
      try {
        const app = findApp(root, appHint);
        if (app.error) throw new Error(app.error);
        H.app = app;
        if (!fs.existsSync(tokensFile)) scanTok();
        const { url, tags } = await startHarness({ root, app, port: port + 1 });
        H.url = url; H.tags = tags; H.state = "ready";
      } catch (e) { H.state = "error"; H.error = e.message; }
      broadcast();
    })();
    return H.promise;
  };
  const commentsFile = path.join(ia, "comments.json");
  const readComments = () => { try { return JSON.parse(fs.readFileSync(commentsFile, "utf8")); } catch { return []; } };
  const clients = new Set();

  const send = (res, code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
  const file = (res, base, rel) => {
    const p = path.normalize(path.join(base, rel));
    if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, { error: "not found" });
    send(res, 200, fs.readFileSync(p), TYPES[path.extname(p)] || "application/octet-stream");
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    try {
      if (p === "/api/meta") return send(res, 200, { root, name: path.basename(root), dir: path.basename(work) });
      if (p === "/api/maps") {
        const maps = fs.readdirSync(ia).filter((f) => SAFE.test(f) && !RESERVED.has(f)).map((f) => {
          let m = {};
          try { m = JSON.parse(fs.readFileSync(path.join(ia, f), "utf8")); } catch (e) { return { name: f.replace(/\.json$/, ""), error: e.message }; }
          return { name: f.replace(/\.json$/, ""), title: m.title || null, product: m.product, mtime: fs.statSync(path.join(ia, f)).mtimeMs };
        });
        return send(res, 200, maps);
      }
      if (p === "/api/map") {
        const name = `${url.searchParams.get("name")}.json`;
        if (!SAFE.test(name) || RESERVED.has(name)) return send(res, 400, { error: "bad name" });
        return file(res, ia, name);
      }
      if (p === "/api/comments" && req.method === "GET") return send(res, 200, readComments());
      if (p === "/api/comments" && req.method === "POST") {
        const b = await body(req);
        const list = readComments();
        if (b.action === "resolve") { const c = list.find((x) => x.id === b.id); if (c) c.resolved = !c.resolved; }
        else if (b.text && b.target) list.push({ id: Math.random().toString(36).slice(2, 9), map: b.map, target: b.target, author: "human", text: String(b.text).slice(0, 4000), at: new Date().toISOString() });
        fs.writeFileSync(commentsFile, JSON.stringify(list, null, 2) + "\n");
        return send(res, 200, list);
      }
      if (p === "/api/parts" && req.method === "GET") {
        const inv = readJSON(inventoryFile) || scanInventory();
        return send(res, 200, { ...inv, dir: path.basename(work), changed: changedSince(root, baseInfo()?.commit) });
      }
      if (p === "/api/parts/scan" && req.method === "POST") return send(res, 200, scanInventory());
      if (p === "/api/harness" && req.method === "GET") return send(res, 200, harnessInfo());
      // What the human pointed at in Inspect, for the agent: <work>/ui/selection.json.
      if (p === "/api/selection" && req.method === "POST") {
        const b = await body(req), f = path.join(ui, "selection.json");
        if (b.clear) fs.rmSync(f, { force: true });
        else fs.writeFileSync(f, JSON.stringify({ ...b, at: new Date().toISOString() }, null, 2) + "\n");
        return send(res, 200, { ok: true });
      }
      if (p === "/api/harness/start" && req.method === "POST") { await startH(); return send(res, 200, harnessInfo()); }
      if (p === "/api/parts/base" && req.method === "POST") {
        const b = await body(req);
        makeBase(root, b.ref || "HEAD");
        return send(res, 200, harnessInfo());
      }
      if (p === "/api/tokens" && req.method === "GET") {
        const inv = readJSON(tokensFile) || scanTok();
        return send(res, 200, { ...inv, overrides: readJSON(overridesFile, {}) });
      }
      if (p === "/api/tokens/scan" && req.method === "POST") { const inv = scanTok(); writeOverrides(readJSON(overridesFile, {}), inv); return send(res, 200, { ok: true }); }
      if (p === "/api/tokens/overrides" && req.method === "POST") {
        const b = await body(req);
        let ov = readJSON(overridesFile, {});
        if (b.clear) ov = {};
        else if (b.name && /^--[\w-]+$/.test(b.name)) {
          const theme = String(b.theme || "default");
          ov[b.name] ||= {};
          if (b.value == null || b.value === "") delete ov[b.name][theme]; else ov[b.name][theme] = String(b.value).replace(/[;{}]/g, "").slice(0, 300);
          if (!Object.keys(ov[b.name]).length) delete ov[b.name];
        }
        writeOverrides(ov);
        return send(res, 200, ov);
      }
      if (p === "/api/tokens/apply" && req.method === "POST") {
        const inv = readJSON(tokensFile) || scanTok();
        const ov = readJSON(overridesFile, {});
        const result = applyOverrides(root, inv, ov);
        // Keep only what couldn't be written (e.g. generated files), then rescan.
        const left = {};
        for (const s of result.skipped) if (ov[s.name]) left[s.name] = ov[s.name];
        const fresh = scanTok();
        writeOverrides(left, fresh);
        return send(res, 200, result);
      }
      if (p === "/api/tokens/brief" && req.method === "POST") {
        const b = await body(req);
        fs.writeFileSync(path.join(ui, "tokens-brief.md"), String(b.markdown || ""));
        return send(res, 200, { path: path.relative(root, path.join(ui, "tokens-brief.md")) });
      }
      if (p === "/api/parts/brief" && req.method === "POST") {
        const b = await body(req);
        fs.writeFileSync(path.join(ui, "brief.md"), String(b.markdown || ""));
        return send(res, 200, { path: path.relative(root, path.join(ui, "brief.md")) });
      }
      if (p === "/api/brief" && req.method === "POST") {
        const b = await body(req);
        fs.writeFileSync(path.join(ia, "brief.md"), String(b.markdown || ""));
        return send(res, 200, { path: path.relative(root, path.join(ia, "brief.md")) });
      }
      if (p === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write("retry: 1000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (p.startsWith("/lib/")) return file(res, HERE, p.slice(5));
      return file(res, VIEWER, p === "/" ? "index.html" : p.slice(1));
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });

  let t;
  function broadcast(kind = "change") { clearTimeout(t); t = setTimeout(() => { for (const c of clients) c.write(`data: ${kind}\n\n`); }, 120); }
  fs.watch(ia, () => broadcast("ia"));
  fs.watch(ui, (_, f) => { if (f && !/^(harness-errors|overrides\.css)/.test(f)) broadcast("ui"); });

  // Another project already on this port? Step up by two (each workbench uses port and port + 1).
  server.on("error", (e) => {
    if (e.code !== "EADDRINUSE") throw e;
    port += 2;
    server.listen(port, "127.0.0.1");
  });
  server.on("listening", () => console.log(`lathe → http://localhost:${port}  (${root})`));
  server.listen(port, "127.0.0.1");
  return server;
}
