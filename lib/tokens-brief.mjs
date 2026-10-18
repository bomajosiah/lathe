// Token brief: proposed value changes (the live overrides) with where to make
// them and what they reach, contrast impact, and the standing checks.
import { resolver, parseColor, contrast } from "./tokens-core.mjs";

export function involves(inv, raw, name) {
  const byName = Object.fromEntries(inv.tokens.map((t) => [t.name, t]));
  const seen = new Set();
  const walk = (v) => {
    for (const m of String(v).matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (m[1] === name) return true;
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const t = byName[m[1]];
      if (t && Object.values(t.values).some(walk)) return true;
    }
    return false;
  };
  return walk(raw);
}

export function contrastWith(inv, overrides) {
  const R = resolver(inv.tokens, overrides || {});
  const R0 = resolver(inv.tokens);
  const out = [];
  for (const p of inv.checks?.pairs || []) for (const th of inv.themes.map((t) => t.id)) {
    const before = contrast(parseColor(R0.resolve(p.fg, th)), parseColor(R0.resolve(p.bg, th)));
    const after = contrast(parseColor(R.resolve(p.fg, th)), parseColor(R.resolve(p.bg, th)));
    if (after != null) out.push({ ...p, theme: th, before, ratio: after, pass: after >= 4.5 });
  }
  return out;
}

export function buildTokensBrief(inv, { overrides = {}, comments = [], pageLabel = (x) => x } = {}) {
  const byName = Object.fromEntries(inv.tokens.map((t) => [t.name, t]));
  const L = [`# Token brief: ${inv.product || "Product"}`, "", `Generated ${new Date().toLocaleDateString("en-CA")}`, ""];
  const names = Object.keys(overrides).filter((n) => Object.values(overrides[n]).some((v) => v != null && v !== ""));
  L.push("## Proposed changes", "");
  if (!names.length) L.push("_No overrides yet. Edit a token in the workbench to propose one._", "");
  for (const n of names) {
    const t = byName[n];
    if (!t) continue;
    for (const [th, v] of Object.entries(overrides[n])) {
      if (v == null || v === "") continue;
      const def = t.defs[th] || t.defs.default;
      const src = inv.sources.find((s) => s.file === def?.file);
      L.push(`### \`${n}\`${th !== "default" ? ` (${th})` : ""}: \`${t.values[th] ?? t.values.default}\` → \`${v}\``);
      if (t.comment) L.push("", `Purpose: ${t.comment}`);
      L.push("", `Edit: ${src?.generated ? `\`${src.source || "the token source"}\` (generated into \`${def.file}\`; regenerate after)` : `\`${def?.file}:${def?.line}\``}`);
      const reach = [`${t.uses} direct uses`, t.usedBy.length ? `${t.usedBy.length} tokens build on it (${t.usedBy.slice(0, 6).map((x) => `\`${x}\``).join(", ")}${t.usedBy.length > 6 ? "…" : ""})` : null, `${t.components.length} components`, t.pages.length ? `pages: ${t.pages.map(pageLabel).join(", ")}` : null, t.global ? "global element styles" : null].filter(Boolean);
      L.push(`Reach: ${reach.join(" · ")}`, "");
    }
  }
  const c = contrastWith(inv, overrides).filter((x) => names.length && x.before !== x.ratio);
  if (c.length) {
    L.push("## Contrast impact", "");
    for (const x of c) L.push(`- \`${x.selector}\` [${x.theme}]: ${x.before} → ${x.ratio}${x.pass ? "" : " **fails AA (4.5)**"}`);
    L.push("");
  }
  const ch = inv.checks || {};
  const fails = contrastWith(inv, overrides).filter((x) => !x.pass);
  L.push("## Standing checks", "");
  L.push(`- Contrast: ${fails.length ? `${fails.length} pairs below 4.5` : "all checked pairs pass AA"}`);
  const sugg = (ch.drift || []).filter((d) => d.suggest);
  L.push(`- Hard-coded values: ${(ch.drift || []).length} (${sugg.length} match an existing token exactly)`);
  for (const [tok, n] of Object.entries(sugg.reduce((a, d) => ((a[d.suggest] = (a[d.suggest] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 8)) L.push(`  - ${n}× could use \`${tok}\``);
  if ((ch.dupes || []).length) L.push(`- Duplicates: ${ch.dupes.map((d) => d.names.map((x) => `\`${x}\``).join(" = ")).join("; ")}`);
  if ((ch.unused || []).length) L.push(`- Unused: ${ch.unused.length} tokens (${ch.unused.slice(0, 10).map((x) => `\`${x}\``).join(", ")}${ch.unused.length > 10 ? "…" : ""})`);
  L.push("");
  const open = comments.filter((x) => !x.resolved && x.target.startsWith("token:"));
  if (open.length) { L.push("## Open comments", ""); for (const x of open) L.push(`- **${x.author}** on \`${x.target.slice(6)}\`: ${x.text}`); L.push(""); }
  return L.join("\n");
}
