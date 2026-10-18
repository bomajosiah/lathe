import { diffMaps, describe } from "/lib/diff.mjs";
import { buildBrief } from "/lib/brief.mjs";
import { initParts } from "/parts.js";
import { initTokens } from "/tokens.js";

// ---------- geometry ----------
const NW = 212, HEAD = 52, SH = 28, SG = 3, PAD = 8, EMPTY_H = 58, LEVEL_GAP = 72, SIB_GAP = 28, GROUP_GAP = 130;
const PANEL_W = 376; // right panel incl. margin
const nodeH = (n) => (n.sections?.length ? HEAD + n.sections.length * (SH + SG) - SG + PAD : EMPTY_H);

function layout(map) {
  const nodes = new Map(), sections = new Map(), groups = [];
  if (!map) return { nodes, sections, groups };
  const groupOrder = (map.groups || []).map((g) => g.id);
  for (const n of map.nodes) if (!groupOrder.includes(n.group || "main")) groupOrder.push(n.group || "main");
  let y = 0;
  for (const gid of groupOrder) {
    const members = map.nodes.filter((n) => (n.group || "main") === gid);
    if (!members.length) continue;
    const ids = new Set(members.map((n) => n.id));
    const kids = new Map(members.map((n) => [n.id, []]));
    const roots = [];
    for (const n of members) (n.parent && ids.has(n.parent) ? kids.get(n.parent) : roots).push(n);
    // Many top-level pages in one group wrap onto rows instead of one endless line.
    const PER_ROW = 8;
    const rows = [];
    for (let i = 0; i < roots.length; i += PER_ROW) rows.push(roots.slice(i, i + PER_ROW));
    const width = new Map();
    const g = (map.groups || []).find((x) => x.id === gid);
    let groupW = 0;
    const measured = rows.map((row) => {
      const depthH = [];
      const measure = (n, d) => {
        depthH[d] = Math.max(depthH[d] || 0, nodeH(n));
        const ks = kids.get(n.id);
        ks.forEach((c) => measure(c, d + 1));
        width.set(n.id, Math.max(NW, ks.reduce((a, c) => a + width.get(c.id), 0) + Math.max(0, ks.length - 1) * SIB_GAP));
      };
      row.forEach((r) => measure(r, 0));
      const total = row.reduce((a, r) => a + width.get(r.id), 0) + Math.max(0, row.length - 1) * SIB_GAP;
      groupW = Math.max(groupW, total);
      return { row, depthH, total };
    });
    groups.push({ id: gid, label: g?.label || gid, count: members.length, y, x1: -groupW / 2, x2: groupW / 2 });
    let top = y + 44;
    for (const { row, depthH, total } of measured) {
      const levelY = (d) => top + depthH.slice(0, d).reduce((a, h) => a + h + LEVEL_GAP, 0);
      const place = (n, x0, d) => {
        const w = width.get(n.id), ks = kids.get(n.id);
        const x = x0 + (w - NW) / 2, ny = levelY(d);
        nodes.set(n.id, { x, y: ny, w: NW, h: nodeH(n), n, kids: ks.length });
        (n.sections || []).forEach((s, i) => sections.set(s.id, { x: x + PAD, y: ny + HEAD + i * (SH + SG), w: NW - PAD * 2, h: SH, s, node: n.id }));
        const kw = ks.reduce((a, c) => a + width.get(c.id), 0) + Math.max(0, ks.length - 1) * SIB_GAP;
        let cx = x0 + (w - kw) / 2;
        for (const c of ks) { place(c, cx, d + 1); cx += width.get(c.id) + SIB_GAP; }
      };
      let rx = -total / 2;
      for (const r of row) { place(r, rx, 0); rx += width.get(r.id) + SIB_GAP; }
      top = levelY(depthH.length - 1) + depthH[depthH.length - 1] + LEVEL_GAP;
    }
    y = top - LEVEL_GAP + GROUP_GAP;
  }
  return { nodes, sections, groups };
}

// ---------- state ----------
const S = {
  maps: [], a: null, b: null, A: null, B: null, LA: null, LB: null, diff: null, comments: [],
  t: 0, view: { x: 0, y: 0, k: 1 }, sel: null, viewAs: "", panel: "changes", showChanges: true, showFlows: false, anim: null, fitted: false,
};
const $ = (s) => document.querySelector(s);
const svg = $("#canvas");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const lerp = (p, q, t) => p + (q - p) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hasB = () => S.B && S.b !== S.a;
const shown = () => (S.t >= 0.5 && hasB() ? S.B : S.A);

async function api(path, opts) { const r = await fetch(path, opts); if (!r.ok) throw new Error((await r.json()).error || r.status); return r.json(); }
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function load(keep) {
  S.maps = await api("/api/maps");
  S.comments = await api("/api/comments");
  const names = S.maps.filter((m) => !m.error).map((m) => m.name);
  if (!names.length) {
    $("#empty").hidden = false;
    $("#empty").innerHTML = `<div>No maps yet.<br><br>Run <code>node lathe/bin/lathe.mjs init &lt;repo&gt;</code></div>`;
    return;
  }
  const pick = (want, fallback) => (names.includes(want) ? want : fallback);
  if (!keep || !names.includes(S.a)) S.a = pick("before", names[0]);
  if (!keep || !names.includes(S.b)) S.b = pick("after", S.a);
  for (const [sel, val] of [["#pickA", S.a], ["#pickB", S.b]])
    $(sel).innerHTML = names.map((n) => `<option ${n === val ? "selected" : ""}>${esc(n)}</option>`).join("");
  S.A = await api(`/api/map?name=${encodeURIComponent(S.a)}`);
  S.B = await api(`/api/map?name=${encodeURIComponent(S.b)}`);
  S.LA = layout(S.A);
  S.LB = layout(S.B);
  S.diff = hasB() ? diffMaps(S.A, S.B) : null;
  const product = S.B.product || S.A.product || "Lathe";
  $("#product").textContent = product;
  document.title = `${product} · Lathe`;
  if (!hasB()) S.t = 0;
  const roles = (shownMapRoles());
  $("#viewAsWrap").hidden = !roles.length;
  $("#viewAs").innerHTML = `<option value="">Everyone</option>` + roles.map((r) => `<option value="${esc(r.id)}" ${r.id === S.viewAs ? "selected" : ""}>${esc(r.label)}</option>`).join("");
  if (!S.fitted) { fit(); S.fitted = true; }
  syncChrome();
  draw();
  renderPanel();
  renderLegend();
}

// ---------- icons (12×12, drawn at x,y) ----------
function icon(kind, x, y) {
  const p = (d) => `<path class="ico" d="${d}" transform="translate(${x} ${y})"/>`;
  const f = (d) => `<path class="ico-f" d="${d}" transform="translate(${x} ${y})"/>`;
  switch (kind) {
    case "header": return p("M1.5 2.5h9v7h-9zM1.5 5h9");
    case "footer": return p("M1.5 2.5h9v7h-9zM1.5 7h9");
    case "nav": return p("M2 4h8M2 6h8M2 8h8");
    case "hero": return p("M2 3.5h8M2 6h5") + f("M2 8h3.5v1.6H2z");
    case "cards": return p("M1.5 2h4v3.5h-4zM6.5 2h4v3.5h-4zM1.5 6.5h4V10h-4zM6.5 6.5h4V10h-4z");
    case "list": return f("M2 2.6h1.4V4H2zM2 5.3h1.4v1.4H2zM2 8h1.4v1.4H2z") + p("M5 3.3h5M5 6h5M5 8.7h5");
    case "form": return p("M1.5 3.5h9v3h-9zM6.5 8.5h4");
    case "data": return p("M2 10V7M4.7 10V4M7.3 10V6M10 10V2.5");
    case "media": return p("M1.5 2.5h9v7h-9zM2 9l3-3 2 2 1.5-1.5L10 8");
    case "cta": return p("M2 4.5h8a1.5 1.5 0 0 1 0 3H2a1.5 1.5 0 0 1 0-3z");
    case "gate": return p("M3 5.5h6v4.5H3zM4.5 5.5V4a1.5 1.5 0 0 1 3 0v1.5");
    default: return p("M2 3h8M2 6h8M2 9h5");
  }
}

// ---------- drawing ----------
function rectAt(id, la, lb, e) {
  const a = la.get(id), b = lb.get(id);
  const p = a || b, q = b || a;
  return { x: lerp(p.x, q.x, e), y: lerp(p.y, q.y, e), w: p.w, h: lerp(p.h, q.h, e), a, b, op: a && b ? 1 : a ? 1 - e : e };
}
const curveV = (x1, y1, x2, y2) => { const d = Math.max(24, (y2 - y1) / 2); return `M${x1} ${y1}C${x1} ${y1 + d},${x2} ${y2 - d},${x2} ${y2}`; };

function draw() {
  if (!S.A) return;
  const e = hasB() ? ease(S.t) : 0;
  const la = S.LA, lb = hasB() ? S.LB : S.LA;
  const ns = S.diff?.nodeStatus || {}, ss = S.diff?.sectionStatus || {};
  const show = S.showChanges && hasB();
  const selId = S.sel?.node;
  const out = [];
  const v = S.view;
  out.push(`<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4 0 8z" fill="var(--muted)"/></marker><marker id="arr-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4 0 8z" fill="var(--accent)"/></marker></defs>`);
  out.push(`<g transform="translate(${v.x} ${v.y}) scale(${v.k})">`);

  // group chips (DevRev-style), crossfaded between maps
  const gl = (groups, op) => groups.forEach((g) => {
    if (op <= 0.01) return;
    const cx = (g.x1 + g.x2) / 2, text = g.label, w = text.length * 6.6 + 34;
    out.push(`<g class="g-chip" opacity="${op}"><rect x="${cx - w / 2}" y="${g.y}" width="${w}" height="24" rx="12"/><text x="${cx - w / 2 + 12}" y="${g.y + 16}">${esc(text)} <tspan class="n">${g.count}</tspan></text></g>`);
  });
  if (hasB()) { gl(la.groups, 1 - e); gl(lb.groups, e); } else gl(la.groups, 1);

  const ids = [...new Set([...la.nodes.keys(), ...lb.nodes.keys()])];
  const R = Object.fromEntries(ids.map((id) => [id, rectAt(id, la.nodes, lb.nodes, e)]));

  // tree edges: bezier, coloured by change
  const edgeKeys = new Map();
  for (const [L, w] of [[la, "a"], [lb, "b"]]) for (const { n } of L.nodes.values())
    if (n.parent && L.nodes.has(n.parent) && L.nodes.get(n.parent).n.group === n.group) {
      const k = `${n.parent}>${n.id}`;
      edgeKeys.set(k, (edgeKeys.get(k) || "") + w);
    }
  for (const [k, w] of edgeKeys) {
    const [p, c] = k.split(">");
    const both = !hasB() || w === "ab";
    const op = both ? 1 : w === "a" ? 1 - e : e;
    if (op < 0.02) continue;
    const P = R[p], C = R[c];
    const cls = !both && show ? (w === "b" ? "add" : "del") : selId && (p === selId || c === selId) ? "hi" : "";
    out.push(`<path class="edge ${cls}" opacity="${op}" d="${curveV(P.x + P.w / 2, P.y + P.h, C.x + C.w / 2, C.y)}"/>`);
  }

  // flows (cross-links) with label chips
  const flowsOf = (m) => (m.links || []).filter((l) => S.showFlows || l.from === selId || l.to === selId);
  const flowKeys = new Map();
  for (const [m, w] of [[S.A, "a"], [hasB() ? S.B : S.A, "b"]]) for (const l of flowsOf(m)) {
    const k = `${l.from}>${l.to}`;
    const cur = flowKeys.get(k) || { w: "", label: l.label };
    cur.w += w; cur.label ||= l.label;
    flowKeys.set(k, cur);
  }
  const labels = [];
  for (const [k, { w, label }] of flowKeys) {
    const [f, t] = k.split(">");
    if (!R[f] || !R[t]) continue;
    const op = (!hasB() || (w.includes("a") && w.includes("b")) ? 1 : w === "a" ? 1 - e : e) * Math.min(R[f].op, R[t].op);
    if (op < 0.05) continue;
    const F = R[f], T = R[t];
    // A link that duplicates a tree edge just labels that edge.
    const treeDown = edgeKeys.has(`${f}>${t}`), treeUp = edgeKeys.has(`${t}>${f}`);
    if (treeDown || treeUp) {
      if (label && treeDown) {
        const mx = (F.x + F.w / 2 + T.x + T.w / 2) / 2, my = (F.y + F.h + T.y) / 2, lw = label.length * 5.9 + 16;
        labels.push(`<g class="flabel" opacity="${op}"><rect x="${mx - lw / 2}" y="${my - 10}" width="${lw}" height="20" rx="5"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle">${esc(label)}</text></g>`);
      }
      continue;
    }
    const fy = F.y + 26, ty = T.y + 26;
    const side = T.x + T.w / 2 >= F.x + F.w / 2 ? 1 : -1;
    const sx = F.x + F.w / 2 + (side * F.w) / 2, ex = T.x + T.w / 2 - (side * T.w) / 2;
    const bend = Math.max(60, Math.abs(ex - sx) * 0.45);
    const hi = selId && (f === selId || t === selId);
    out.push(`<path class="flow${hi ? " hi" : ""}" opacity="${op}" marker-end="url(#${hi ? "arr-hi" : "arr"})" d="M${sx} ${fy}C${sx + side * bend} ${fy},${ex - side * bend} ${ty},${ex} ${ty}"/>`);
    if (label) {
      const mx = (sx + ex) / 2, my = (fy + ty) / 2, lw = label.length * 5.9 + 16;
      labels.push(`<g class="flabel" opacity="${op}"><rect x="${mx - lw / 2}" y="${my - 10}" width="${lw}" height="20" rx="5"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle">${esc(label)}</text></g>`);
    }
  }

  // nodes
  const navOf = (m, id) => Object.entries(m.nav || {}).filter(([, l]) => l.includes(id)).map(([k]) => k);
  const ccount = (id, secIds) => S.comments.filter((c) => !c.resolved && (c.target === `node:${id}` || secIds.some((s) => c.target === `section:${s}`))).length;
  const ST_LABEL = { added: "NEW", removed: "REMOVED", changed: "CHANGED" };
  const ST_COLOR = { added: "var(--add)", removed: "var(--del)", changed: "var(--chg)" };
  for (const id of ids) {
    const r = R[id];
    if (r.op < 0.02) continue;
    const L = e < 0.5 ? (r.a || r.b) : (r.b || r.a);
    const n = L.n;
    const st = show ? ns[id] || "same" : "same";
    const sc = r.a && r.b ? 1 : 0.94 + 0.06 * r.op;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const isSel = selId === id && !S.sel.section;
    const acc = S.viewAs ? n.access?.[S.viewAs] : null;
    const role = S.viewAs ? shownMapRoles().find((x) => x.id === S.viewAs) : null;
    const dim = acc === "refused" || acc === "hidden" ? 0.22 : 1;
    out.push(`<g class="node st-${st}${isSel ? " is-sel" : ""}${acc ? ` acc-${acc}` : ""}" data-node="${esc(id)}" opacity="${r.op * dim}" transform="translate(${cx} ${cy}) scale(${sc}) translate(${-cx} ${-cy})" style="cursor:pointer">`);
    if (isSel) out.push(`<rect class="halo" x="${r.x - 3}" y="${r.y - 3}" width="${r.w + 6}" height="${r.h + 6}" rx="15"/>`);
    out.push(`<rect class="node-box" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="12"/>`);
    const eyebrow = [n.audience || "page", n.path].filter(Boolean).join(" · ");
    out.push(`<text class="eyebrow" x="${r.x + 14}" y="${r.y + 20}">${esc(trunc(eyebrow, 30))}</text>`);
    out.push(`<text class="ntitle" x="${r.x + 14}" y="${r.y + 38}">${esc(trunc(n.label, 22))}</text>`);
    // right-side chips: status, then nav membership
    let rx = r.x + r.w - 10;
    if (st !== "same") {
      const w = ST_LABEL[st].length * 6.2 + 12;
      rx -= w;
      out.push(`<g class="st-chip"><rect x="${rx}" y="${r.y + 9}" width="${w}" height="16" rx="5" fill="${ST_COLOR[st]}"/><text x="${rx + w / 2}" y="${r.y + 20}">${ST_LABEL[st]}</text></g>`);
      rx -= 4;
    }
    for (const m of navOf(shown(), id)) {
      rx -= 16;
      out.push(`<g class="tag"><title>In ${m} menu</title><rect x="${rx}" y="${r.y + 9}" width="16" height="16" rx="5"/><text x="${rx + 8}" y="${r.y + 20}">${m[0].toUpperCase()}</text></g>`);
      rx -= 3;
    }
    if (acc === "partial" || acc === "refused" || acc === "hidden" || role?.home === id) {
      const lab = role?.home === id ? "HOME" : acc === "partial" ? "PARTIAL" : acc === "hidden" ? "NOT OFFERED" : "REFUSED";
      const w = lab.length * 6.2 + 12, col = role?.home === id ? "var(--accent)" : acc === "partial" ? "var(--chg)" : acc === "hidden" ? "var(--ink-2)" : "var(--del)";
      out.push(`<g class="st-chip"><rect x="${r.x + r.w - 10 - w}" y="${r.y + r.h - 22}" width="${w}" height="16" rx="5" fill="${col}"/><text x="${r.x + r.w - 10 - w / 2}" y="${r.y + r.h - 11}">${lab}</text></g>`);
    }
    if (!n.sections?.length && n.kind !== "capability") out.push(`<text class="eyebrow" x="${r.x + r.w - 14}" y="${r.y + 38}" text-anchor="end" style="letter-spacing:0">no sections</text>`);
    // ports
    if (n.parent && R[n.parent]) out.push(`<circle class="port" cx="${cx}" cy="${r.y}" r="4"/>`);
    if (L.kids) out.push(`<circle class="port" cx="${cx}" cy="${r.y + r.h}" r="4"/>`);
    const cc = ccount(id, (n.sections || []).map((s) => s.id));
    if (cc) out.push(`<circle class="badge" cx="${r.x + r.w}" cy="${r.y}" r="9"/><text class="badge-t" x="${r.x + r.w}" y="${r.y + 3.5}">${cc}</text>`);
    out.push(`</g>`);
  }

  // section rows: drawn on top so moved sections fly between pages
  const sids = [...new Set([...la.sections.keys(), ...lb.sections.keys()])];
  for (const sid of sids) {
    const r = rectAt(sid, la.sections, lb.sections, e);
    const host = (r.b && e >= 0.5 ? r.b : r.a || r.b).node;
    const hostNode = (S.t >= 0.5 && hasB() ? S.B : S.A).nodes.find((x) => x.id === host);
    const op = r.op * Math.max(0.15, R[host]?.op ?? 1) * (S.viewAs && ["refused", "hidden"].includes(hostNode?.access?.[S.viewAs]) ? 0.22 : 1);
    if (op < 0.02) continue;
    const s = (e < 0.5 ? (r.a || r.b) : (r.b || r.a)).s;
    const st = show ? ss[sid] || "same" : "same";
    const isSel = S.sel?.section === sid;
    out.push(`<g class="sec s-${st}${isSel ? " is-sel" : ""}" data-section="${esc(sid)}" data-node="${esc(host)}" opacity="${op}" style="cursor:pointer">`);
    out.push(`<rect class="row" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="7"/>`);
    out.push(`<rect class="ico-bg" x="${r.x + 5}" y="${r.y + 5}" width="18" height="18" rx="5"/>`);
    out.push(icon(s.kind, r.x + 8, r.y + 8));
    out.push(`<text class="slabel" x="${r.x + 31}" y="${r.y + 18}">${esc(trunc(s.label, 25))}</text>`);
    if (st !== "same") out.push(`<circle class="sdot" cx="${r.x + r.w - 10}" cy="${r.y + r.h / 2}" r="3" fill="${st === "added" ? "var(--add)" : st === "removed" ? "var(--del)" : "var(--chg)"}"/>`);
    out.push(`</g>`);
  }
  out.push(...labels);
  out.push(`</g>`);
  svg.innerHTML = out.join("");
}

// ---------- view: pan / zoom / fit ----------
function bounds() {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const L of [S.LA, hasB() ? S.LB : null]) if (L) {
    for (const r of L.nodes.values()) { x1 = Math.min(x1, r.x); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
    for (const g of L.groups) y1 = Math.min(y1, g.y);
  }
  return { x1, y1, x2, y2 };
}
function viewport() {
  if (document.body.classList.contains("is-focus")) return { left: 0, top: 40, W: svg.clientWidth, H: svg.clientHeight - 80 };
  const narrow = innerWidth <= 900;
  const W = svg.clientWidth - (narrow ? 0 : PANEL_W), H = svg.clientHeight - (narrow ? innerHeight * 0.42 + 70 : 0);
  return { left: 0, top: narrow ? 110 : 80, W, H: H - (narrow ? 110 : 160) };
}
function fit() {
  if (!S.LA) return;
  const vp = viewport();
  if (vp.W < 200 || vp.H < 100) return requestAnimationFrame(fit);
  const b = bounds();
  const k = Math.min(1.3, (vp.W - 80) / (b.x2 - b.x1), vp.H / (b.y2 - b.y1));
  S.view = { k, x: vp.W / 2 - ((b.x1 + b.x2) / 2) * k, y: vp.top - b.y1 * k + Math.max(0, (vp.H - (b.y2 - b.y1) * k) / 2) };
  draw();
}
function focusNode(id) {
  const r = (S.t > 0.5 && hasB() ? S.LB : S.LA).nodes.get(id) || S.LA.nodes.get(id) || S.LB?.nodes.get(id);
  if (!r) return;
  const vp = viewport(), k = Math.max(S.view.k, 0.85);
  const target = { k, x: vp.W / 2 - (r.x + r.w / 2) * k, y: vp.top + 40 - r.y * k };
  const from = { ...S.view }, t0 = performance.now();
  const step = (now) => {
    const p = ease(Math.min(1, (now - t0) / 450));
    S.view = { k: lerp(from.k, target.k, p), x: lerp(from.x, target.x, p), y: lerp(from.y, target.y, p) };
    draw();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const hit = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-node]");
let drag = null;
svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  hideMenu();
  drag = { x: ev.clientX, y: ev.clientY, vx: S.view.x, vy: S.view.y, moved: false };
  svg.setPointerCapture(ev.pointerId);
});
svg.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; svg.classList.add("is-panning");
  S.view.x = drag.vx + dx; S.view.y = drag.vy + dy; draw();
});
svg.addEventListener("pointerup", (ev) => {
  svg.classList.remove("is-panning");
  const d = drag; drag = null;
  if (!d || d.moved) return;
  const el = hit(ev);
  select(el ? { node: el.dataset.node, section: el.dataset.section || null } : null, !!el);
});
svg.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  const el = hit(ev);
  if (!el) return hideMenu();
  select({ node: el.dataset.node, section: el.dataset.section || null }, false);
  showMenu(ev.clientX, ev.clientY);
});
svg.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  hideMenu();
  const rect = svg.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  // Pinch (ctrlKey) or ⌘-scroll zooms; plain scroll pans, as in Figma.
  if (ev.ctrlKey || ev.metaKey) {
    const k = Math.min(3, Math.max(0.15, S.view.k * Math.exp(-ev.deltaY * 0.01)));
    S.view.x = mx - ((mx - S.view.x) * k) / S.view.k; S.view.y = my - ((my - S.view.y) * k) / S.view.k; S.view.k = k;
  } else { S.view.x -= ev.deltaX; S.view.y -= ev.deltaY; }
  draw();
}, { passive: false });
window.addEventListener("resize", () => draw());
window.addEventListener("resize", () => { if (document.body.classList.contains("is-focus")) fit(); });

function select(sel, openInspect) {
  S.sel = sel;
  if (sel && openInspect) S.panel = "inspect";
  draw(); renderPanel();
}

// ---------- context menu ----------
const MI = {
  inspect: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 5h0"/></svg>',
  comment: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/></svg>',
  zoom: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4M7 5v4"/></svg>',
  links: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="4" cy="4" r="1.8"/><circle cx="12" cy="12" r="1.8"/><path d="M5.8 4H9a3 3 0 0 1 3 3v3.2" stroke-dasharray="1.5 2"/></svg>',
};
function showMenu(x, y) {
  const m = $("#menu");
  const node = allNodes()[S.sel.node];
  const src = S.sel.section ? findSection(S.sel.section)?.source : node?.source;
  m.innerHTML = `
    <button data-act="inspect">${MI.inspect}View details<kbd>↵</kbd></button>
    <button data-act="comment">${MI.comment}Comment for agent<kbd>C</kbd></button>
    ${src ? `<button data-act="copy">${MI.copy}Copy source path<kbd>⌘C</kbd></button>` : ""}
    <hr>
    <button data-act="zoom">${MI.zoom}Zoom to page<kbd>Z</kbd></button>
    <button data-act="links">${MI.links}${S.showFlows ? "Hide" : "Show"} all links<kbd>L</kbd></button>`;
  m.hidden = false;
  const { width, height } = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  m.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => { hideMenu(); act(b.dataset.act); }));
  m.querySelector("button")?.focus();
}
function hideMenu() { $("#menu").hidden = true; }
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#menu")) hideMenu(); });

function act(a) {
  if (!S.sel && a !== "links") return;
  if (a === "inspect") { S.panel = "inspect"; renderPanel(); }
  if (a === "comment") { S.panel = "inspect"; renderPanel(); $("#pbody textarea")?.focus(); }
  if (a === "copy") {
    const src = S.sel.section ? findSection(S.sel.section)?.source : allNodes()[S.sel.node]?.source;
    if (src) { navigator.clipboard?.writeText(src); toast("Source path copied"); }
  }
  if (a === "zoom") focusNode(S.sel.node);
  if (a === "links") setFlows(!S.showFlows);
}

// ---------- before / after ----------
function animateTo(target, dur = 1400) {
  if (!hasB()) return toast("Pick a different After map to compare");
  cancelAnimationFrame(S.anim);
  const from = S.t, t0 = performance.now();
  const d = (Math.abs(target - from) || 1) * dur;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / d);
    S.t = from + (target - from) * p;
    syncChrome(); draw();
    if (p < 1) S.anim = requestAnimationFrame(step);
    else renderPanel();
  };
  S.anim = requestAnimationFrame(step);
}
function play() {
  if (!hasB()) return toast("Pick a different After map to compare");
  if (S.t > 0.99) { S.t = 0; draw(); setTimeout(() => animateTo(1), 350); } else animateTo(1);
}
function syncChrome() {
  const sc = $("#scrub");
  sc.value = Math.round(S.t * 1000);
  sc.style.setProperty("--p", `${S.t * 100}%`);
  $("#btnA").classList.toggle("is-on", S.t < 0.5);
  $("#btnB").classList.toggle("is-on", S.t >= 0.5);
  for (const el of ["#btnB", "#play", "#scrub"]) $(el).disabled = !hasB();
  const m = shown();
  if (m) $("#meta").textContent = `${m.nodes.length} pages · ${m.nodes.reduce((a, n) => a + (n.sections?.length || 0), 0)} sections`;
}
function setFlows(on) {
  S.showFlows = on;
  $("#optFlows").classList.toggle("is-on", on);
  $("#optFlows").setAttribute("aria-pressed", on);
  draw();
}
$("#btnA").onclick = () => animateTo(0);
$("#btnB").onclick = () => animateTo(1);
$("#play").onclick = play;
$("#scrub").oninput = (e) => { cancelAnimationFrame(S.anim); S.t = e.target.value / 1000; syncChrome(); draw(); };
$("#fit").onclick = fit;
$("#optChanges").onclick = (e) => {
  S.showChanges = !S.showChanges;
  e.currentTarget.classList.toggle("is-on", S.showChanges);
  e.currentTarget.setAttribute("aria-pressed", S.showChanges);
  draw();
};
$("#optFlows").onclick = () => setFlows(!S.showFlows);
const shownMapRoles = () => ((S.t >= 0.5 && hasB() ? S.B : S.A)?.roles || S.A?.roles || []);
$("#viewAs").onchange = (e) => { S.viewAs = e.target.value; draw(); renderPanel(); };
$("#pickA").onchange = (e) => { S.a = e.target.value; S.t = 0; S.fitted = false; load(true); };
$("#pickB").onchange = (e) => { S.b = e.target.value; S.t = 0; S.fitted = false; load(true); };
$("#legendToggle").onclick = (e) => {
  const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
  e.currentTarget.setAttribute("aria-expanded", open);
  $("#legendBody").hidden = !open;
};
// Focus mode: just the map, edge to edge (⌘| or Ctrl+|). Keyboard playback still works.
function setFocus(on) {
  document.body.classList.toggle("is-focus", on);
  hideMenu();
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  requestAnimationFrame(() => { fit(); parts.layout(); tokens.layout(); });
}
// Leaving browser fullscreen with Esc also leaves focus mode.
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("is-focus")) setFocus(false); });

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.code === "Backslash" || e.key === "|" || e.key === "\\")) {
    e.preventDefault();
    setFocus(!document.body.classList.contains("is-focus"));
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  const mode = document.body.classList.contains("mode-parts") ? parts : document.body.classList.contains("mode-tokens") ? tokens : null;
  if (mode) {
    if (e.key === "Escape" && document.body.classList.contains("is-focus")) setFocus(false);
    else mode.onKey(e);
    return;
  }
  const k = e.key.toLowerCase();
  if (e.key === " ") { e.preventDefault(); play(); }
  else if (e.key === "ArrowLeft") animateTo(0);
  else if (e.key === "ArrowRight") animateTo(1);
  else if (k === "f" && !e.metaKey) fit();
  else if (k === "l" && !e.metaKey) act("links");
  else if (k === "z" && !e.metaKey && S.sel) act("zoom");
  else if (k === "c" && (e.metaKey || e.ctrlKey) && S.sel && !getSelection().toString()) { e.preventDefault(); act("copy"); }
  else if (k === "c" && S.sel) { e.preventDefault(); act("comment"); }
  else if (e.key === "Enter" && S.sel && document.activeElement?.closest("#menu") == null) act("inspect");
  else if (e.key === "Escape" && document.body.classList.contains("is-focus")) setFocus(false);
  else if (e.key === "Escape") { hideMenu(); select(null); }
});

// ---------- legend ----------
function renderLegend() {
  const kinds = [["hero", "Hero"], ["content", "Content"], ["cards", "Cards / grid"], ["list", "List"], ["form", "Form"], ["data", "Data"], ["cta", "Call to action"], ["gate", "Gate / paywall"], ["header", "Header"], ["footer", "Footer"]];
  const ico = (k) => `<svg width="18" height="18" viewBox="0 0 18 18"><rect class="ico-bg" width="18" height="18" rx="5"/>${icon(k, 3, 3)}</svg>`;
  $("#legendBody").innerHTML = `<h5>Changes</h5>
    <div class="lg"><i style="border-color:var(--add)"></i>New</div>
    <div class="lg"><i style="border-color:var(--chg)"></i>Changed or moved</div>
    <div class="lg"><i style="border-color:var(--del);border-style:dashed"></i>Removed</div>
    <h5>Sections</h5>${kinds.map(([k, l]) => `<div class="lg">${ico(k)}${l}</div>`).join("")}
    <h5>Menus</h5><div class="lg"><b class="mono">H</b>&nbsp; in header &nbsp; <b class="mono">F</b>&nbsp; in footer</div>`;
}

// ---------- panel ----------
document.querySelectorAll(".ptabs button").forEach((b) => (b.onclick = () => { S.panel = b.dataset.p; renderPanel(); }));
const allNodes = () => ({ ...Object.fromEntries((S.A?.nodes || []).map((n) => [n.id, n])), ...Object.fromEntries(((hasB() ? S.B : null)?.nodes || []).map((n) => [n.id, n])) });
const labelOf = (id) => allNodes()[id]?.label || id;
const labelBefore = (id) => S.A?.nodes.find((n) => n.id === id)?.label || labelOf(id);
const findSection = (sid) => [S.A, S.B].flatMap((m) => m?.nodes || []).flatMap((n) => n.sections || []).find((s) => s.id === sid);
const mdInline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

function renderPanel() {
  document.querySelectorAll(".ptabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.p === S.panel));
  const P = $("#pbody");
  if (!S.A) { P.innerHTML = ""; return; }
  P.innerHTML = S.panel === "changes" ? changesHTML() : S.panel === "inspect" ? inspectHTML() : briefHTML();
  P.querySelectorAll("[data-go]").forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); S.sel = { node: b.dataset.go, section: null }; focusNode(b.dataset.go); draw(); if (S.panel === "inspect") renderPanel(); }));
  P.querySelectorAll("[data-src]").forEach((el) => (el.onclick = () => { navigator.clipboard?.writeText(el.dataset.src); toast("Source path copied"); }));
  P.querySelectorAll("[data-open-part]").forEach((b) => (b.onclick = () => { setMode("parts"); parts.select(b.dataset.openPart); }));
  P.querySelectorAll("[data-resolve]").forEach((b) => (b.onclick = async () => { S.comments = await api("/api/comments", post({ action: "resolve", id: b.dataset.resolve })); draw(); renderPanel(); }));
  const form = P.querySelector("#cform");
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = form.text.value.trim();
    if (!text) return;
    S.comments = await api("/api/comments", post({ map: S.t >= 0.5 && hasB() ? S.b : S.a, target: form.dataset.target, text }));
    draw(); renderPanel(); toast("Comment saved for your agent");
  };
  const save = P.querySelector("#saveBrief");
  if (save) save.onclick = async () => { const r = await api("/api/brief", post({ markdown: currentBrief() })); toast(`Saved ${r.path}`); };
  const copy = P.querySelector("#copyBrief");
  if (copy) copy.onclick = () => { navigator.clipboard?.writeText(currentBrief()); toast("Brief copied"); };
}

function changesHTML() {
  if (!hasB()) {
    const n = S.A.nodes.length, s = S.A.nodes.reduce((a, x) => a + (x.sections?.length || 0), 0);
    return `<div class="label">Map</div><h3 class="h">${esc(S.A.title || S.a)}</h3>
      <p class="muted">${n} pages · ${s} sections${S.A.snapshot?.commit ? ` · <span class="mono">${esc(S.A.snapshot.commit.slice(0, 8))}</span>` : ""}</p>
      <p>Pick an <b>After</b> map to compare. Ask your agent to copy this map to <span class="mono">after.json</span> and redesign it; this view reloads as it writes.</p>${notesHTML(S.A)}`;
  }
  const d = S.diff, s = d.summary;
  const items = d.changes.map((c) => {
    const body = c.type === "changed" ? `<ul>${c.diffs.map((x) => `<li>${esc(describe(x, labelOf, labelBefore))}</li>`).join("")}</ul>`
      : c.type === "nav" ? `<ul><li>${esc(c.before.map(labelBefore).join(" · ") || "—")}</li><li>→ ${esc(c.after.map(labelOf).join(" · ") || "—")}</li></ul>`
      : c.movedIn?.length ? `<ul><li>Takes ${esc(c.movedIn.map((m) => m.label).join(", "))}</li></ul>`
      : c.into?.length ? `<ul><li>Into ${esc(c.into.map(labelOf).join(", "))}</li></ul>` : "";
    const title = c.type === "nav" ? `${c.menu[0].toUpperCase()}${c.menu.slice(1)} menu` : c.label;
    return `<button class="change" ${c.node ? `data-go="${esc(c.node)}"` : ""}><span class="ct"><span class="pill ${c.type}">${c.type}</span>${esc(title)}</span>${body}${c.why ? `<div class="why">${esc(c.why)}</div>` : ""}</button>`;
  }).join("");
  return `<div class="label">Intent</div>${S.B.summary ? `<div class="intent">${esc(S.B.summary)}</div>` : ""}
    <div class="stats"><div class="stat"><b>${s.added}</b><span>new</span></div><div class="stat"><b>${s.removed}</b><span>gone</span></div><div class="stat"><b>${s.changed}</b><span>changed</span></div><div class="stat"><b>${s.sectionsMoved}</b><span>moved</span></div></div>
    <div class="label">Changes · ${d.changes.length}</div>${items || `<p class="muted">No differences.</p>`}`;
}

function notesHTML(m) {
  const flagged = m.nodes.filter((n) => n.notes);
  return flagged.length ? `<div class="label">Notes</div>${flagged.map((n) => `<button class="change" data-go="${esc(n.id)}"><span class="ct">${esc(n.label)}</span><div class="why">${esc(n.notes)}</div></button>`).join("")}` : "";
}

function inspectHTML() {
  if (!S.sel) return `<p class="muted">Click a page or section on the map. Right-click for more.</p>`;
  const n = allNodes()[S.sel.node];
  if (!n) return `<p class="muted">Not in these maps.</p>`;
  const before = S.A.nodes.find((x) => x.id === n.id), after = hasB() ? S.B.nodes.find((x) => x.id === n.id) : null;
  const sec = S.sel.section && findSection(S.sel.section);
  const target = sec ? `section:${sec.id}` : `node:${n.id}`;
  const st = S.diff?.nodeStatus[n.id];
  const change = S.diff?.changes.find((c) => c.node === n.id);
  const L = [];
  if (sec) {
    const sst = S.diff?.sectionStatus[sec.id];
    L.push(`<div class="crumb"><a href="#" data-go="${esc(n.id)}">${esc(n.label)}</a> /</div><h3 class="h">${esc(sec.label)}</h3>`);
    L.push(`<div class="label">Type</div><div class="field">${esc(sec.kind || "content")}${sst && sst !== "same" ? ` · ${esc(sst)}` : ""}</div>`);
    if (sec.source) L.push(`<div class="label">Source</div><div class="field src" data-src="${esc(sec.source)}">${esc(sec.source)}<span class="muted">copy</span></div>`);
    if (sec.component) L.push(`<div class="label">Component</div><div class="field mono">${esc(sec.component)}</div>`);
    if (sec.notes) L.push(`<div class="label">Notes</div><p>${esc(sec.notes)}</p>`);
    if (sec.why) L.push(`<div class="label">Why</div><p>${esc(sec.why)}</p>`);
  } else {
    L.push(`<div class="label">${esc(n.audience || "page")}${st && st !== "same" ? ` · <span class="pill ${st}">${st}</span>` : ""}</div><h3 class="h">${esc(n.label)}</h3>`);
    L.push(`<div class="label">Path</div><div class="field mono">${esc(n.path || "—")}</div>`);
    if (n.source) L.push(`<div class="label">Source</div><div class="field src" data-src="${esc(n.source)}">${esc(n.source)}<span class="muted">copy</span></div>`);
    if (before?.notes) L.push(`<div class="label">Before</div><p>${esc(before.notes)}</p>`);
    const accNode = (S.t >= 0.5 && after) ? after : before || after;
    if (accNode?.access) {
      const roles = shownMapRoles();
      const col = { full: "var(--add)", partial: "var(--chg)", refused: "var(--del)", hidden: "var(--muted)" };
      L.push(`<div class="label">Access by role</div><div class="box">${Object.entries(accNode.access).map(([k, v]) => `<div><span class="dot" style="background:${col[v] || "var(--muted)"}"></span>${esc(roles.find((r) => r.id === k)?.label || k)}${roles.find((r) => r.id === k)?.home === accNode.id ? ` <span class="pill" style="background:var(--accent)">home</span>` : ""}<span class="muted" style="margin-left:auto">${esc(v)}</span></div>`).join("")}</div>`);
      if (accNode.accessNotes) L.push(`<p class="muted" style="font-size:12px">${esc(accNode.accessNotes)}</p>`);
    }
    if (after?.why || after?.notes) L.push(`<div class="label">After</div>${after.why ? `<p>${esc(after.why)}</p>` : ""}${after.notes ? `<p>${esc(after.notes)}</p>` : ""}`);
    if (change?.type === "changed") L.push(`<div class="label">Changes</div><div class="box">${change.diffs.map((x) => `<div><span class="dot changed"></span>${esc(describe(x, labelOf, labelBefore))}</div>`).join("")}</div>`);
    const m = shown(), cur = m.nodes.find((x) => x.id === n.id) || before || after;
    const secs = cur.sections || [];
    const ss = S.diff?.sectionStatus || {};
    if (secs.length) L.push(`<div class="label">Sections · ${secs.length}</div><div class="box">${secs.map((s) => `<div><span class="dot ${S.showChanges ? ss[s.id] || "" : ""}"></span>${esc(s.label)}<span class="muted" style="margin-left:auto">${esc(s.kind || "")}</span></div>`).join("")}</div>`);
    const lbl = m === S.B && hasB() ? labelOf : labelBefore;
    const ls = (m.links || []).filter((l) => l.from === n.id || l.to === n.id);
    if (ls.length) L.push(`<div class="label">Links</div><div class="box">${ls.map((l) => { const o = l.from === n.id ? l.to : l.from; return `<a href="#" data-go="${esc(o)}">${l.from === n.id ? "→" : "←"} ${esc(lbl(o))}${l.label ? ` <span class="muted">${esc(l.label)}</span>` : ""}</a>`; }).join("")}</div>`);
  }
  const pp = parts.partFor(sec ? sec.source : n.source, sec?.component);
  if (pp) L.push(`<button class="btn ghost" style="margin-top:16px" data-open-part="${esc(pp.id)}">Open ${esc(pp.name)} in Parts →</button>`);
  const cs = S.comments.filter((c) => c.target === target);
  L.push(`<div class="label">Comments</div>`);
  L.push(cs.map((c) => `<div class="comment ${c.author}${c.resolved ? " resolved" : ""}"><small><span>${esc(c.author)} · ${esc(c.map || "")}</span><button data-resolve="${esc(c.id)}">${c.resolved ? "Reopen" : "Resolve"}</button></small>${esc(c.text)}</div>`).join("") || `<p class="muted">None yet. Your agent reads these from <span class="mono">.ux/ia/comments.json</span>.</p>`);
  L.push(`<form id="cform" data-target="${esc(target)}"><textarea name="text" placeholder="Question or direction for your agent…"></textarea><button class="btn">Add comment</button></form>`);
  return L.join("");
}

function currentBrief() { return buildBrief(S.A, S.B, { aName: S.a, bName: S.b, comments: S.comments }); }
function briefHTML() {
  if (!hasB()) return `<p class="muted">The brief appears once there is an After map to compare.</p>`;
  const html = currentBrief().split("\n").map((l) => {
    if (l.startsWith("### ")) return `<h3>${mdInline(l.slice(4))}</h3>`;
    if (l.startsWith("## ")) return `<h2>${mdInline(l.slice(3))}</h2>`;
    if (l.startsWith("# ")) return `<h1>${mdInline(l.slice(2))}</h1>`;
    if (l.startsWith("- [ ] ")) return `<div>☐ ${mdInline(l.slice(6))}</div>`;
    if (l.startsWith("- ")) return `<div>· ${mdInline(l.slice(2))}</div>`;
    return l ? `<p>${mdInline(l)}</p>` : "";
  }).join("");
  return `<div style="display:flex;gap:6px;margin-bottom:14px"><button class="btn" id="saveBrief" style="margin:0">Save brief.md</button><button class="btn ghost" id="copyBrief" style="margin:0">Copy</button></div><div class="md">${html}</div>`;
}

let toastT;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.append(el);
  clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 1800);
}

// ---------- modes: Map / Parts ----------
const setHash = (h) => history.replaceState(null, "", `#${h}`);
// Theme shared by Parts and Tokens (the themes the token scan found).
let themes = [], themeId = "default";
const themeParams = (id = themeId) => {
  const th = themes.find((t) => t.id === id);
  if (!th) return {};
  // Frames pin prefers-color-scheme to the theme, so the viewer's own OS setting never leaks in.
  const scheme = th.media || (/dark/.test(th.id) ? "dark" : "light");
  return { theme: th.id, scheme, ...(th.attr ? { themeAttr: th.attr, themeVal: th.value } : {}), ...(th.cls ? { themeCls: th.cls } : {}) };
};
function setTheme(id) {
  themeId = id;
  $("#themePick").value = id;
  parts.onTheme(); tokens.onTheme();
  toast(`Theme: ${themes.find((t) => t.id === id)?.label || id}`);
}
$("#themePick").onchange = (e) => setTheme(e.target.value);
const cycleTheme = () => { if (themes.length > 1) setTheme(themes[(themes.findIndex((t) => t.id === themeId) + 1) % themes.length].id); };
const parts = initParts({
  setHash, toast, themeParams, cycleTheme, themes: () => themes,
  comments: () => S.comments,
  setComments: (list) => { S.comments = list; draw(); },
  pageLabel: (id) => S.A?.nodes.find((n) => n.id === id)?.label || allNodes()[id]?.label || id,
  showOnMap: (id) => { setMode("map"); select({ node: id, section: null }, true); focusNode(id); },
});
const tokens = initTokens({
  setHash, toast, cycleTheme,
  theme: () => themeId,
  setThemes: (list) => {
    themes = list;
    $("#themePick").innerHTML = list.map((t) => `<option value="${esc(t.id)}" ${t.id === themeId ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    $("#themeWrap").hidden = list.length < 2;
    parts.onTheme();
  },
  comments: () => S.comments,
  setComments: (list) => { S.comments = list; draw(); },
  pageLabel: (id) => S.A?.nodes.find((n) => n.id === id)?.label || allNodes()[id]?.label || id,
  showOnMap: (id) => { setMode("map"); select({ node: id, section: null }, true); focusNode(id); },
  openPart: (id) => { setMode("parts"); parts.select(id); },
});
function setMode(mode) {
  document.body.classList.toggle("mode-parts", mode === "parts");
  document.body.classList.toggle("mode-tokens", mode === "tokens");
  document.querySelectorAll("#modeTabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
  hideMenu();
  if (mode === "parts") parts.enter();
  else if (mode === "tokens") tokens.enter();
  else { setHash("map"); draw(); renderPanel(); }
}
document.querySelectorAll("#modeTabs button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

// Keys forwarded from harness frames (port + 1, same hostname) act as if pressed here.
addEventListener("message", (e) => {
  if (e.data?.type !== "lathe:key") return;
  try { if (new URL(e.origin).hostname !== location.hostname) return; } catch { return; }
  document.activeElement?.blur?.();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: e.data.key, code: e.data.code, metaKey: e.data.metaKey, ctrlKey: e.data.ctrlKey, shiftKey: e.data.shiftKey, bubbles: true, cancelable: true }));
});

// ---------- live reload ----------
new EventSource("/events").onmessage = (e) => {
  if (e.data !== "ui") load(true).catch((err) => toast(err.message));
  if (parts.loaded) parts.refresh().catch(() => {});
  if (tokens.loaded) tokens.refresh().catch(() => {});
};
load().catch((e) => { $("#empty").hidden = false; $("#empty").textContent = e.message; });
Promise.all([parts.refresh(), tokens.refresh()]).then(() => {
  const m = location.hash.match(/^#(parts|tokens)(?:\/(.+))?$/);
  if (m) { setMode(m[1]); if (m[2]) (m[1] === "parts" ? parts : tokens).select(decodeURIComponent(m[2])); }
  else renderPanel();
}).catch((e) => console.error("parts:", e));
