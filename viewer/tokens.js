// Tokens: the foundations workbench. Inventory on the left, specimens rendered
// by the app's own build in the middle (Before = source values, After = with
// your live overrides), the token's purpose, reach and checks on the right.
import { resolver, parseColor, toHex } from "/lib/tokens-core.mjs";
import { buildTokensBrief, contrastWith, involves } from "/lib/tokens-brief.mjs";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const GROUPS = [["color", "Color"], ["type", "Type"], ["space", "Space"], ["radius", "Radius"], ["shadow", "Shadow"], ["motion", "Motion"], ["other", "Other"]];

export function initTokens(ctx) {
  const T = { inv: null, ov: {}, harness: null, sel: null, group: "color", filter: "all", q: "", t: 1, themes: false, panel: "token", frameKey: "", anim: null, confirm: false };
  const api = (u, o) => fetch(u, o).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const post = (b) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) });
  const tok = (n) => T.inv?.tokens.find((t) => t.name === n);
  const themedTok = (t) => new Set(Object.values(t.resolved || {})).size > 1;
  const edited = (n) => !!T.ov[n] && Object.values(T.ov[n]).some((v) => v != null && v !== "");
  const theme = () => ctx.theme();
  const R = () => resolver(T.inv.tokens, T.ov);
  const nOv = () => Object.keys(T.ov).filter(edited).length;

  async function refresh() {
    const [inv, h] = await Promise.all([api("/api/tokens"), api("/api/harness")]);
    T.ov = inv.overrides || {};
    T.inv = inv;
    T.harness = h;
    ctx.setThemes(inv.themes);
    if (!T.sel || !tok(T.sel)) T.sel = inv.tokens.find((t) => t.group === T.group)?.name || null;
    renderList(); renderChrome(); renderFrames();
    if (!document.activeElement?.closest("#tpbody")) renderPanel(); // don't steal focus mid-edit
  }
  async function enter() {
    if (!T.inv) await refresh();
    if (T.harness?.state === "idle") { renderFrames(); T.harness = await api("/api/harness/start", post()); }
    renderFrames(); renderChrome(); layout();
  }
  function select(name, scroll = true) {
    const t = tok(name);
    if (!t) return;
    T.sel = name;
    T.confirm = false;
    if (t.group !== T.group) { T.group = t.group; T.frameKey = ""; renderFrames(); }
    ctx.setHash(`tokens/${encodeURIComponent(name)}`);
    renderList(); renderPanel(); tellFrames(scroll);
    $(`#tlistBody [data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // ---------- list ----------
  const issues = () => {
    const c = T.inv.checks;
    const set = new Set([...c.dupes.flatMap((d) => d.names), ...c.drift.map((d) => d.suggest).filter(Boolean)]);
    for (const x of contrastWith(T.inv, T.ov).filter((x) => !x.pass)) for (const t of T.inv.tokens) if (involves(T.inv, x.fg + " " + x.bg, t.name)) set.add(t.name);
    return set;
  };
  function visible() {
    const q = T.q.toLowerCase(), iss = T.filter === "issues" ? issues() : null;
    return T.inv.tokens.filter((t) => {
      if (q && !`${t.name} ${t.comment} ${t.resolved.default}`.toLowerCase().includes(q)) return false;
      if (T.filter === "edited") return edited(t.name);
      if (T.filter === "unused") return T.inv.checks.unused.includes(t.name);
      if (T.filter === "themed") return themedTok(t);
      if (T.filter === "issues") return iss.has(t.name);
      return t.group === T.group;
    });
  }
  function preview(t) {
    const v = R().value(t.name, theme());
    if (t.group === "color") return `<span class="tsw" style="background:${esc(v)}"></span>`;
    if (t.group === "type") return `<span class="tglyph">Aa</span>`;
    if (t.group === "space") { const px = parseFloat(v) * (/rem/.test(v) ? 16 : 1); return `<span class="tbar"><i style="width:${Math.max(2, Math.min(26, px / 3))}px"></i></span>`; }
    if (t.group === "radius") return `<span class="trad" style="border-radius:${esc(v)}"></span>`;
    return `<span class="tglyph">${t.group === "shadow" ? "▢" : t.group === "motion" ? "↝" : "·"}</span>`;
  }
  function renderList() {
    if (!T.inv) return;
    const all = T.inv.tokens;
    const chips = GROUPS.filter(([g]) => all.some((t) => t.group === g)).map(([g, l]) => [g, l, all.filter((t) => t.group === g).length, "group"]);
    const iss = issues();
    const extra = [["themed", "Themed", T.inv.themes.length > 1 ? all.filter(themedTok).length : 0], ["edited", "Edited", nOv()], ["issues", "Issues", iss.size], ["unused", "Unused", T.inv.checks.unused.length]].filter((x) => x[2]);
    $("#tfilters").innerHTML = chips.map(([g, l, n]) => `<button class="chip${T.filter === "all" && T.group === g ? " is-on" : ""}" data-g="${g}">${l} <span>${n}</span></button>`).join("")
      + extra.map(([f, l, n]) => `<button class="chip${T.filter === f ? " is-on" : ""}" data-f="${f}">${l} <span>${n}</span></button>`).join("");
    const list = visible();
    $("#tlistBody").innerHTML = list.map((t) => {
      const v = R().value(t.name, theme()) ?? "";
      return `<button class="prow trow${t.name === T.sel ? " is-sel" : ""}" data-name="${esc(t.name)}">${preview(t)}
        <span class="pname"><b>${esc(t.name.replace(/^--/, ""))}</b><small>${esc(String(v).slice(0, 40))}</small></span>
        ${edited(t.name) ? `<i class="pdot chg" title="Overridden"></i>` : ""}
        <span class="pcount" title="Direct uses · tokens built on it">${t.uses || t.usedBy.length ? `${t.uses}${t.usedBy.length ? `+${t.usedBy.length}` : ""}` : "—"}</span></button>`;
    }).join("") || `<p class="muted" style="padding:12px">Nothing here.</p>`;
    $("#tlistBody").querySelectorAll(".trow").forEach((b) => (b.onclick = () => select(b.dataset.name)));
    $("#tfilters").querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { T.filter = "all"; T.group = b.dataset.g; T.frameKey = ""; renderList(); renderFrames(); renderChrome(); }));
    $("#tfilters").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => {
      const was = T.filter;
      T.filter = b.dataset.f;
      if (T.filter === "themed" && !T.themes) T.themes = true; // themed tokens are best read side by side
      if ((was === "themed") !== (T.filter === "themed")) { T.frameKey = ""; renderFrames(); renderChrome(); }
      renderList();
    }));
  }
  $("#tsearch").oninput = (e) => { T.q = e.target.value; renderList(); };
  $("#trescan").onclick = async () => { await api("/api/tokens/scan", post()); T.frameKey = ""; await refresh(); ctx.toast("Tokens re-scanned"); };

  // ---------- specimen frames ----------
  const origin = () => { const u = new URL(T.harness.url); u.hostname = location.hostname; return u.origin; };
  function src(ov, themeId = theme()) {
    const th = T.inv.themes.find((x) => x.id === themeId) || { id: "default" };
    const q = new URLSearchParams({ group: T.group, ov: ov ? "1" : "0", theme: th.id, themed: T.filter === "themed" ? "1" : "0" });
    if (th.attr) { q.set("themeAttr", th.attr); q.set("themeVal", th.value); }
    if (th.cls) q.set("themeCls", th.cls);
    return `${origin()}/__lathe/specimen.html?${q}`;
  }
  function renderFrames() {
    const st = $("#tstage"), H = T.harness;
    if (!T.inv || !H) return;
    if (H.state !== "ready") {
      T.frameKey = "";
      st.innerHTML = `<div class="pmsg">${H.state === "error" ? `<b>Couldn't start the app's dev build</b><p>${esc(H.error)}</p>` : `<span class="spin"></span><b>Starting ${esc(H.app || "the app")}'s dev build…</b><p>Specimens render in the app's own CSS and fonts.</p>`}</div>`;
      return;
    }
    const key = [T.group, theme(), H.url, T.themes, T.filter === "themed"].join("|");
    if (key !== T.frameKey && T.themes && T.inv.themes.length > 1) {
      T.frameKey = key;
      st.innerHTML = T.inv.themes.map((th) => `<div class="pframe" data-card="${esc(th.id)}"><div class="pframe-h"><i class="sdot-work"></i>${esc(th.label)} <span>theme · with overrides</span></div><div class="pframe-b"><iframe data-side="work" src="${esc(src(true, th.id))}" title="Tokens (${esc(th.label)})"></iframe></div></div>`).join("");
    } else if (key !== T.frameKey) {
      T.frameKey = key;
      st.innerHTML = `<div class="pframe" data-card="stack"><div class="pframe-h"><i class="sdot-work"></i><span class="plabel" data-l="work">After <span>with your overrides</span></span><span class="plabel" data-l="base">Before <span>source values</span></span></div>
        <div class="pframe-b stack"><iframe data-side="base" src="${esc(src(false))}" title="Tokens before"></iframe><iframe data-side="work" src="${esc(src(true))}" title="Tokens after"></iframe></div></div>`;
    }
    layout(); paintT();
  }
  function layout() {
    const st = $("#tstage");
    if (!st || !document.body.classList.contains("mode-tokens")) return;
    const focus = document.body.classList.contains("is-focus"), narrow = innerWidth <= 900;
    const r = focus ? { x: 24, y: 24, w: innerWidth - 48, h: innerHeight - 48 }
      : narrow ? { x: 8, y: 120 + innerHeight * 0.2 + 8, w: innerWidth - 16, h: innerHeight * 0.58 - (120 + innerHeight * 0.2 + 8) - 60 }
      : { x: 328, y: 80, w: innerWidth - 328 - 392, h: innerHeight - 170 };
    Object.assign(st.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const cards = [...st.querySelectorAll(".pframe")];
    const w = (r.w - 16 * (cards.length - 1)) / Math.max(1, cards.length);
    for (const c of cards) {
      c.style.width = `${w}px`; c.style.height = `${r.h}px`;
      c.querySelector(".pframe-b").style.height = `${r.h - 34}px`;
      c.querySelectorAll("iframe").forEach((f) => Object.assign(f.style, { width: `${w}px`, height: `${r.h - 34}px`, transform: "none" }));
    }
  }
  addEventListener("resize", layout);
  function paintT() {
    const e = ease(T.t), st = $("#tstage");
    const base = st.querySelector('iframe[data-side="base"]'), work = st.querySelector('iframe[data-side="work"]');
    if (base) { base.style.opacity = 1 - e; base.style.pointerEvents = e < 0.5 ? "auto" : "none"; }
    if (work) { work.style.opacity = e; work.style.pointerEvents = e >= 0.5 ? "auto" : "none"; }
    st.querySelectorAll('.plabel[data-l="base"]').forEach((l) => (l.style.opacity = 1 - e));
    st.querySelectorAll('.plabel[data-l="work"]').forEach((l) => (l.style.opacity = e));
    st.querySelectorAll(".pframe-h i").forEach((i) => (i.className = e < 0.5 ? "sdot-base" : "sdot-work"));
    $("#tA").classList.toggle("is-on", T.t < 0.5);
    $("#tB").classList.toggle("is-on", T.t >= 0.5);
  }
  function animateTo(target, dur = 800) {
    cancelAnimationFrame(T.anim);
    const from = T.t, t0 = performance.now(), d = (Math.abs(target - from) || 1) * dur;
    const step = (now) => { const k = Math.min(1, (now - t0) / d); T.t = from + (target - from) * k; paintT(); if (k < 1) T.anim = requestAnimationFrame(step); };
    T.anim = requestAnimationFrame(step);
  }
  function play() { if (!nOv()) return ctx.toast("Edit a token first: After shows your overrides"); if (T.t > 0.99) { T.t = 0; paintT(); setTimeout(() => animateTo(1), 300); } else animateTo(1); }
  function tellFrames(scroll) { $("#tstage").querySelectorAll("iframe").forEach((f) => f.contentWindow?.postMessage({ type: "lathe:select", name: T.sel, scroll }, "*")); }
  addEventListener("message", (e) => {
    if (!T.harness?.url || e.origin !== origin()) return;
    if (e.data?.type === "lathe:token") select(e.data.name, false);
    if (e.data?.type === "lathe:spec-ready") tellFrames(true);
  });

  // ---------- dock ----------
  function renderChrome() {
    const n = nOv();
    $("#tcount").textContent = n ? `${n} override${n > 1 ? "s" : ""}` : "No overrides";
    $("#tclear").disabled = !n;
    $("#tA").disabled = $("#tB").disabled = $("#tplay").disabled = !n || T.themes;
    $("#tThemes").classList.toggle("is-on", T.themes);
    $("#tThemes").hidden = (T.inv?.themes.length || 0) < 2;
    paintT();
  }
  $("#tA").onclick = () => animateTo(0);
  $("#tB").onclick = () => animateTo(1);
  $("#tplay").onclick = play;
  $("#tThemes").onclick = () => { T.themes = !T.themes; renderChrome(); renderFrames(); };
  $("#tclear").onclick = async () => { T.ov = await api("/api/tokens/overrides", post({ clear: true })); after(); ctx.toast("Overrides cleared"); };

  // ---------- editing ----------
  let debounce;
  function setOverride(name, th, value) {
    T.ov[name] ||= {};
    if (value == null || value === "") delete T.ov[name][th]; else T.ov[name][th] = value;
    if (!Object.keys(T.ov[name]).length) delete T.ov[name];
    clearTimeout(debounce);
    debounce = setTimeout(() => api("/api/tokens/overrides", post({ name, theme: th, value })).catch((e) => ctx.toast(e.message)), 120);
    if (T.t < 1) animateTo(1);
    renderList(); renderChrome(); refreshPanelLive();
  }
  function after() { renderList(); renderChrome(); renderPanel(); }

  // ---------- panel ----------
  document.querySelectorAll("#tpanel .ptabs button").forEach((b) => (b.onclick = () => { T.panel = b.dataset.p; renderPanel(); }));
  function renderPanel() {
    document.querySelectorAll("#tpanel .ptabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.p === T.panel));
    const el = $("#tpbody");
    if (!T.inv) { el.innerHTML = ""; return; }
    el.innerHTML = T.panel === "checks" ? checksHTML() : T.panel === "brief" ? briefHTML() : tokenHTML();
    bindPanel(el);
  }
  function bindPanel(el) {
    el.querySelectorAll("[data-src]").forEach((x) => (x.onclick = () => { navigator.clipboard?.writeText(x.dataset.src); ctx.toast("Copied"); }));
    el.querySelectorAll("[data-tok]").forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); T.panel = "token"; select(x.dataset.tok); }));
    el.querySelectorAll("[data-part]").forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); ctx.openPart(x.dataset.part); }));
    el.querySelectorAll("[data-page]").forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); ctx.showOnMap(x.dataset.page); }));
    el.querySelectorAll("[data-edit]").forEach((inp) => {
      inp.oninput = () => {
        const [name, th] = inp.dataset.edit.split("|");
        const v = inp.type === "color" ? inp.value : inp.value.trim();
        if (inp.type === "color") { const txt = el.querySelector(`input[type=text][data-edit="${CSS.escape(inp.dataset.edit)}"]`); if (txt) txt.value = v; }
        setOverride(name, th, v);
      };
    });
    el.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = () => { const [name, th] = b.dataset.reset.split("|"); setOverride(name, th, null); renderPanel(); }));
    el.querySelectorAll("[data-resolve]").forEach((b) => (b.onclick = async () => { ctx.setComments(await api("/api/comments", post({ action: "resolve", id: b.dataset.resolve }))); renderPanel(); }));
    const form = el.querySelector("#tform");
    if (form) form.onsubmit = async (ev) => {
      ev.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      ctx.setComments(await api("/api/comments", post({ map: "tokens", target: `token:${T.sel}`, text })));
      renderPanel(); ctx.toast("Comment saved for your agent");
    };
    el.querySelector("#tsave")?.addEventListener("click", async () => { const r = await api("/api/tokens/brief", post({ markdown: brief() })); ctx.toast(`Saved ${r.path}`); });
    el.querySelector("#tcopy")?.addEventListener("click", () => { navigator.clipboard?.writeText(brief()); ctx.toast("Brief copied"); });
    el.querySelector("#tapply")?.addEventListener("click", async () => {
      if (!T.confirm) { T.confirm = true; renderPanel(); return; }
      const r = await api("/api/tokens/apply", post());
      T.confirm = false;
      ctx.toast(`Wrote ${r.changed.length} value${r.changed.length === 1 ? "" : "s"} to source${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`);
      T.frameKey = ""; await refresh();
      if (r.skipped.length) { T.panel = "brief"; renderPanel(); }
    });
  }
  // While typing, only the live numbers change: don't rebuild the inputs.
  function refreshPanelLive() {
    const el = $("#tpbody");
    const live = el.querySelector("#tlive");
    if (live) live.innerHTML = liveHTML(tok(T.sel));
    el.querySelectorAll("[data-was]").forEach((x) => (x.hidden = !(T.ov[T.sel] && T.ov[T.sel][x.dataset.was] != null)));
  }

  function liveHTML(t) {
    if (!t) return "";
    const L = [];
    const pairs = contrastWith(T.inv, T.ov).filter((x) => involves(T.inv, `${x.fg} ${x.bg}`, t.name));
    if (pairs.length) {
      L.push(`<div class="label">Contrast · ${pairs.length}</div><div class="box">${pairs.slice(0, 12).map((x) => `<div><span class="dot ${x.pass ? "" : "removed"}" style="${x.pass ? "background:var(--add)" : ""}"></span><span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.selector)}">${esc(x.selector)}</span><span class="muted">${esc(x.theme)}</span><b style="font-weight:500;font-variant-numeric:tabular-nums">${x.before !== x.ratio ? `<span class="muted">${x.before} → </span>` : ""}${x.ratio}</b></div>`).join("")}</div>`);
    }
    return L.join("");
  }

  function tokenHTML() {
    const t = tok(T.sel);
    if (!t) return `<p class="muted">Pick a token.</p>`;
    const L = [];
    L.push(`<div class="label">${esc(t.category)} · ${t.uses} uses${t.usedBy.length ? ` · ${t.usedBy.length} tokens build on it` : ""}</div><h3 class="h mono" style="font-size:17px">${esc(t.name)}</h3>`);
    if (t.comment) L.push(`<div class="intent" style="margin-top:12px">${esc(t.comment)}</div>`);
    // values per theme
    L.push(`<div class="label">Value</div>`);
    for (const th of T.inv.themes) {
      if (th.id !== "default" && t.values[th.id] == null && !(T.ov[t.name]?.[th.id])) continue;
      const source = t.values[th.id] ?? t.values.default;
      const cur = T.ov[t.name]?.[th.id] ?? source;
      const res = R().value(t.name, th.id);
      const c = parseColor(res);
      const key = `${t.name}|${th.id}`;
      L.push(`<div class="tval">${T.inv.themes.length > 1 ? `<span class="tth">${esc(th.label)}</span>` : ""}
        ${t.group === "color" && c ? `<input type="color" data-edit="${esc(key)}" value="${toHex({ ...c, a: 1 }).slice(0, 7)}" aria-label="Pick colour" />` : ""}
        <input type="text" class="tinput mono" data-edit="${esc(key)}" value="${esc(cur)}" spellcheck="false" aria-label="${esc(t.name)} value" />
        <button class="ibtn" data-reset="${esc(key)}" title="Reset to source" aria-label="Reset"><svg viewBox="0 0 16 16" width="13" height="13"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v3h3"/></svg></button></div>
        <div class="twas muted" data-was="${esc(th.id)}" ${T.ov[t.name]?.[th.id] != null ? "" : "hidden"}>Source: <span class="mono">${esc(source)}</span></div>
        ${/var\(/.test(cur) ? `<div class="twas muted">Resolves to <span class="mono">${esc(res)}</span></div>` : ""}`);
    }
    const def = t.defs.default || Object.values(t.defs)[0];
    const srcInfo = T.inv.sources.find((s) => s.file === def?.file);
    L.push(`<div class="label">Defined in</div><div class="field src" data-src="${esc(`${def.file}:${def.line}`)}">${esc(def.file)}:${def.line}<span class="muted">copy</span></div>`);
    if (srcInfo?.generated) L.push(`<p class="muted" style="font-size:12px">Generated file. Changes are made in <span class="mono">${esc(srcInfo.source || "its source")}</span> and regenerated, so Apply leaves this one to the brief.</p>`);
    L.push(`<div id="tlive">${liveHTML(t)}</div>`);
    // reach
    L.push(`<div class="label">Reach</div><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${t.uses + t.usedBy.length}</b><span>refs</span></div><div class="stat"><b>${t.components.length}</b><span>components</span></div><div class="stat"><b>${t.pages.length}</b><span>pages</span></div></div>`);
    if (t.global) L.push(`<p class="muted" style="font-size:12px">Also styles bare elements (body, headings, links…), so it reaches every page.</p>`);
    if (t.refs.length) L.push(`<div class="label">Built from</div><div class="tchips">${t.refs.map((n) => `<a href="#" class="tchip" data-tok="${esc(n)}">${esc(n)}</a>`).join("")}</div>`);
    if (t.usedBy.length) L.push(`<div class="label">Tokens built on it</div><div class="tchips">${t.usedBy.map((n) => `<a href="#" class="tchip" data-tok="${esc(n)}">${esc(n)}</a>`).join("")}</div>`);
    if (t.pages.length) L.push(`<div class="label">Pages</div><div class="tchips">${t.pages.map((id) => `<a href="#" class="tchip" data-page="${esc(id)}">${esc(ctx.pageLabel(id))}</a>`).join("")}</div>`);
    if (t.components.length) L.push(`<div class="label">Components · ${t.components.length}</div><div class="tchips">${t.components.slice(0, 40).map((id) => `<a href="#" class="tchip" data-part="${esc(id)}">${esc(id.split("#")[1])}</a>`).join("")}</div>`);
    const drift = T.inv.checks.drift.filter((d) => d.suggest === t.name);
    if (drift.length) L.push(`<div class="label">Hard-coded instead · ${drift.length}</div><div class="box">${drift.slice(0, 10).map((d) => `<div class="src" data-src="${esc(`${d.file}:${d.line}`)}"><span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.file.split("/").pop())}:${d.line}</span><span class="mono muted">${esc(d.prop)}: ${esc(d.value)}</span></div>`).join("")}</div>`);
    const cs = ctx.comments().filter((c) => c.target === `token:${t.name}`);
    L.push(`<div class="label">Comments</div>`);
    L.push(cs.map((c) => `<div class="comment ${c.author}${c.resolved ? " resolved" : ""}"><small><span>${esc(c.author)}</span><button data-resolve="${esc(c.id)}">${c.resolved ? "Reopen" : "Resolve"}</button></small>${esc(c.text)}</div>`).join("") || `<p class="muted">None yet.</p>`);
    L.push(`<form id="tform"><textarea name="text" placeholder="What should ${esc(t.name)} be, and why?"></textarea><button class="btn">Add comment</button></form>`);
    return L.join("");
  }

  function checksHTML() {
    const c = T.inv.checks, L = [];
    const con = contrastWith(T.inv, T.ov).sort((a, b) => a.ratio - b.ratio);
    const fails = con.filter((x) => !x.pass);
    L.push(`<div class="stats"><div class="stat"><b>${fails.length}</b><span>contrast fails</span></div><div class="stat"><b>${c.drift.length}</b><span>hard-coded</span></div><div class="stat"><b>${c.dupes.length}</b><span>duplicates</span></div><div class="stat"><b>${c.unused.length}</b><span>unused</span></div></div>`);
    L.push(`<div class="label">Contrast · lowest first</div>`);
    L.push(con.length ? `<div class="box">${con.slice(0, 14).map((x) => `<div class="src" data-src="${esc(`${x.file}:${x.line}`)}"><span class="dot" style="background:${x.pass ? "var(--add)" : "var(--del)"}"></span><span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.selector)}">${esc(x.selector)}</span><span class="muted">${esc(x.theme)}</span><b style="font-weight:500">${x.ratio}</b></div>`).join("")}</div>` : `<p class="muted">No colour/background pairs found in the CSS.</p>`);
    const byTok = {};
    for (const d of c.drift) if (d.suggest) byTok[d.suggest] = (byTok[d.suggest] || 0) + 1;
    const noMatch = c.drift.filter((d) => !d.suggest).reduce((a, d) => ((a[d.kind] = (a[d.kind] || 0) + 1), a), {});
    L.push(`<div class="label">Hard-coded values that match a token</div>`);
    L.push(Object.keys(byTok).length ? `<div class="box">${Object.entries(byTok).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, k]) => `<a href="#" data-tok="${esc(n)}"><span class="mono" style="flex:1">${esc(n)}</span><span class="muted">×${k}</span></a>`).join("")}</div>` : `<p class="muted">None.</p>`);
    if (Object.keys(noMatch).length) L.push(`<p class="muted" style="font-size:12px">No matching token: ${Object.entries(noMatch).map(([k, n]) => `${n} ${k}`).join(", ")}. These are either one-offs or missing tokens.</p>`);
    if (c.dupes.length) L.push(`<div class="label">Duplicates</div><div class="box">${c.dupes.map((d) => `<div style="flex-wrap:wrap">${d.names.map((n) => `<a href="#" class="tchip" data-tok="${esc(n)}">${esc(n)}</a>`).join("")}<span class="muted mono" style="margin-left:auto">${esc(d.value)}</span></div>`).join("")}</div>`);
    if (c.unused.length) L.push(`<div class="label">Unused · ${c.unused.length}</div><div class="tchips">${c.unused.map((n) => `<a href="#" class="tchip" data-tok="${esc(n)}">${esc(n)}</a>`).join("")}</div>`);
    return L.join("");
  }

  const brief = () => buildTokensBrief(T.inv, { overrides: T.ov, comments: ctx.comments(), pageLabel: ctx.pageLabel });
  function briefHTML() {
    const n = nOv();
    const html = brief().split("\n").map((l) => {
      const inl = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/_([^_]+)_/g, "<i>$1</i>");
      if (l.startsWith("### ")) return `<h3>${inl(l.slice(4))}</h3>`;
      if (l.startsWith("## ")) return `<h2>${inl(l.slice(3))}</h2>`;
      if (l.startsWith("# ")) return `<h1>${inl(l.slice(2))}</h1>`;
      if (/^\s+- /.test(l)) return `<div style="padding-left:14px">· ${inl(l.trim().slice(2))}</div>`;
      if (l.startsWith("- ")) return `<div>· ${inl(l.slice(2))}</div>`;
      return l ? `<p>${inl(l)}</p>` : "";
    }).join("");
    const writable = Object.keys(T.ov).filter((name) => edited(name) && !T.inv.sources.find((s) => s.file === (tok(name)?.defs.default || {}).file)?.generated).length;
    return `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap"><button class="btn" id="tsave" style="margin:0">Save brief.md</button><button class="btn ghost" id="tcopy" style="margin:0">Copy</button>
      ${n ? `<button class="btn ${T.confirm ? "" : "ghost"}" id="tapply" style="margin:0;${T.confirm ? "background:var(--chg)" : ""}" ${writable ? "" : "disabled title=\"Only generated tokens: edit their source\""}>${T.confirm ? `Confirm: write ${writable} value${writable === 1 ? "" : "s"} to the repo` : "Apply to source…"}</button>` : ""}</div>
      ${T.confirm ? `<p class="muted" style="font-size:12px;margin:0 0 12px">Edits the token files in your working tree (not committed). Generated tokens stay in the brief for your agent.</p>` : ""}<div class="md">${html}</div>`;
  }

  // ---------- keys ----------
  function onKey(e) {
    const k = e.key;
    if (k === " ") { e.preventDefault(); play(); return true; }
    if (k === "ArrowLeft") { if (nOv()) animateTo(0); return true; }
    if (k === "ArrowRight") { if (nOv()) animateTo(1); return true; }
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const ids = [...document.querySelectorAll("#tlistBody .trow")].map((b) => b.dataset.name);
      const i = ids.indexOf(T.sel);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (k === "ArrowDown" ? 1 : -1)))];
      if (next) select(next);
      return true;
    }
    if (k === "/") { e.preventDefault(); $("#tsearch").focus(); return true; }
    if (k === "T" || (k === "t" && e.shiftKey)) { $("#tThemes").click(); return true; }
    if (k === "t") { ctx.cycleTheme(); return true; }
    if (/^[1-7]$/.test(k)) { const g = GROUPS[+k - 1]; if (g && T.inv.tokens.some((t) => t.group === g[0])) { T.filter = "all"; T.group = g[0]; T.frameKey = ""; renderList(); renderFrames(); } return true; }
    return false;
  }

  function onTheme() { T.frameKey = ""; renderList(); renderChrome(); renderFrames(); renderPanel(); }
  return { enter, refresh, select, onKey, layout, onTheme, get loaded() { return !!T.inv; } };
}
