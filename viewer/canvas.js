// Canvas: screens and components on one surface. The map's pages are frames
// (wireframes, or the real page component on demand); every component with
// variants gets a sheet of variants × themes. Frames are the app's own build,
// so a token override shows on every component and screen at once.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const safeId = (id) => id.replace(/[^\w.-]+/g, "_");
const api = (u, o) => fetch(u, o).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
const post = (b) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) });

const PAGE = { w: 1280, h: 800 };          // page frame, natural size
const CELL = { w: 560, h: 320 };           // component cell, natural size
const GAP = 48, HEAD = 64, SECTION = 240;  // world units
const MAX_LIVE = 40;                       // mounted iframes at once
// Findings that can sit on a rendered element: not server strings, not file-level counts.
const onScreen = (list) => (list || []).filter((f) => !f.server && !f.count && f.line > 0);
const KIND_COLOR = { header: "#4fb3a9", nav: "#4fb3a9", footer: "#9b87f5", gate: "#7d8592", cta: "#7c83ff" };

export function initCanvas(ctx) {
  const C = {
    inv: null, harness: null, fixtures: {}, smells: [], cells: [], groups: [],
    view: { x: 80, y: 120, k: 0.18 }, sel: null, render: false, allThemes: false, showSmells: false, inspect: false,
    picked: null, entered: false, built: "",
  };
  const stage = $("#cstage"), world = $("#cworld");

  // ---------- data ----------
  async function refresh() {
    const [inv, H, fixtures, smells] = await Promise.all([api("/api/parts"), api("/api/harness"), api("/api/fixtures").catch(() => ({})), api("/api/smells").catch(() => ({ findings: [] }))]);
    Object.assign(C, { inv, harness: H, fixtures, smells: onScreen(smells.findings) });
    if (document.body.classList.contains("mode-canvas")) build();
  }
  async function enter() {
    ctx.setHash("canvas");
    if (!C.inv) await refresh();
    if (C.harness?.state !== "ready") {
      C.harness = await api("/api/harness/start", post());
      C.built = "";
    }
    build();
    C.entered = true;
  }
  const harnessOrigin = () => { const u = new URL(C.harness.url); u.hostname = location.hostname; return u.origin; };
  const variantsOf = (p) => p.stories?.length ? p.stories.map((s) => s.export) : C.fixtures[safeId(p.id)] || null;

  // ---------- layout ----------
  function build() {
    const map = ctx.map();
    const themes = C.allThemes ? ctx.themes() : [ctx.themes().find((t) => t.id === ctx.themeId()) || { id: "default", label: "Default" }];
    const key = [JSON.stringify(map?.nodes?.map((n) => n.id)), C.inv?.parts.length, themes.map((t) => t.id).join(), JSON.stringify(ctx.themeParams()), C.render, C.harness?.url, Object.keys(C.fixtures).join()].join("|");
    if (key === C.built) return paint();
    C.built = key;
    const cells = [], groups = [];
    let y = 0;

    // Screens: the map's pages, by group.
    const nodes = map?.nodes?.filter((n) => n.group !== "no-screen" && n.kind !== "capability") || [];
    if (nodes.length) {
      groups.push({ kind: "title", x: 0, y, text: `Screens · ${nodes.length}`, sub: map.title || "" });
      y += HEAD + 110;
      const perRow = 8;
      const byGroup = {};
      for (const n of nodes) (byGroup[n.group || "main"] ||= []).push(n);
      for (const [g, list] of Object.entries(byGroup)) {
        const label = map.groups?.find((x) => x.id === g)?.label || g;
        groups.push({ kind: "group", x: 0, y, text: label });
        y += 56;
        list.forEach((n, i) => {
          const part = C.inv?.parts.find((p) => p.exported && n.source && p.file === n.source.replace(/:\d+$/, "") && (p.kind === "page" || p.page === n.id));
          cells.push({
            id: `page:${n.id}`, kind: "page", node: n, part, x: (i % perRow) * (PAGE.w + GAP * 2), y: y + Math.floor(i / perRow) * (PAGE.h + HEAD + GAP * 2),
            w: PAGE.w, h: PAGE.h, label: n.label, sub: n.path || "", live: C.render && !!part,
            src: part ? harnessSrc(part, "", "default", 0) : null,
          });
        });
        y += Math.ceil(list.length / perRow) * (PAGE.h + HEAD + GAP * 2) + 40;
      }
      y += SECTION;
    }

    // Components: one sheet per component with variants (stories or fixtures), variants × themes.
    const comps = (C.inv?.parts || []).filter((p) => p.exported && p.kind !== "page" && variantsOf(p))
      .sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name));
    groups.push({ kind: "title", x: 0, y, text: `Components · ${comps.length}`, sub: comps.length ? "variants from stories or fixtures" : "Give components stories or fixtures to see them here" });
    y += HEAD + 120;
    const colW = themes.length * (CELL.w + GAP) + GAP * 2;
    const cols = Math.max(1, Math.floor(7600 / colW));
    const colY = new Array(cols).fill(y);
    for (const p of comps) {
      const vs = variantsOf(p);
      const c = colY.indexOf(Math.min(...colY));
      const x = c * colW, sy = colY[c];
      groups.push({ kind: "sheet", id: p.id, x, y: sy, w: colW - GAP * 2, h: HEAD + vs.length * (CELL.h + HEAD), text: p.name, sub: p.file });
      vs.forEach((v, r) => themes.forEach((th, t) => cells.push({
        id: `part:${p.id}|${v}|${th.id}`, kind: "part", part: p, variant: v, theme: th,
        x: x + t * (CELL.w + GAP), y: sy + HEAD + r * (CELL.h + HEAD), w: CELL.w, h: CELL.h,
        label: v, sub: themes.length > 1 ? th.label : "", live: true, src: harnessSrc(p, v, th.id, 24),
      })));
      colY[c] = sy + HEAD + vs.length * (CELL.h + HEAD) + SECTION / 2;
    }
    C.cells = cells; C.groups = groups;
    world.innerHTML = groups.map((g) => g.kind === "sheet"
      ? `<div class="csheet" data-sheet="${esc(g.id)}" style="left:${g.x - 24}px;top:${g.y - 24}px;width:${g.w + 48}px;height:${g.h + 24}px"><div class="csheet-h"><b>${esc(g.text)}</b><span>${esc(g.sub)}</span></div></div>`
      : `<div class="ctitle ${g.kind}" style="left:${g.x}px;top:${g.y}px"><b>${esc(g.text)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ""}</div>`).join("")
      + cells.map((c, i) => `<div class="ccell ${c.kind}" data-i="${i}" data-id="${esc(c.id)}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h + 40}px">
          <div class="ccell-h"><b>${esc(c.label)}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ""}${c.kind === "page" && !c.part ? `<em>wireframe</em>` : ""}</div>
          <div class="ccell-b" style="height:${c.h}px">${c.kind === "page" && !c.live ? wireframe(c.node) : `<div class="cph">${esc(c.label)}</div>`}</div>
          <div class="cglass"></div></div>`).join("");
    if (!C.moved) fit(); else paint();
    renderPanel();
  }
  function harnessSrc(p, variant, themeId, pad) {
    const q = new URLSearchParams({ file: p.file, name: p.export, id: p.id, side: "work", variant, pad, ...ctx.themeParams(themeId) });
    return `${harnessOrigin()}/__lathe/harness.html?${q}`;
  }
  function wireframe(n) {
    const secs = n.sections || [];
    const h = Math.max(40, Math.min(120, (PAGE.h - 40) / Math.max(1, secs.length) - 10));
    return `<div class="cwire">${secs.map((s) => `<div class="cwire-s" style="height:${h}px;border-color:${KIND_COLOR[s.kind] || "#5b8def"}"><b>${esc(s.label)}</b><span>${esc(s.kind || "")}${s.component ? ` · ${esc(s.component)}` : ""}</span></div>`).join("") || `<div class="cwire-s"><b>No sections mapped</b></div>`}</div>`;
  }

  // ---------- view: pan, zoom, lazy frames ----------
  function paint() {
    const { x, y, k } = C.view;
    world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    stage.style.setProperty("--k", k);
    $("#czoom").textContent = `${Math.round(k * 100)}%`;
    mountVisible();
    highlight();
  }
  function mountVisible() {
    if (C.harness?.state !== "ready") return;
    const { x, y, k } = C.view, W = innerWidth, H = innerHeight;
    const vx0 = -x / k, vy0 = -y / k, vx1 = (W - x) / k, vy1 = (H - y) / k;
    const m = 0.5 * (vx1 - vx0);
    const near = (c, pad) => c.x + c.w > vx0 - pad && c.x < vx1 + pad && c.y + c.h > vy0 - pad && c.y < vy1 + pad;
    const cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
    const want = C.cells.map((c, i) => ({ c, i, d: Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy) }))
      .filter(({ c }) => c.live && c.src && k * c.w > 70 && near(c, m)).sort((a, b) => a.d - b.d).slice(0, MAX_LIVE).map((o) => o.i);
    // Keep frames near the view (no reload churn while panning) unless that crowds out visible ones.
    const keep = new Set(want);
    const mounted = [...world.querySelectorAll(".ccell iframe")];
    const room = MAX_LIVE - want.length;
    let kept = 0;
    for (const f of mounted) {
      const i = +f.closest(".ccell").dataset.i;
      if (keep.has(i)) continue;
      if (kept < room && near(C.cells[i], m * 2)) { kept++; continue; }
      f.closest(".ccell").classList.remove("is-live", "is-ready"); f.remove();
    }
    for (const i of want) {
      const el = world.querySelector(`.ccell[data-i="${i}"]`);
      if (!el || el.querySelector("iframe")) continue;
      const c = C.cells[i];
      const f = document.createElement("iframe");
      f.src = c.src; f.title = c.label; f.loading = "eager";
      f.style.cssText = `width:${c.w}px;height:${c.h}px`;
      el.querySelector(".ccell-b").append(f);
      el.classList.add("is-live");
      el.classList.remove("is-ready");
    }
  }
  const clampK = (k) => Math.max(0.008, Math.min(2, k));
  function zoomAt(px, py, k) {
    const v = C.view, nk = clampK(k);
    v.x = px - (px - v.x) * (nk / v.k); v.y = py - (py - v.y) * (nk / v.k); v.k = nk;
    C.moved = true;
    schedule();
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
  function fit(target) {
    const items = target ? [target] : [...C.cells, ...C.groups.map((g) => ({ x: g.x, y: g.y, w: g.w || 600, h: g.h || 60 }))];
    if (!items.length) return;
    const x0 = Math.min(...items.map((c) => c.x)), y0 = Math.min(...items.map((c) => c.y));
    const x1 = Math.max(...items.map((c) => c.x + c.w)), y1 = Math.max(...items.map((c) => c.y + (c.h || 0) + 40));
    // The free area: below the top bar, above the dock, left of the panel.
    const narrow = innerWidth <= 900;
    const L = 32, T = 84, R = innerWidth - (narrow ? 32 : 376 + 32), B = innerHeight - (narrow ? innerHeight * 0.42 + 80 : 96);
    const W = Math.max(120, R - L), H = Math.max(120, B - T);
    const k = clampK(Math.min(W / (x1 - x0), H / (y1 - y0)) * (target ? 0.94 : 1));
    C.view = { k, x: L + (W - (x1 - x0) * k) / 2 - x0 * k, y: T + (H - (y1 - y0) * k) / 2 - y0 * k };
    paint();
  }
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, C.view.k * Math.exp(-e.deltaY * 0.01));
    else { C.view.x -= e.deltaX; C.view.y -= e.deltaY; C.moved = true; schedule(); }
  }, { passive: false });
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: C.view.x, vy: C.view.y, moved: false, target: e.target };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { C.moved = true; C.view.x = drag.vx + dx; C.view.y = drag.vy + dy; stage.classList.add("is-panning"); schedule(); }
  });
  stage.addEventListener("pointerup", () => {
    if (drag && !drag.moved) clickAt(drag.target);
    drag = null; stage.classList.remove("is-panning");
  });
  addEventListener("resize", () => document.body.classList.contains("mode-canvas") && schedule());
  // Frames that autofocus an input would take the keyboard from the canvas: hand it back
  // unless the human is interacting with a frame (Inspect).
  addEventListener("blur", () => setTimeout(() => {
    if (!document.body.classList.contains("mode-canvas") || C.inspect) return;
    const a = document.activeElement;
    if (a?.tagName === "IFRAME" && stage.contains(a)) { a.blur(); stage.focus({ preventScroll: true }); }
  }, 0));
  // A frame that focuses an input would scroll the stage to reveal it; the view only moves by pan and zoom.
  stage.addEventListener("scroll", () => { stage.scrollTop = 0; stage.scrollLeft = 0; });

  // ---------- selection ----------
  function clickAt(t) {
    const cell = t.closest?.(".ccell"), sheet = t.closest?.(".csheet");
    if (cell) {
      const c = C.cells[+cell.dataset.i];
      C.sel = c.kind === "page" ? { kind: "page", id: c.node.id, node: c.node, part: c.part, cell: c } : { kind: "part", id: c.part.id, part: c.part, cell: c };
    } else if (sheet) {
      const p = C.inv.parts.find((x) => x.id === sheet.dataset.sheet);
      C.sel = p ? { kind: "part", id: p.id, part: p } : null;
    } else C.sel = null;
    C.picked = null;
    highlight(); renderPanel();
  }
  function highlight() {
    const s = C.sel;
    world.classList.toggle("has-sel", !!s);
    world.querySelectorAll(".ccell, .csheet").forEach((el) => el.classList.remove("is-sel", "is-rel"));
    if (!s) return;
    if (s.kind === "part") {
      world.querySelector(`.csheet[data-sheet="${CSS.escape(s.id)}"]`)?.classList.add("is-sel");
      for (const pg of s.part.pages || []) world.querySelector(`.ccell[data-id="${CSS.escape(`page:${pg}`)}"]`)?.classList.add("is-rel");
      world.querySelectorAll(".ccell.part").forEach((el) => { if (C.cells[+el.dataset.i].part.id === s.id) el.classList.add("is-rel"); });
    } else {
      world.querySelector(`.ccell[data-id="${CSS.escape(`page:${s.id}`)}"]`)?.classList.add("is-sel");
      for (const p of C.inv.parts) if (p.pages?.includes(s.id)) world.querySelector(`.csheet[data-sheet="${CSS.escape(p.id)}"]`)?.classList.add("is-rel");
    }
  }
  function renderPanel() {
    const el = $("#cpbody"), s = C.sel, k = C.picked;
    const L = [];
    if (k) {
      L.push(`<div class="label">Picked · <span class="mono">${esc(k.tag)}</span>${k.owner ? ` in ${esc(k.owner)}` : ""} · <a href="#" id="cPickClear">clear</a></div><div class="field src" data-src="${esc(`${k.file}:${k.line}`)}">${esc(k.file)}:${k.line}<span class="muted">copy</span></div>`);
      if (k.uses.length) L.push(`<div class="label">Tokens it uses</div><div class="box">${k.uses.map((u) => `<div style="align-items:flex-start"><span class="mono muted" style="min-width:100px">${esc(u.prop)}</span><span style="margin-left:auto;text-align:right;display:grid;gap:2px">${u.tokens.map((t) => `<a href="#" class="mono" data-tok="${esc(t)}">${esc(t)} <span class="muted">${esc((k.resolved[t] || "").slice(0, 22))}</span></a>`).join("")}</span></div>`).join("")}</div>`);
    }
    if (!s) {
      const parts = C.cells.filter((c) => c.kind === "part").length, pages = C.cells.filter((c) => c.kind === "page").length;
      L.push(`<div class="label">Canvas</div><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${pages}</b><span>screens</span></div><div class="stat"><b>${C.groups.filter((g) => g.kind === "sheet").length}</b><span>components</span></div><div class="stat"><b>${parts}</b><span>variants shown</span></div></div>`);
      if (C.showSmells) L.push(`<div class="label">Smells · ${C.smells.length}</div>${C.smells.length ? `<div class="box">${Object.entries(C.smells.reduce((a, f) => ((a[f.rule] = (a[f.rule] || 0) + 1), a), {})).map(([r, n]) => `<div><span class="mono">${esc(r)}</span><span class="muted" style="margin-left:auto">${n}</span></div>`).join("")}</div>` : `<p class="muted" style="font-size:12px">No smells.json yet: run <span class="mono">lathe smells &lt;repo&gt;</span>.</p>`}`);
    } else if (s.kind === "part") {
      const p = s.part;
      L.push(`<div class="label">Component · used ${p.instances}×</div><h3 class="h">${esc(p.name)}</h3><div class="field src" data-src="${esc(`${p.file}:${p.line}`)}">${esc(p.file)}:${p.line}<span class="muted">copy</span></div>`);
      L.push(`<p><a href="#" data-open-part="${esc(p.id)}">Open in Parts →</a></p>`);
      L.push(`<div class="label">Shows on · ${p.pages.length}</div>${p.pages.length ? `<div class="box">${p.pages.map((id) => `<a href="#" data-goto="page:${esc(id)}">${esc(ctx.pageLabel(id))}</a>`).join("")}</div>` : `<p class="muted" style="font-size:12px">${p.global ? "Every page (rendered from App)." : "No mapped page renders it."}</p>`}`);
    } else {
      const n = s.node;
      L.push(`<div class="label">Screen${n.path ? ` · <span class="mono">${esc(n.path)}</span>` : ""}</div><h3 class="h">${esc(n.label)}</h3>`);
      if (n.source) L.push(`<div class="field src" data-src="${esc(n.source)}">${esc(n.source)}<span class="muted">copy</span></div>`);
      L.push(`<p><a href="#" data-map="${esc(n.id)}">Show on map →</a>${s.part ? ` · <a href="#" data-open-part="${esc(s.part.id)}">Open in Parts →</a>` : ""}</p>`);
      const on = C.inv.parts.filter((p) => p.pages?.includes(n.id) && p.kind !== "page");
      L.push(`<div class="label">Components on it · ${on.length}</div>${on.length ? `<div class="box">${on.map((p) => `<a href="#" data-goto-sheet="${esc(p.id)}">${esc(p.name)}<span class="mono muted" style="margin-left:auto">${esc(p.file.split("/").pop())}</span></a>`).join("")}</div>` : ""}`);
      if (n.sections?.length) L.push(`<div class="label">Sections · ${n.sections.length}</div><div class="box">${n.sections.map((x) => `<div><span>${esc(x.label)}</span><span class="mono muted" style="margin-left:auto">${esc(x.kind || "")}</span></div>`).join("")}</div>`);
    }
    el.innerHTML = L.join("");
    el.querySelectorAll("[data-src]").forEach((x) => (x.onclick = () => { navigator.clipboard?.writeText(x.dataset.src); ctx.toast("Copied"); }));
    el.querySelectorAll("[data-open-part]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); ctx.openPart(x.dataset.openPart); }));
    el.querySelectorAll("[data-map]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); ctx.showOnMap(x.dataset.map); }));
    el.querySelectorAll("[data-tok]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); ctx.openToken(x.dataset.tok); }));
    el.querySelectorAll("[data-goto]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); const c = C.cells.find((c) => c.id === x.dataset.goto); if (c) { C.sel = { kind: "page", id: c.node.id, node: c.node, part: c.part, cell: c }; fit(c); renderPanel(); } }));
    el.querySelectorAll("[data-goto-sheet]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); const g = C.groups.find((g) => g.id === x.dataset.gotoSheet); const p = C.inv.parts.find((p) => p.id === x.dataset.gotoSheet); if (g && p) { C.sel = { kind: "part", id: p.id, part: p }; fit(g); renderPanel(); } }));
    $("#cPickClear")?.addEventListener("click", (e) => { e.preventDefault(); C.picked = null; broadcast({ type: "lathe:inspect", on: C.inspect, clear: true }); api("/api/selection", post({ clear: true })).catch(() => {}); renderPanel(); });
  }

  // ---------- frames: inspect, smells ----------
  const broadcast = (msg) => world.querySelectorAll("iframe").forEach((f) => f.contentWindow?.postMessage(msg, harnessOrigin()));
  addEventListener("message", (e) => {
    const d = e.data;
    if (!document.body.classList.contains("mode-canvas") || !d || !String(d.type).startsWith("lathe:") || !C.harness?.url || e.origin !== harnessOrigin()) return;
    if (d.type === "lathe:ready" || d.type === "lathe:error") [...world.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source)?.closest(".ccell")?.classList.add("is-ready");
    if (d.type === "lathe:ready") {
      if (C.inspect) e.source?.postMessage({ type: "lathe:inspect", on: true }, harnessOrigin());
      if (C.showSmells) e.source?.postMessage({ type: "lathe:smells", list: C.smells }, harnessOrigin());
    }
    if (d.type === "lathe:picked") {
      C.picked = d.el;
      const cell = [...world.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source)?.closest(".ccell");
      const c = cell && C.cells[+cell.dataset.i];
      if (c) C.sel = c.kind === "page" ? { kind: "page", id: c.node.id, node: c.node, part: c.part, cell: c } : { kind: "part", id: c.part.id, part: c.part, cell: c };
      api("/api/selection", post({ part: c?.part?.id || null, page: c?.kind === "page" ? c.node.id : null, variant: c?.variant || null, side: "work", theme: c?.theme?.id || ctx.themeId(), args: {}, element: d.el })).catch(() => {});
      highlight(); renderPanel();
    }
  });
  function setInspect(on) {
    C.inspect = on;
    stage.classList.toggle("is-inspect", on);
    broadcast({ type: "lathe:inspect", on });
    chrome();
  }
  function chrome() {
    $("#cRender").classList.toggle("is-on", C.render);
    $("#cThemes").classList.toggle("is-on", C.allThemes);
    $("#cThemes").hidden = ctx.themes().length < 2;
    $("#cSmells").classList.toggle("is-on", C.showSmells);
    $("#cInspect").classList.toggle("is-on", C.inspect);
    $("#cInspect").disabled = !C.harness?.tags;
  }
  $("#cRender").onclick = () => { C.render = !C.render; build(); chrome(); };
  $("#cThemes").onclick = () => { C.allThemes = !C.allThemes; build(); chrome(); };
  $("#cSmells").onclick = async () => {
    C.showSmells = !C.showSmells;
    if (C.showSmells) C.smells = onScreen((await api("/api/smells").catch(() => ({ findings: [] }))).findings);
    broadcast({ type: "lathe:smells", list: C.showSmells ? C.smells : [] });
    chrome(); renderPanel();
  };
  $("#cInspect").onclick = () => C.harness?.tags && setInspect(!C.inspect);
  $("#cFit").onclick = () => fit();
  $("#cReload").onclick = () => { world.querySelectorAll("iframe").forEach((f) => { f.closest(".ccell").classList.remove("is-live"); f.remove(); }); mountVisible(); };

  function onKey(e) {
    const k = e.key;
    if (k.toLowerCase() === "f" && !e.metaKey) { fit(C.sel?.cell || (C.sel && C.groups.find((g) => g.id === C.sel.id)) || undefined); return true; }
    if (k === "0" && !e.metaKey) { fit(); return true; }
    if (k.toLowerCase() === "i" && !e.metaKey) { $("#cInspect").click(); return true; }
    if (k === "T" || (k === "t" && e.shiftKey)) { $("#cThemes").click(); return true; }
    if (k === "t") { ctx.cycleTheme(); return true; }
    if (k.toLowerCase() === "r" && !e.metaKey) { $("#cReload").click(); return true; }
    const mid = () => [innerWidth <= 900 ? innerWidth / 2 : (innerWidth - 376) / 2, innerHeight / 2];
    if (k === "=" || k === "+") { zoomAt(...mid(), C.view.k * 1.25); return true; }
    if (k === "-") { zoomAt(...mid(), C.view.k / 1.25); return true; }
    if (k === "Escape") { if (C.inspect) setInspect(false); else { C.sel = null; C.picked = null; highlight(); renderPanel(); } return true; }
    return false;
  }
  // The layout key covers the map's pages and the themes, so this rebuilds only when they changed.
  function onTheme() { if (document.body.classList.contains("mode-canvas") && C.inv) { build(); chrome(); } }

  return {
    enter: async () => { await enter(); chrome(); renderPanel(); },
    refresh, onKey, onTheme, layout: () => schedule(),
    get loaded() { return !!C.inv; },
  };
}
