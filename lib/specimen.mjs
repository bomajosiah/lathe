// Token specimens, rendered inside the app's own build (its CSS, fonts and the
// live overrides), so what you see is what the product will get. Plain DOM.

const STYLES = `
html, body { background: #141517 !important; color: #d4d6db !important; margin: 0 !important; }
#lathe-spec { padding: 28px 32px 80px; font: 13px/1.4 ui-sans-serif, -apple-system, system-ui, sans-serif; color: #d4d6db; }
#lathe-spec * { box-sizing: border-box; }
.uxs-sec { margin: 0 0 30px; }
.uxs-h { font: 500 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #75787f; margin: 0 0 12px; }
.uxs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.uxs-tile { all: unset; cursor: pointer; display: flex; flex-direction: column; border-radius: 12px; background: #1c1d20; box-shadow: 0 0 0 1px rgba(255,255,255,.07); overflow: hidden; transition: box-shadow .15s; }
.uxs-tile:hover { box-shadow: 0 0 0 1px rgba(255,255,255,.2); }
.uxs-tile.is-sel { box-shadow: 0 0 0 2px #9fd0e8; }
.uxs-sw { height: 64px; position: relative; }
.uxs-sw::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 -1px 0 rgba(255,255,255,.06); }
.uxs-meta { padding: 8px 10px 9px; display: grid; gap: 2px; min-width: 0; }
.uxs-meta b { font: 500 11.5px/1.3 ui-monospace, Menlo, monospace; color: #e8e9ec; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uxs-meta code { font: 11px/1.3 ui-monospace, Menlo, monospace; color: #7d8088; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uxs-row { all: unset; cursor: pointer; display: grid; grid-template-columns: 190px 1fr; gap: 16px; align-items: center; padding: 10px 12px; border-radius: 10px; width: 100%; box-sizing: border-box; }
.uxs-row:hover { background: #1c1d20; }
.uxs-row.is-sel { background: #1c1d20; box-shadow: 0 0 0 2px #9fd0e8; }
.uxs-row .uxs-meta { padding: 0; }
.uxs-sample { color: #f1f2f4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.uxs-bar { height: 12px; border-radius: 3px; background: #9fd0e8; min-width: 1px; }
.uxs-box { width: 72px; height: 72px; background: #2a2c31; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
.uxs-light { background: #e9eaee; border-radius: 14px; padding: 18px; }
.uxs-light .uxs-row:hover, .uxs-light .uxs-row.is-sel { background: #dfe1e6; }
.uxs-light .uxs-meta b { color: #23252a; } .uxs-light .uxs-meta code { color: #6b6e75; }
.uxs-card { width: 140px; height: 76px; border-radius: 10px; background: #fff; }
.uxs-track { position: relative; height: 18px; background: #1c1d20; border-radius: 9px; overflow: hidden; }
.uxs-dot { position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #9fd0e8; animation-name: uxs-move; animation-iteration-count: infinite; animation-direction: alternate; }
@keyframes uxs-move { to { left: calc(100% - 15px); } }
.uxs-empty { color: #75787f; padding: 40px 0; }
`;

const family = (name) => {
  const parts = name.replace(/^--/, "").split("-");
  return parts.length > 1 ? parts.slice(0, parts.length > 2 && !/^\d/.test(parts[1]) ? 2 : 1).join("-") : parts[0];
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const meta = (t) => `<span class="uxs-meta"><b>${esc(t.name)}</b><code data-live="${esc(t.name)}"></code></span>`;

export function renderSpecimen(inv, { group, side, themed }) {
  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.append(style);
  const el = document.getElementById("lathe-spec");
  // "themed": only tokens whose value changes between themes, across every group.
  const isThemed = (t) => new Set(Object.values(t.resolved || {})).size > 1;
  const tokens = (inv.tokens || []).filter((t) => (themed ? isThemed(t) : t.group === group));
  const sections = {};
  for (const t of tokens) (sections[themed ? `${t.group}|${t.group === "type" ? t.category : family(t.name)}` : group === "type" ? t.category : family(t.name)] ||= []).push(t);

  const fam = tokens.find((t) => t.category === "font-family" && /body|sans|ui|text/.test(t.name))?.name || tokens.find((t) => t.category === "font-family")?.name;
  const bodyFont = fam ? `var(${fam})` : "inherit";
  const SAMPLE = "The quick brown fox jumps over the lazy dog";
  const render = {
    color: (list) => `<div class="uxs-grid">${list.map((t) => `<button class="uxs-tile" data-name="${esc(t.name)}"><span class="uxs-sw" style="background: var(${t.name})"></span>${meta(t)}</button>`).join("")}</div>`,
    "font-size": (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-sample" style="font-size: var(${t.name}); font-family: ${bodyFont}; line-height: 1.15">Aa ${SAMPLE}</span></button>`).join(""),
    "font-family": (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-sample" style="font-family: var(${t.name}); font-size: 22px">${SAMPLE}</span></button>`).join(""),
    "font-weight": (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-sample" style="font-weight: var(${t.name}); font-family: ${bodyFont}; font-size: 22px">${SAMPLE}</span></button>`).join(""),
    "line-height": (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span style="line-height: var(${t.name}); font-family: ${bodyFont}; font-size: 15px; max-width: 420px; white-space: normal; color: #f1f2f4">${SAMPLE}. ${SAMPLE}. ${SAMPLE}.</span></button>`).join(""),
    "letter-spacing": (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-sample" style="letter-spacing: var(${t.name}); font-family: ${bodyFont}; font-size: 15px; text-transform: uppercase">Visibility report</span></button>`).join(""),
    space: (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-bar" style="width: var(${t.name}); max-width: 100%"></span></button>`).join(""),
    radius: (list) => `<div class="uxs-grid">${list.map((t) => `<button class="uxs-tile" data-name="${esc(t.name)}" style="background:none;box-shadow:none;align-items:flex-start;gap:8px"><span class="uxs-box" style="border-radius: var(${t.name})"></span>${meta(t)}</button>`).join("")}</div>`,
    shadow: (list) => `<div class="uxs-light">${list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-card" style="box-shadow: var(${t.name})"></span></button>`).join("")}</div>`,
    motion: (list) => list.map((t) => {
      const v = String(t.resolved?.default || "");
      const easing = /cubic-bezier|ease|linear|steps/.test(v);
      return `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-track"><span class="uxs-dot" style="${easing ? `animation-duration: 1.2s; animation-timing-function: var(${t.name})` : `animation-duration: var(${t.name}); animation-timing-function: ease-in-out`}"></span></span></button>`;
    }).join(""),
    other: (list) => list.map((t) => `<button class="uxs-row" data-name="${esc(t.name)}">${meta(t)}<span class="uxs-meta"><code>${esc(t.comment || "")}</code></span></button>`).join(""),
  };
  const pick = (key) => render[key] || (group === "type" ? render.other : render[group] || render.other);
  el.innerHTML = tokens.length
    ? Object.entries(sections).map(([key, list]) => {
        const [g, k] = themed ? key.split("|") : [group, key];
        return `<section class="uxs-sec"><h3 class="uxs-h">${esc(k.replace(/-/g, " "))} · ${list.length}</h3>${(render[g === "type" ? k : g] || render[g] || render.other)(list)}</section>`;
      }).join("")
    : `<div class="uxs-empty">${themed ? "No tokens change between themes." : `No ${esc(group)} tokens.`}</div>`;

  // Values as the browser resolves them (overrides included), refreshed as CSS hot-swaps.
  const root = document.documentElement;
  const paint = () => el.querySelectorAll("[data-live]").forEach((c) => { const v = getComputedStyle(root).getPropertyValue(c.dataset.live).trim(); if (c.textContent !== v) c.textContent = v; });
  paint();
  setInterval(paint, 400);

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-name]");
    if (b) parent.postMessage({ type: "lathe:token", name: b.dataset.name, side }, "*");
  });
  addEventListener("message", (e) => {
    if (e.data?.type !== "lathe:select") return;
    el.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel"));
    const b = el.querySelector(`[data-name="${CSS.escape(e.data.name)}"]`);
    if (b) { b.classList.add("is-sel"); if (e.data.scroll) b.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });
  // Workbench shortcuts keep working after a click inside the frame.
  const KEYS = /^( |Arrow(Left|Right|Up|Down)|[0-9]|s|S|r|R|l|L|t|T|\/|Escape)$/;
  addEventListener("keydown", (e) => {
    const a = document.activeElement;
    const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    const meta = (e.metaKey || e.ctrlKey) && (e.code === "Backslash" || e.key === "|");
    if (typing && !meta) return;
    if (!meta && !KEYS.test(e.key)) return;
    if (!meta && false && a && a !== document.body && /^(BUTTON|A|SUMMARY)$/.test(a.tagName) && e.key === " ") return;
    e.preventDefault();
    parent.postMessage({ type: "lathe:key", key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }, "*");
  });
  parent.postMessage({ type: "lathe:spec-ready", side }, "*");
}
