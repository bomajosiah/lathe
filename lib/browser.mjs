// Headless screenshots without a dependency: launch Chrome or Chromium and drive it
// over the DevTools protocol with Node's built-in WebSocket (Node 22+). The browser
// comes from LATHE_CHROME, an installed Chrome/Chromium, or Playwright's cache.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function findChrome() {
  const env = process.env.LATHE_CHROME;
  if (env && fs.existsSync(env)) return env;
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of fixed) if (fs.existsSync(p)) return p;
  // Playwright's downloads: newest headless shell or Chromium.
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), "Library", "Caches", "ms-playwright"), path.join(os.homedir(), ".cache", "ms-playwright"), path.join(os.homedir(), "AppData", "Local", "ms-playwright")].filter(Boolean);
  for (const c of caches) {
    if (!fs.existsSync(c)) continue;
    const dirs = fs.readdirSync(c).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => +b.split("-").pop() - +a.split("-").pop());
    for (const d of dirs) {
      for (const rel of [
        "chrome-mac/headless_shell", "chrome-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-win/chrome.exe",
      ]) {
        const p = path.join(c, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

let shared = null;

/** One headless browser per process, started on first use. */
export async function browser() {
  if (shared) return shared;
  if (typeof WebSocket === "undefined") throw new Error("Screenshots need Node 22 or newer (built-in WebSocket).");
  const bin = findChrome();
  if (!bin) throw new Error("No Chrome or Chromium found. Install Chrome, or set LATHE_CHROME to a Chrome/Chromium binary (npx playwright install chromium also works).");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lathe-chrome-"));
  const proc = spawn(bin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok, fail) => {
    let buf = "";
    const t = setTimeout(() => fail(new Error("Chrome didn't start in 15s")), 15000);
    proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
    proc.on("exit", (code) => { clearTimeout(t); fail(new Error(`Chrome exited (${code}): ${buf.slice(-300)}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("Couldn't connect to Chrome")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const close = () => { try { ws.close(); proc.kill(); fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
  process.on("exit", close);
  shared = { send, close, bin };
  return shared;
}

/**
 * Load a harness URL, wait for the component to report ready (or an error), and
 * return a PNG of the rendered content: { png (base64), ready, error }.
 */
export async function screenshot(url, { width = 800, height = 600, timeout = 20000, full = false } = {}) {
  const b = await browser();
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => b.send(m, p, sessionId);
  try {
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 600 });
    await s("Page.navigate", { url });
    const t0 = Date.now();
    let state = null;
    while (Date.now() - t0 < timeout) {
      const r = await s("Runtime.evaluate", { expression: "JSON.stringify(window.__latheReady || window.__latheError || null)", returnByValue: true });
      state = JSON.parse(r.result?.value || "null");
      if (state) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    // Let fonts, images and enter animations settle.
    await s("Runtime.evaluate", { expression: "document.fonts ? document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 350))) : new Promise((r) => setTimeout(r, 350))", awaitPromise: true });
    // Crop to what rendered (portals like modals included), plus a margin: an agent pays for every pixel.
    const box = await s("Runtime.evaluate", { returnByValue: true, expression: `(() => {
      let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0, n = 0;
      for (const el of document.body.querySelectorAll("*")) {
        if (++n > 4000) break;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || el.id === "lathe-root") continue;
        if (r.width >= innerWidth - 1 && r.height >= innerHeight - 1) continue; // full-viewport wrappers
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top + scrollY); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom + scrollY);
      }
      return JSON.stringify(x1 ? { x0, y0, x1, y1 } : null);
    })()` });
    const b = JSON.parse(box.result.value || "null");
    const pad = 24;
    const clip = full || !b ? { x: 0, y: 0, width, height: Math.min(4000, height) }
      : { x: Math.max(0, Math.floor(b.x0 - pad)), y: Math.max(0, Math.floor(b.y0 - pad)), width: Math.min(width, Math.ceil(b.x1 + pad)) - Math.max(0, Math.floor(b.x0 - pad)), height: Math.min(4000, Math.ceil(b.y1 + pad) - Math.max(0, Math.floor(b.y0 - pad))) };
    const shot = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
    return { png: shot.data, ready: state && !state.error ? state : null, error: state?.error || (!state ? "Timed out waiting for the component to render" : null) };
  } finally {
    b.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}
