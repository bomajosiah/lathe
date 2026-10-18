// Parts: the component workbench. Inventory on the left, the component rendered
// in isolation (by the app's own Vite) in the middle, details on the right.
// Before = the base snapshot (a git ref), After = the working tree.
import { buildPartsBrief } from "/lib/parts-brief.mjs";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const base = (f) => f.split("/").pop();
const safeId = (id) => id.replace(/[^\w.-]+/g, "_");
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const WIDTHS = [["375", 375, "Mobile"], ["768", 768, "Tablet"], ["1280", 1280, "Desktop"], ["Fill", 0, "Fill the stage"]];
const KIND_ICON = {
  page: '<path d="M3.5 2h6l3 3v9h-9z M9.5 2v3h3"/>',
  chrome: '<path d="M2.5 3h11v10h-11z M2.5 5.5h11"/>',
  component: '<path d="M8 2.5l5 2.8v5.4L8 13.5l-5-2.8V5.3z M3 5.3l5 2.8 5-2.8 M8 8.1v5.4"/>',
  local: '<path d="M8 2.5l5 2.8v5.4L8 13.5l-5-2.8V5.3z" stroke-dasharray="2 2"/>',
};

export function initParts(ctx) {
  const P = {
    inv: null, changed: [], harness: null, sel: null, filter: "all", q: "",
    t: 1, side: false, themes: false, width: 0, variant: {}, variants: {}, errors: {}, anim: null, panel: "details", started: false, frameKey: "",
  };

  const api = (u, o) => fetch(u, o).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const post = (b) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) });
  const part = (id) => P.inv?.parts.find((p) => p.id === id);
  const hasBase = () => !!P.harness?.base;
  const dir = () => P.inv?.dir || ".lathe";

  async function refresh() {
    const [inv, h] = await Promise.all([api("/api/parts"), api("/api/harness")]);
    P.changed = inv.changed || [];
    P.inv = inv;
    P.harness = h;
    if (!P.sel || !part(P.sel)) P.sel = (P.inv.parts.find((p) => p.exported && p.kind === "component" && p.instances) || P.inv.parts[0])?.id || null;
    renderList(); renderChrome(); renderFrames(); renderPanel();
  }

  async function enter() {
    if (!P.inv) await refresh();
    if (!P.started) {
      P.started = true;
      if (P.harness?.state === "idle") { renderFrames(); P.harness = await api("/api/harness/start", post()); }
      renderFrames(); renderChrome();
    }
    layout();
  }

  function select(id) {
    if (!part(id)) return;
    P.sel = id;
    ctx.setHash(`parts/${encodeURIComponent(id)}`);
    renderList(); renderFrames(); renderPanel();
    $(`#plistBody [data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // ---------- list ----------
  const groupOf = (p) => !p.exported ? "Local, not exported" : p.kind === "page" ? "Pages" : p.global ? "Global" : !p.instances ? "Unused" : p.instances > 1 || p.pages.length > 1 ? "Shared" : "Single use";
  const ORDER = ["Global", "Shared", "Single use", "Pages", "Unused", "Local, not exported"];
  function visible() {
    const q = P.q.toLowerCase();
    return (P.inv?.parts || []).filter((p) => {
      if (q && !`${p.name} ${p.file}`.toLowerCase().includes(q)) return false;
      if (P.filter === "shared") return p.instances > 1 || p.pages.length > 1 || p.global;
      if (P.filter === "dupes") return p.dupes.length > 0;
      if (P.filter === "changed") return P.changed.includes(p.file);
      if (P.filter === "unused") return !p.instances && p.kind !== "page" && p.name !== "App";
      return true;
    });
  }
  function renderList() {
    if (!P.inv) return;
    const parts = P.inv.parts;
    const counts = {
      all: parts.length, shared: parts.filter((p) => p.instances > 1 || p.pages.length > 1 || p.global).length,
      dupes: parts.filter((p) => p.dupes.length).length, changed: parts.filter((p) => P.changed.includes(p.file)).length,
      unused: parts.filter((p) => !p.instances && p.kind !== "page" && p.name !== "App").length,
    };
    $("#pfilters").innerHTML = [["all", "All"], ["shared", "Shared"], ["dupes", "Dupes"], ["changed", "Edited"], ["unused", "Unused"]]
      .filter(([k]) => k === "all" || counts[k])
      .map(([k, l]) => `<button class="chip${P.filter === k ? " is-on" : ""}" data-f="${k}">${l} <span>${counts[k]}</span></button>`).join("");
    const list = visible();
    const groups = {};
    for (const p of list) (groups[groupOf(p)] ||= []).push(p);
    $("#plistBody").innerHTML = ORDER.filter((g) => groups[g]).map((g) => `<div class="pgroup">${g} <span>${groups[g].length}</span></div>` + groups[g].map((p) => {
      const ico = KIND_ICON[!p.exported ? "local" : p.kind] || KIND_ICON.component;
      const edited = P.changed.includes(p.file);
      return `<button class="prow${p.id === P.sel ? " is-sel" : ""}" data-id="${esc(p.id)}">
        <span class="pico"><svg viewBox="0 0 16 16" width="14" height="14">${ico}</svg></span>
        <span class="pname"><b>${esc(p.name)}</b><small>${esc(base(p.file))}</small></span>
        ${edited ? `<i class="pdot add" title="Edited since Before"></i>` : ""}${p.dupes.length ? `<i class="pdot chg" title="Possible duplicate"></i>` : ""}
        <span class="pcount" title="Instances">${p.instances ? `×${p.instances}` : "—"}</span></button>`;
    }).join("")).join("") || `<p class="muted" style="padding:12px">No matches.</p>`;
    $("#plistBody").querySelectorAll(".prow").forEach((b) => (b.onclick = () => select(b.dataset.id)));
    $("#pfilters").querySelectorAll(".chip").forEach((b) => (b.onclick = () => { P.filter = b.dataset.f; renderList(); }));
  }
  $("#psearch").oninput = (e) => { P.q = e.target.value; renderList(); };
  $("#prescan").onclick = async () => { await api("/api/parts/scan", post()); await refresh(); ctx.toast("Components re-scanned"); };

  // ---------- frames ----------
  function harnessSrc(p, side, themeId) {
    const v = P.variant[p.id] || "";
    // Standalone components get breathing room; pages and chrome sit edge to edge.
    const pad = p.kind === "component" ? 32 : 0;
    const q = new URLSearchParams({ file: p.file, name: p.export, id: p.id, side, variant: v, pad, ...ctx.themeParams(themeId) });
    return `${harnessOrigin()}/__lathe/harness.html?${q}`;
  }
  // Same hostname as the workbench (only the port differs), so the browser keeps
  // the frames in-process: same-site, smoother, and visible to screen capture.
  function harnessOrigin() { const u = new URL(P.harness.url); u.hostname = location.hostname; return u.origin; }
  function stageRect() {
    if (document.body.classList.contains("is-focus")) return { x: 24, y: 24, w: innerWidth - 48, h: innerHeight - 48 };
    const narrow = innerWidth <= 900;
    if (narrow) { const y = 120 + innerHeight * 0.2 + 8; return { x: 8, y, w: innerWidth - 16, h: innerHeight * 0.58 - y - 60 }; }
    return { x: 16 + 296 + 16, y: 80, w: innerWidth - (16 + 296 + 16) - 376 - 16, h: innerHeight - 80 - 90 };
  }
  function renderFrames() {
    const st = $("#pstage");
    const p = part(P.sel);
    const H = P.harness;
    if (!p || !H) { st.innerHTML = ""; return; }
    if (H.state !== "ready") {
      P.frameKey = "";
      st.innerHTML = `<div class="pmsg">${H.state === "error" ? `<b>Couldn't start the app's dev build</b><p>${esc(H.error)}</p><button class="btn" id="pretry">Try again</button>` : `<span class="spin"></span><b>Starting ${esc(H.app || "the app")}'s dev build…</b><p>Components render with the app's own Vite config, styles and fonts.</p>`}</div>`;
      $("#pretry")?.addEventListener("click", async () => { P.harness = await api("/api/harness/start", post()); renderFrames(); });
      return;
    }
    if (!p.exported) {
      P.frameKey = "";
      st.innerHTML = `<div class="pmsg"><b>${esc(p.name)} isn't exported</b><p>It's local to <span class="mono">${esc(p.file)}</span>, so it can only be seen through its parent. Export it to work on it in isolation.</p></div>`;
      return;
    }
    const sides = hasBase() ? ["base", "work"] : ["work"];
    const themes = ctx.themes();
    const key = [p.id, P.variant[p.id] || "", P.side, P.themes, sides.join(), H.url, H.base?.commit, JSON.stringify(ctx.themeParams())].join("|");
    if (key !== P.frameKey && P.themes && themes.length > 1) {
      // Every theme side by side (working tree, with token overrides).
      P.frameKey = key;
      st.innerHTML = themes.map((th) => `<div class="pframe" data-card="${esc(th.id)}"><div class="pframe-h"><i class="sdot-work"></i>${esc(th.label)} <span>theme</span><em class="perr" data-err="work"></em></div><div class="pframe-b"><iframe data-side="work" src="${esc(harnessSrc(p, "work", th.id))}" title="${esc(p.name)} (${esc(th.label)})"></iframe></div></div>`).join("");
    } else if (key !== P.frameKey) {
      P.frameKey = key;
      const frame = (side) => `<iframe data-side="${side}" src="${esc(harnessSrc(p, side))}" title="${esc(p.name)} (${side === "base" ? "before" : "after"})"></iframe>`;
      const label = (side) => side === "base" ? `Before <span>${esc(H.base.ref)} · ${esc(H.base.commit.slice(0, 7))}</span>` : `After <span>working tree</span>`;
      st.innerHTML = P.side && hasBase()
        ? sides.map((s) => `<div class="pframe" data-card="${s}"><div class="pframe-h"><i class="sdot-${s}"></i>${label(s)}<em class="perr" data-err="${s}"></em></div><div class="pframe-b">${frame(s)}</div></div>`).join("")
        : `<div class="pframe" data-card="stack"><div class="pframe-h"><i class="sdot-work"></i><span class="plabel" data-l="work">${label("work")}</span>${hasBase() ? `<span class="plabel" data-l="base">${label("base")}</span>` : ""}<em class="perr" data-err="work"></em><em class="perr" data-err="base"></em></div><div class="pframe-b stack">${sides.map(frame).join("")}</div></div>`;
    }
    layout();
    paintT();
    paintErrors();
  }
  function layout() {
    const st = $("#pstage");
    if (!st || !document.body.classList.contains("mode-parts")) return;
    const r = stageRect();
    Object.assign(st.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const cards = [...st.querySelectorAll(".pframe")];
    if (!cards.length) return;
    const gap = 16, head = 34;
    const slotW = (r.w - gap * (cards.length - 1)) / cards.length;
    const W = P.width || slotW;
    const k = Math.min(1, slotW / W);
    for (const c of cards) {
      c.style.width = `${W * k}px`;
      c.style.height = `${r.h}px`;
      const b = c.querySelector(".pframe-b");
      b.style.height = `${r.h - head}px`;
      for (const f of c.querySelectorAll("iframe")) Object.assign(f.style, { width: `${W}px`, height: `${(r.h - head) / k}px`, transform: `scale(${k})` });
    }
    const z = $("#pzoom");
    if (z) z.textContent = k < 1 ? `${Math.round(k * 100)}%` : "";
  }
  addEventListener("resize", layout);

  function paintT() {
    const e = ease(P.t);
    const st = $("#pstage");
    st.querySelectorAll('[data-card="stack"] iframe[data-side="base"]').forEach((f) => { f.style.opacity = 1 - e; f.style.pointerEvents = e < 0.5 ? "auto" : "none"; });
    st.querySelectorAll('[data-card="stack"] iframe[data-side="work"]').forEach((f) => { f.style.opacity = hasBase() ? e : 1; f.style.pointerEvents = e >= 0.5 || !hasBase() ? "auto" : "none"; });
    st.querySelectorAll('.plabel[data-l="base"]').forEach((l) => (l.style.opacity = 1 - e));
    st.querySelectorAll('.plabel[data-l="work"]').forEach((l) => (l.style.opacity = hasBase() ? e : 1));
    st.querySelectorAll('[data-card="stack"] .pframe-h i').forEach((i) => (i.className = e < 0.5 && hasBase() ? "sdot-base" : "sdot-work"));
    const shownSide = e < 0.5 && hasBase() ? "base" : "work";
    st.querySelectorAll('[data-card="stack"] .perr').forEach((el) => (el.hidden = el.dataset.err !== shownSide));
    $("#pA").classList.toggle("is-on", P.t < 0.5 && hasBase());
    $("#pB").classList.toggle("is-on", P.t >= 0.5 || !hasBase());
    $("#pA").disabled = !hasBase() || P.side || P.themes;
    $("#pB").disabled = !hasBase() || P.side || P.themes;
    $("#pplay").disabled = !hasBase() || P.side || P.themes;
  }
  function animateTo(target, dur = 900) {
    if (!hasBase()) return ctx.toast("Snapshot a Before first (top right)");
    if (P.side || P.themes) return;
    cancelAnimationFrame(P.anim);
    const from = P.t, t0 = performance.now(), d = (Math.abs(target - from) || 1) * dur;
    const step = (now) => { const k = Math.min(1, (now - t0) / d); P.t = from + (target - from) * k; paintT(); if (k < 1) P.anim = requestAnimationFrame(step); };
    P.anim = requestAnimationFrame(step);
  }
  function play() { if (P.t > 0.99) { P.t = 0; paintT(); setTimeout(() => animateTo(1), 300); } else animateTo(1); }
  function paintErrors() {
    document.querySelectorAll(".perr").forEach((el) => {
      const msg = P.errors[`${P.sel}|${el.dataset.err}`];
      el.textContent = msg ? `⚠ ${msg}` : "";
      el.title = msg || "";
    });
  }

  addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || !String(d.type).startsWith("lathe:")) return;
    if (!P.harness?.url || e.origin !== harnessOrigin()) return;
    if (d.type === "lathe:ready") {
      P.variants[d.id] = d.variants;
      delete P.errors[`${d.id}|${d.side}`];
      if (d.id === P.sel) { renderChrome(); paintErrors(); renderPanel(); }
    }
    if (d.type === "lathe:error") {
      P.errors[`${d.id}|${d.side}`] = d.message.slice(0, 160);
      if (d.id === P.sel) { paintErrors(); renderPanel(); }
    }
  });

  // ---------- dock + top chrome ----------
  function renderChrome() {
    const p = part(P.sel);
    const vs = (p && P.variants[p.id]) || ["default"];
    $("#pVariant").innerHTML = vs.map((v) => `<option ${v === (P.variant[p?.id] || vs[0]) ? "selected" : ""}>${esc(v)}</option>`).join("");
    $("#pVariant").disabled = vs.length < 2;
    $("#pWidths").innerHTML = WIDTHS.map(([l, w, name], i) => `<button class="${P.width === w ? "is-on" : ""}" data-w="${w}" title="${name}${w ? ` · ${w}px` : ""} (${(i + 1) % 4})">${l}</button>`).join("");
    $("#pWidths").querySelectorAll("button").forEach((b) => (b.onclick = () => { P.width = +b.dataset.w; renderChrome(); layout(); }));
    $("#pSide").classList.toggle("is-on", P.side);
    $("#pSide").disabled = !hasBase();
    $("#pThemes").classList.toggle("is-on", P.themes);
    $("#pThemes").hidden = ctx.themes().length < 2;
    const b = P.harness?.base;
    $("#pbase").innerHTML = b ? `Before <b>${esc(b.ref)}</b> <span class="mono">${esc(b.commit.slice(0, 7))}</span>` : `<span class="muted">No Before yet</span>`;
    $("#psnap").textContent = b ? "Re-snapshot" : "Snapshot HEAD";
    paintT();
  }
  $("#pA").onclick = () => animateTo(0);
  $("#pB").onclick = () => animateTo(1);
  $("#pplay").onclick = play;
  $("#pSide").onclick = () => { if (!hasBase()) return; P.side = !P.side; if (P.side) P.themes = false; renderChrome(); renderFrames(); };
  $("#pThemes").onclick = () => { P.themes = !P.themes; if (P.themes) P.side = false; renderChrome(); renderFrames(); };
  $("#pVariant").onchange = (e) => { P.variant[P.sel] = e.target.value; renderFrames(); };
  $("#preload").onclick = () => { P.frameKey = ""; renderFrames(); };
  $("#psnap").onclick = async () => {
    ctx.toast("Snapshotting HEAD as Before…");
    P.harness = await api("/api/parts/base", post({ ref: "HEAD" }));
    P.frameKey = ""; renderChrome(); renderFrames(); ctx.toast("Before = HEAD");
  };

  // ---------- panel ----------
  document.querySelectorAll("#ppanel .ptabs button").forEach((b) => (b.onclick = () => { P.panel = b.dataset.p; renderPanel(); }));
  function renderPanel() {
    document.querySelectorAll("#ppanel .ptabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.p === P.panel));
    const el = $("#ppbody");
    if (!P.inv) { el.innerHTML = ""; return; }
    el.innerHTML = P.panel === "brief" ? briefHTML() : detailsHTML();
    el.querySelectorAll("[data-src]").forEach((x) => (x.onclick = () => { navigator.clipboard?.writeText(x.dataset.src); ctx.toast("Copied"); }));
    el.querySelectorAll("[data-part]").forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); select(x.dataset.part); }));
    el.querySelectorAll("[data-page]").forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); ctx.showOnMap(x.dataset.page); }));
    el.querySelectorAll("[data-resolve]").forEach((b) => (b.onclick = async () => { ctx.setComments(await api("/api/comments", post({ action: "resolve", id: b.dataset.resolve }))); renderPanel(); }));
    const form = el.querySelector("#pform");
    if (form) form.onsubmit = async (ev) => {
      ev.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      ctx.setComments(await api("/api/comments", post({ map: "parts", target: `part:${P.sel}`, text })));
      renderPanel(); ctx.toast("Comment saved for your agent");
    };
    const save = el.querySelector("#psave");
    if (save) save.onclick = async () => { const r = await api("/api/parts/brief", post({ markdown: brief() })); ctx.toast(`Saved ${r.path}`); };
    const copy = el.querySelector("#pcopy");
    if (copy) copy.onclick = () => { navigator.clipboard?.writeText(brief()); ctx.toast("Brief copied"); };
  }

  function detailsHTML() {
    const p = part(P.sel);
    if (!p) return `<p class="muted">Pick a component.</p>`;
    const L = [];
    const kind = !p.exported ? "local component" : p.global ? "global" : p.kind;
    L.push(`<div class="label">${esc(kind)} · used ${p.instances}×${P.changed.includes(p.file) ? ` · <span class="pill added">edited</span>` : ""}</div><h3 class="h">${esc(p.name)}</h3>`);
    const errs = ["work", "base"].map((s) => P.errors[`${p.id}|${s}`] && `<div class="errbox"><b>${s === "base" ? "Before" : "After"} failed to render</b>${esc(P.errors[`${p.id}|${s}`])}</div>`).filter(Boolean);
    L.push(...errs);
    L.push(`<div class="label">Source</div><div class="field src" data-src="${esc(`${p.file}:${p.line}`)}">${esc(p.file)}:${p.line}<span class="muted">copy</span></div>`);
    if (p.props.length) L.push(`<div class="label">Props · ${p.props.length}</div><div class="box">${p.props.map((x) => `<div><span class="mono" style="color:var(--ink)">${esc(x.name)}${x.optional ? "?" : ""}</span><span class="mono muted" style="margin-left:auto;text-align:right">${esc(x.type || "")}</span></div>`).join("")}</div>`);
    const vs = P.variants[p.id];
    L.push(`<div class="label">Fixture</div><div class="field src" data-src="${esc(`${dir()}/ui/fixtures/${safeId(p.id)}.json`)}">${esc(dir())}/ui/fixtures/${esc(safeId(p.id))}.json<span class="muted">copy</span></div>`);
    L.push(`<p class="muted" style="font-size:12px">${vs && !(vs.length === 1 && vs[0] === "default") ? `Variants: ${vs.map(esc).join(", ")}.` : "No fixture yet: it renders with no props."} Ask your agent to write props per variant here; providers and API mocks go in <span class="mono">${esc(dir())}/ui/wrapper.tsx</span>.</p>`);
    if (p.pages.length) L.push(`<div class="label">Shows on</div><div class="box">${p.pages.map((id) => `<a href="#" data-page="${esc(id)}">${esc(ctx.pageLabel(id))}<span class="muted" style="margin-left:auto">show on map →</span></a>`).join("")}</div>`);
    else if (p.global) L.push(`<div class="label">Shows on</div><div class="field">Every page (rendered from App)</div>`);
    if (p.usedBy.length) L.push(`<div class="label">Used in</div><div class="box">${p.usedBy.map((u) => `<div><span class="mono">${esc(u.file)}</span><span class="muted" style="margin-left:auto">×${u.count}</span></div>`).join("")}</div>`);
    if (p.dupes.length) L.push(`<div class="label">Possible duplicates</div><div class="box">${p.dupes.map((id) => `<a href="#" data-part="${esc(id)}"><span class="dot changed"></span>${esc(part(id)?.name || id)}<span class="mono muted" style="margin-left:auto">${esc(base(id.split("#")[0]))}</span></a>`).join("")}</div>`);
    const s = p.signals || {};
    L.push(`<div class="label">Signals</div><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${s.lines ?? "–"}</b><span>lines in file</span></div><div class="stat"><b>${s.inlineStyles ?? "–"}</b><span>inline styles</span></div><div class="stat"><b>${s.hardcodedColors ?? "–"}</b><span>raw colours</span></div></div>`);
    if (p.status || p.notes) L.push(`<div class="label">Notes</div>${p.status ? `<p><span class="pill changed">${esc(p.status)}</span></p>` : ""}${p.notes ? `<p>${esc(p.notes)}</p>` : ""}`);
    const cs = ctx.comments().filter((c) => c.target === `part:${p.id}`);
    L.push(`<div class="label">Comments</div>`);
    L.push(cs.map((c) => `<div class="comment ${c.author}${c.resolved ? " resolved" : ""}"><small><span>${esc(c.author)}</span><button data-resolve="${esc(c.id)}">${c.resolved ? "Reopen" : "Resolve"}</button></small>${esc(c.text)}</div>`).join("") || `<p class="muted">None yet.</p>`);
    L.push(`<form id="pform"><textarea name="text" placeholder="What should change about ${esc(p.name)}?"></textarea><button class="btn">Add comment</button></form>`);
    return L.join("");
  }

  const brief = () => buildPartsBrief(P.inv, { changed: P.changed, base: P.harness?.base, comments: ctx.comments() });
  function briefHTML() {
    const html = brief().split("\n").map((l) => {
      const inl = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/_([^_]+)_/g, "<i>$1</i>");
      if (l.startsWith("## ")) return `<h2>${inl(l.slice(3))}</h2>`;
      if (l.startsWith("# ")) return `<h1>${inl(l.slice(2))}</h1>`;
      if (l.startsWith("- ")) return `<div>· ${inl(l.slice(2))}</div>`;
      return l ? `<p>${inl(l)}</p>` : "";
    }).join("");
    return `<div style="display:flex;gap:6px;margin-bottom:14px"><button class="btn" id="psave" style="margin:0">Save brief.md</button><button class="btn ghost" id="pcopy" style="margin:0">Copy</button></div><div class="md">${html}</div>`;
  }

  // ---------- keys (called by app.js while in Parts) ----------
  function onKey(e) {
    const k = e.key;
    if (k === " ") { e.preventDefault(); play(); return true; }
    if (k === "ArrowLeft") { animateTo(0); return true; }
    if (k === "ArrowRight") { animateTo(1); return true; }
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const ids = [...document.querySelectorAll("#plistBody .prow")].map((b) => b.dataset.id);
      const i = ids.indexOf(P.sel);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (k === "ArrowDown" ? 1 : -1)))];
      if (next) select(next);
      return true;
    }
    if (k.toLowerCase() === "s" && !e.metaKey) { $("#pSide").click(); return true; }
    if (k === "T" || (k === "t" && e.shiftKey)) { $("#pThemes").click(); return true; }
    if (k === "t") { ctx.cycleTheme(); return true; }
    if (/^[0-3]$/.test(k)) { P.width = [0, 375, 768, 1280][+k]; renderChrome(); layout(); return true; }
    if (k === "/") { e.preventDefault(); $("#psearch").focus(); return true; }
    if (k.toLowerCase() === "r" && !e.metaKey) { $("#preload").click(); return true; }
    return false;
  }

  // Map → Parts: which component a map section/page points at.
  function partFor(source, component) {
    if (!P.inv || !source) return null;
    const file = source.replace(/:\d+(-\d+)?$/, "");
    const inFile = P.inv.parts.filter((p) => p.file === file);
    return (component && inFile.find((p) => p.name === component)) || inFile.find((p) => p.export === "default") || inFile[0] || null;
  }

  const onTheme = () => { P.frameKey = ""; renderChrome(); renderFrames(); };
  return { enter, refresh, select, onKey, layout, partFor, onTheme, get loaded() { return !!P.inv; } };
}
