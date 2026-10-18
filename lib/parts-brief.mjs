// Component brief: what changed since the base snapshot, what's flagged, what's
// open. Shared by the workbench (Parts → Brief) and anything that wants it.

export function buildPartsBrief(inv, { changed = [], base = null, comments = [] } = {}) {
  const parts = inv.parts || [];
  const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
  const L = [`# Component brief: ${inv.product || "Product"}`, ""];
  L.push(`Generated ${new Date().toLocaleDateString("en-CA")}${base ? ` · Before = \`${base.ref}\` (\`${base.commit.slice(0, 8)}\`)` : ""}`, "");

  const edited = parts.filter((p) => changed.includes(p.file));
  L.push("## Changed since Before", "");
  if (edited.length) {
    const files = [...new Set(edited.map((p) => p.file))];
    for (const f of files) {
      const ps = edited.filter((p) => p.file === f);
      const reach = [...new Set(ps.flatMap((p) => p.pages))];
      L.push(`- \`${f}\`: ${ps.map((p) => p.name).join(", ")}${reach.length ? ` (shows on ${reach.join(", ")})` : ps.some((p) => p.global) ? " (global)" : ""}`);
    }
  } else L.push("_Nothing yet._");
  const otherFiles = changed.filter((f) => !parts.some((p) => p.file === f));
  if (otherFiles.length) L.push("", `Other files changed: ${otherFiles.map((f) => `\`${f}\``).join(", ")}`);
  L.push("");

  const flagged = parts.filter((p) => p.status || p.notes);
  if (flagged.length) {
    L.push("## Decisions and notes", "");
    for (const p of flagged) L.push(`- **${p.name}**${p.status ? ` [${p.status}]` : ""}: ${p.notes || ""}${p.why ? ` Why: ${p.why}` : ""}`);
    L.push("");
  }

  const dupeGroups = [];
  const seen = new Set();
  for (const p of parts) if (p.dupes?.length && !seen.has(p.id)) {
    const g = [p, ...p.dupes.map((id) => byId[id]).filter(Boolean)];
    g.forEach((x) => seen.add(x.id));
    dupeGroups.push(g);
  }
  if (dupeGroups.length) {
    L.push("## Possible duplicates", "");
    for (const g of dupeGroups) L.push(`- ${g.map((x) => `${x.name} (\`${x.file}\`)`).join(" · ")}`);
    L.push("");
  }

  const unused = parts.filter((p) => !p.instances && p.kind !== "page" && p.name !== "App");
  if (unused.length) L.push("## Unused", "", ...unused.map((p) => `- ${p.name} (\`${p.file}\`)`), "");

  const open = comments.filter((c) => !c.resolved && c.target.startsWith("part:"));
  if (open.length) {
    L.push("## Open comments", "");
    for (const c of open) L.push(`- **${c.author}** on ${byId[c.target.slice(5)]?.name || c.target.slice(5)}: ${c.text}`);
    L.push("");
  }
  return L.join("\n");
}
