// Turn a before → after diff into the markdown brief an agent (or you) works
// from when reworking the repo. Shared by the viewer and `lathe brief`.
import { diffMaps, describe } from "./diff.mjs";

const strip = (src) => (src || "").replace(/:\d+(-\d+)?$/, "");

export function buildBrief(a, b, { aName = "before", bName = "after", comments = [] } = {}) {
  const d = diffMaps(a, b);
  const all = { ...Object.fromEntries((a.nodes || []).map((n) => [n.id, n])), ...Object.fromEntries((b.nodes || []).map((n) => [n.id, n])) };
  const labelOf = (id) => all[id]?.label || id;
  const labelBefore = (id) => (a.nodes || []).find((n) => n.id === id)?.label || labelOf(id);
  const secSrc = {};
  for (const m of [a, b]) for (const n of m.nodes || []) for (const s of n.sections || []) if (s.source) secSrc[s.id] = strip(s.source);

  const L = [];
  const product = b.product || a.product || "Product";
  L.push(`# IA brief: ${product}`, "");
  L.push(`\`${aName}\` → \`${bName}\` · generated ${new Date().toLocaleDateString("en-CA")}`);
  if (a.snapshot?.commit) L.push(`Snapshot of commit \`${a.snapshot.commit.slice(0, 8)}\` (${a.snapshot.date || "undated"}).`);
  L.push("");
  if (b.summary) L.push("## Intent", "", b.summary, "");

  const s = d.summary;
  L.push("## At a glance", "");
  L.push(`- ${s.added} new · ${s.removed} removed or folded · ${s.changed} changed · ${s.sectionsMoved} sections moved · ${s.nav} menu changes`, "");

  L.push("## Changes", "");
  const checklist = [];
  let i = 0;
  for (const c of d.changes) {
    if (c.type === "nav") continue;
    i++;
    const touch = new Set();
    const node = all[c.node];
    if (node?.source) touch.add(strip(node.source));
    const path = c.path ? ` (\`${c.path}\`)` : "";
    if (c.type === "added" || c.type === "split" || c.type === "merged") {
      const verb = c.type === "merged" ? `Merge ${c.from.map(labelOf).join(" + ")} into` : c.type === "split" ? `Split from ${c.from.map(labelOf).join(", ")}:` : "Add";
      L.push(`### ${i}. ${verb} “${c.label}”${path}`);
      if (c.why) L.push("", `**Why:** ${c.why}`);
      if (c.movedIn?.length) {
        L.push("", "Sections moving in:");
        for (const m of c.movedIn) { L.push(`- ${m.label} (from ${labelBefore(m.from)})`); if (secSrc[m.id]) touch.add(secSrc[m.id]); }
      }
      const fresh = (node?.sections || []).filter((x) => !c.movedIn?.some((m) => m.id === x.id));
      if (fresh.length) { L.push("", "New sections:"); for (const x of fresh) L.push(`- ${x.label}${x.why ? ` (${x.why})` : ""}`); }
      checklist.push(`Build “${c.label}”${path}`);
      if (a.snapshot?.routes) touch.add(a.snapshot.routes);
    } else if (c.type === "removed" || c.type === "folded") {
      L.push(`### ${i}. ${c.type === "folded" ? `Fold “${c.label}” into ${c.into.map(labelOf).join(", ")}` : `Remove “${c.label}”`}${path}`);
      if (c.why) L.push("", `**Why:** ${c.why}`);
      checklist.push(`${c.type === "folded" ? "Fold" : "Remove"} “${c.label}” and redirect or clean up its links`);
      if (a.snapshot?.routes) touch.add(a.snapshot.routes);
    } else {
      L.push(`### ${i}. Change “${c.label}”${path}`);
      if (c.why) L.push("", `**Why:** ${c.why}`);
      L.push("");
      for (const x of c.diffs) {
        L.push(`- ${describe(x, labelOf, labelBefore)}${x.why ? ` (${x.why})` : ""}`);
        if (x.section && secSrc[x.section]) touch.add(secSrc[x.section]);
        if (x.type === "path" && a.snapshot?.routes) touch.add(a.snapshot.routes);
      }
      checklist.push(`Rework “${c.label}”: ${c.diffs.map((x) => x.type.replace("section-", "section ")).join(", ")}`);
    }
    if (touch.size) L.push("", `Touch: ${[...touch].map((t) => `\`${t}\``).join(", ")}`);
    L.push("");
  }
  if (!i) L.push("_No page or section changes._", "");

  const navs = d.changes.filter((c) => c.type === "nav");
  if (navs.length) {
    L.push("## Navigation", "");
    for (const n of navs) {
      L.push(`**${n.menu}:** ${n.before.map(labelOf).join(" · ") || "—"} → ${n.after.map(labelOf).join(" · ") || "—"}`);
      if (n.why) L.push("", `Why: ${n.why}`);
      L.push("");
      checklist.push(`Update ${n.menu} navigation`);
    }
  }

  const open = comments.filter((c) => !c.resolved && (c.map === bName || c.map === aName));
  if (open.length) {
    L.push("## Open comments", "");
    for (const c of open) L.push(`- **${c.author}** on ${c.target.replace(/^(node|section):/, "")}: ${c.text}`);
    L.push("");
  }

  L.push("## Checklist", "", ...checklist.map((c) => `- [ ] ${c}`), "- [ ] Re-scan and confirm the live product matches the after map", "");
  return L.join("\n");
}
