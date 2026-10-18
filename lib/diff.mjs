// Diff two IA maps by stable id. Shared by the viewer (animation, change list)
// and the CLI (brief). Ids are the contract: keep a node's or section's id when it
// survives a redesign, give it a new id only when it is genuinely new.

const byId = (list = []) => Object.fromEntries(list.map((x) => [x.id, x]));

function sectionIndex(map) {
  const idx = {};
  for (const n of map.nodes || []) for (const s of n.sections || []) idx[s.id] = { sec: s, node: n.id };
  return idx;
}

export function diffMaps(a, b) {
  const an = byId(a.nodes), bn = byId(b.nodes);
  const as = sectionIndex(a), bs = sectionIndex(b);
  const nodeStatus = {}, sectionStatus = {}, changes = [];

  // Old ids that a proposal node says it was made from (merge, replace, split).
  const fromMap = {};
  for (const n of b.nodes || []) for (const f of n.from || []) (fromMap[f] ||= []).push(n.id);

  for (const n of b.nodes || []) {
    const o = an[n.id];
    if (!o) {
      const srcs = (n.from || []).filter((f) => an[f]);
      const movedIn = (n.sections || []).filter((s) => as[s.id]).map((s) => ({ id: s.id, label: s.label, from: as[s.id].node }));
      nodeStatus[n.id] = "added";
      changes.push({
        type: srcs.length > 1 ? "merged" : srcs.length ? "split" : "added",
        node: n.id, label: n.label, path: n.path, from: srcs, movedIn, why: n.why,
      });
      continue;
    }
    const diffs = [];
    if (o.label !== n.label) diffs.push({ type: "renamed", before: o.label, after: n.label });
    if ((o.path || "") !== (n.path || "")) diffs.push({ type: "path", before: o.path, after: n.path });
    if ((o.parent || null) !== (n.parent || null)) diffs.push({ type: "moved", before: o.parent || null, after: n.parent || null });
    if ((o.group || "main") !== (n.group || "main")) diffs.push({ type: "regrouped", before: o.group, after: n.group });
    if ((o.audience || "") !== (n.audience || "")) diffs.push({ type: "audience", before: o.audience, after: n.audience });
    for (const role of new Set([...Object.keys(o.access || {}), ...Object.keys(n.access || {})]))
      if ((o.access?.[role] || "") !== (n.access?.[role] || "")) diffs.push({ type: "access", role, before: o.access?.[role], after: n.access?.[role] });

    const oids = (o.sections || []).map((s) => s.id), nids = (n.sections || []).map((s) => s.id);
    for (const s of n.sections || []) {
      if (oids.includes(s.id)) {
        const os = o.sections.find((x) => x.id === s.id);
        if (os.label !== s.label) diffs.push({ type: "section-renamed", section: s.id, before: os.label, after: s.label });
      } else if (as[s.id]) diffs.push({ type: "section-moved-in", section: s.id, label: s.label, from: as[s.id].node, why: s.why });
      else diffs.push({ type: "section-added", section: s.id, label: s.label, why: s.why });
    }
    for (const s of o.sections || []) {
      if (nids.includes(s.id)) continue;
      if (bs[s.id]) diffs.push({ type: "section-moved-out", section: s.id, label: s.label, to: bs[s.id].node });
      else diffs.push({ type: "section-removed", section: s.id, label: s.label });
    }
    const common = oids.filter((id) => nids.includes(id));
    const commonAfter = nids.filter((id) => oids.includes(id));
    if (common.join() !== commonAfter.join()) diffs.push({ type: "sections-reordered" });

    nodeStatus[n.id] = diffs.length ? "changed" : "same";
    if (diffs.length) changes.push({ type: "changed", node: n.id, label: n.label, path: n.path, diffs, why: n.why });
  }

  for (const o of a.nodes || []) {
    if (bn[o.id]) continue;
    const retired = (b.retired || []).find((r) => r.id === o.id);
    const into = fromMap[o.id] || (retired?.into ? [retired.into] : []);
    nodeStatus[o.id] = "removed";
    changes.push({ type: into.length ? "folded" : "removed", node: o.id, label: o.label, path: o.path, into, why: retired?.why });
  }

  for (const id of new Set([...Object.keys(as), ...Object.keys(bs)])) {
    const x = as[id], y = bs[id];
    if (x && y) sectionStatus[id] = x.node !== y.node ? "moved" : x.sec.label !== y.sec.label ? "changed" : "same";
    else sectionStatus[id] = x ? "removed" : "added";
  }

  for (const menu of new Set([...Object.keys(a.nav || {}), ...Object.keys(b.nav || {})])) {
    const x = a.nav?.[menu] || [], y = b.nav?.[menu] || [];
    const added = y.filter((i) => !x.includes(i)), removed = x.filter((i) => !y.includes(i));
    const reordered = !added.length && !removed.length && x.join() !== y.join();
    if (added.length || removed.length || reordered)
      changes.push({ type: "nav", menu, added, removed, reordered, before: x, after: y, why: b.navWhy?.[menu] });
  }

  const count = (t) => changes.filter((c) => c.type === t).length;
  return {
    changes, nodeStatus, sectionStatus,
    summary: {
      added: count("added") + count("split") + count("merged"),
      removed: count("removed") + count("folded"),
      changed: count("changed"),
      nav: count("nav"),
      sectionsMoved: Object.values(sectionStatus).filter((s) => s === "moved").length,
    },
  };
}

// One-line human description of a single diff entry.
export function describe(d, labelOf = (id) => id, labelBefore = labelOf) {
  switch (d.type) {
    case "renamed": return `Renamed “${d.before}” → “${d.after}”`;
    case "path": return `URL ${d.before || "—"} → ${d.after || "—"}`;
    case "moved": return `Moved under ${d.after ? labelOf(d.after) : "top level"} (was ${d.before ? labelBefore(d.before) : "top level"})`;
    case "regrouped": return `Regrouped ${d.before || "main"} → ${d.after || "main"}`;
    case "audience": return `Audience ${d.before || "—"} → ${d.after || "—"}`;
    case "access": return `${d.role}: ${d.before || "—"} → ${d.after || "—"}`;
    case "section-added": return `New section “${d.label}”`;
    case "section-removed": return `Removed section “${d.label}”`;
    case "section-moved-in": return `“${d.label}” moves in from ${labelBefore(d.from)}`;
    case "section-moved-out": return `“${d.label}” moves out to ${labelOf(d.to)}`;
    case "section-renamed": return `Section “${d.before}” → “${d.after}”`;
    case "sections-reordered": return "Sections reordered";
    default: return d.type;
  }
}
