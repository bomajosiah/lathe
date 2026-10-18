#!/usr/bin/env node
// lathe: the workbench where design decisions on a coded system get made and
// written back into code. Map (IA), Parts (components), Tokens, Smells.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scan } from "../lib/scan.mjs";
import { serve } from "../lib/server.mjs";
import { buildBrief } from "../lib/brief.mjs";
import { diffMaps } from "../lib/diff.mjs";
import { scanParts, mergeInventory } from "../lib/parts-scan.mjs";
import { makeBase } from "../lib/harness.mjs";
import { workDir, migrate, DIR, LEGACY } from "../lib/workdir.mjs";

const [cmd, repoArg = ".", ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const root = path.resolve(repoArg);
const work = workDir(root), W = `${path.basename(work)}/`;
const ia = path.join(work, "ia");
const readMap = (n) => JSON.parse(fs.readFileSync(path.join(ia, `${n}.json`), "utf8"));
const write = (n, data) => fs.writeFileSync(path.join(ia, n), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");

function exclude() {
  const ex = path.join(root, ".git", "info", "exclude");
  if (!fs.existsSync(path.dirname(ex))) return "not a git repo";
  const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : "";
  let add = "";
  for (const d of [DIR, LEGACY]) if (!new RegExp(`^/?\\${d}/?$`, "m").test(cur)) add += `${d}/\n`;
  if (add) fs.appendFileSync(ex, `${cur.endsWith("\n") || !cur ? "" : "\n"}${add}`);
  return "kept out of git via .git/info/exclude";
}

function doScan() {
  fs.mkdirSync(ia, { recursive: true });
  const m = scan(root);
  write("scan.json", m);
  const secs = m.nodes.reduce((a, n) => a + n.sections.length, 0);
  console.log(`scan: ${m.nodes.length} pages, ${secs} sections, ${m.links.length} links (${m.snapshot.frameworks.join(", ") || "no framework detected"}) → ${W}ia/scan.json`);
  return m;
}

const ARCHIVE_DEFAULT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "archive");
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (skip(a, e)) continue;
    if (e.isDirectory()) copyDir(a, b, skip);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

switch (cmd) {
  case "start": {
    // One command for a new or existing project: scan what's missing, then serve.
    const ui = path.join(work, "ui");
    if (!fs.existsSync(path.join(ia, "before.json"))) {
      const m = doScan();
      write("before.json", { ...m, title: "Before (uncurated scan)" });
      console.log("before.json seeded from the scan: ask your agent to curate it (lathe/AGENTS.md).");
    }
    fs.mkdirSync(ui, { recursive: true });
    if (!fs.existsSync(path.join(ui, "inventory.json"))) {
      let iaMap = null; try { iaMap = readMap("before"); } catch {}
      const inv = scanParts(root, { ia: iaMap });
      fs.writeFileSync(path.join(ui, "inventory.json"), JSON.stringify(inv, null, 2) + "\n");
      console.log(`parts: ${inv.parts.length} components${inv.storybook ? ` · ${inv.storybook.stories} Storybook stories as variants` : ""}`);
    }
    if (!fs.existsSync(path.join(ui, "tokens.json"))) {
      const { scanTokens } = await import("../lib/tokens-scan.mjs");
      const inv = scanTokens(root, { inventory: JSON.parse(fs.readFileSync(path.join(ui, "inventory.json"), "utf8")) });
      fs.writeFileSync(path.join(ui, "tokens.json"), JSON.stringify(inv, null, 2) + "\n");
      console.log(`tokens: ${inv.tokens.length} across ${inv.themes.length} theme(s)`);
    }
    console.log(`${W} ${exclude()}`);
    serve({ root, port: Number(flag("port", 4747)), app: flag("app") });
    break;
  }
  case "archive": {
    // Copy the project's work dir somewhere durable (outside the repo).
    const src = work;
    if (!fs.existsSync(src)) { console.log("Nothing to archive: no work dir yet."); break; }
    const dest = path.join(path.resolve(flag("to", ARCHIVE_DEFAULT)), path.basename(root), flag("label", stamp()));
    copyDir(src, dest, (p, e) => (e.isDirectory() && p.endsWith(path.join("ui", "base"))) || /harness-errors\.json$|overrides\.css$/.test(p));
    fs.writeFileSync(path.join(dest, "ARCHIVE.json"), JSON.stringify({ repo: root, at: new Date().toISOString() }, null, 2) + "\n");
    console.log(`archived ${W} → ${dest}`);
    break;
  }
  case "restore": {
    const from = flag("from");
    if (!from || !fs.existsSync(from)) { console.log("usage: lathe restore <repo> --from <archive dir>"); break; }
    const dest = path.join(root, DIR);
    if (fs.existsSync(work)) {
      // Never lose current work: archive it first, outside the repo.
      const keep = path.join(ARCHIVE_DEFAULT, path.basename(root), `before-restore-${stamp()}`);
      copyDir(work, keep, (p, e) => e.isDirectory() && p.endsWith(path.join("ui", "base")));
      fs.rmSync(work, { recursive: true, force: true });
      console.log(`current ${W} archived first → ${keep}`);
    }
    copyDir(path.resolve(from), dest, (p) => /ARCHIVE\.json$/.test(p));
    // Archives skip the bulky Before snapshot; rebuild it from the recorded ref.
    const baseInfo = path.join(dest, "ui", "base.json");
    if (fs.existsSync(baseInfo)) {
      const { ref } = JSON.parse(fs.readFileSync(baseInfo, "utf8"));
      try { makeBase(root, ref); console.log(`Before rebuilt from ${ref}`); }
      catch { fs.rmSync(baseInfo); console.log(`couldn't rebuild Before from ${ref} here; take a new one with: lathe base <repo>`); }
    }
    console.log(`restored → ${dest}  (${exclude()})`);
    break;
  }
  case "init": {
    const m = doScan();
    if (!fs.existsSync(path.join(ia, "before.json"))) {
      write("before.json", { ...m, title: "Before (uncurated scan)" });
      console.log("before.json seeded from the scan. Curate it next (see lathe/AGENTS.md).");
    }
    console.log(`${W} ${exclude()}`);
    break;
  }
  case "migrate": {
    const r = migrate(root);
    console.log(r.ok ? `${LEGACY}/ → ${DIR}/  (${exclude()})` : `nothing to do: ${r.why}`);
    break;
  }
  case "scan": doScan(); break;
  case "serve": serve({ root, port: Number(flag("port", 4747)), app: flag("app") }); break;
  case "parts": {
    const ui = path.join(work, "ui");
    fs.mkdirSync(ui, { recursive: true });
    const file = path.join(ui, "inventory.json");
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    let iaMap = null;
    try { iaMap = readMap("before"); } catch {}
    const inv = mergeInventory(scanParts(root, { ia: iaMap }), old);
    fs.writeFileSync(file, JSON.stringify(inv, null, 2) + "\n");
    const dupes = inv.parts.filter((p) => p.dupes.length).length;
    console.log(`parts: ${inv.parts.length} components, ${inv.parts.filter((p) => !p.instances).length} unused, ${dupes} possible duplicates → ${W}ui/inventory.json`);
    if (inv.storybook) console.log(`storybook: ${inv.storybook.stories} stories in ${inv.storybook.files} files (${inv.storybook.main})${inv.storybook.unlinked.length ? `; not linked to a component: ${inv.storybook.unlinked.join(", ")}` : ""}`);
    console.log(`${W} ${exclude()}`);
    break;
  }
  case "tokens": {
    const { scanTokens } = await import("../lib/tokens-scan.mjs");
    const ui = path.join(work, "ui");
    fs.mkdirSync(ui, { recursive: true });
    let inventory = null;
    try { inventory = JSON.parse(fs.readFileSync(path.join(ui, "inventory.json"), "utf8")); } catch {}
    const inv = scanTokens(root, { inventory });
    fs.writeFileSync(path.join(ui, "tokens.json"), JSON.stringify(inv, null, 2) + "\n");
    const c = inv.checks;
    console.log(`tokens: ${inv.tokens.length} across ${inv.themes.length} theme(s) · ${c.drift.length} hard-coded values (${c.drift.filter((d) => d.suggest).length} match a token) · ${c.dupes.length} duplicates · ${c.unused.length} unused · ${c.contrast.filter((x) => !x.pass).length} contrast fails → ${W}ui/tokens.json`);
    console.log(`${W} ${exclude()}`);
    break;
  }
  case "base": {
    const b = makeBase(root, flag("ref", "HEAD"));
    console.log(`base: ${b.ref} (${b.commit.slice(0, 8)}) → ${W}ui/base/  (the "Before" side in Parts)`);
    break;
  }
  case "diff": {
    const d = diffMaps(readMap(flag("from", "before")), readMap(flag("to", "after")));
    console.log(JSON.stringify(d.summary));
    break;
  }
  case "brief": {
    const from = flag("from", "before"), to = flag("to", "after");
    let comments = [];
    try { comments = JSON.parse(fs.readFileSync(path.join(ia, "comments.json"), "utf8")); } catch {}
    write("brief.md", buildBrief(readMap(from), readMap(to), { aName: from, bName: to, comments }));
    console.log(`→ ${W}ia/brief.md`);
    break;
  }
  case "smells": {
    // The scanner lives in the UI skills; use whichever copy is installed.
    const { findSmellsScanner, INSTALL } = await import("../lib/skills.mjs");
    const scanner = flag("scanner") || findSmellsScanner(root);
    if (!scanner) {
      console.log(`smells needs the UI skills (review-ui, improve-ui or do-ui). Install them with:\n  ${INSTALL} --skill review-ui\nor point at a copy: --scanner <path/to/smells.mjs>`);
      process.exitCode = 1;
      break;
    }
    // Audited repos never carry studio files, so everything stays in the work dir unless told otherwise.
    const ui = path.join(path.basename(work), "ui");
    const args = [...rest];
    if (!args.includes("--out")) args.push("--out", ui);
    if (!args.includes("--baseline-file")) args.push("--baseline-file", path.join(ui, "smells-baseline.json"));
    if (!args.includes("--config")) args.push("--config", path.join(ui, "smells.config.json"));
    const { runSmells } = await import(pathToFileURL(scanner).href);
    console.log(`scanner: ${scanner}`);
    runSmells(root, args);
    exclude();
    break;
  }
  case "skills": {
    const { SKILLS, findSkill, INSTALL } = await import("../lib/skills.mjs");
    let missing = 0;
    for (const [name, job] of Object.entries(SKILLS)) {
      const dir = findSkill(name, root);
      if (!dir) missing++;
      console.log(`${dir ? "✓" : "·"} ${name.padEnd(14)} ${job}${dir ? `  (${dir.replace(process.env.HOME, "~")})` : ""}`);
    }
    if (missing) console.log(`\n${missing} not installed. ${INSTALL}`);
    break;
  }
  default:
    console.log(`usage: lathe <command> <repo> [options]

  start <repo> [--port 4747]        new or existing project: scan whatever's missing, then serve
  init  <repo>                      scan the repo, seed .lathe/ia/before.json, keep .lathe/ out of git
  scan  <repo>                      re-scan into .lathe/ia/scan.json (never touches before/after)
  serve <repo> [--port 4747] [--app web]  open the workbench (live-reloads when maps change)
  parts <repo>                      scan components into .lathe/ui/inventory.json (keeps notes/status)
  base  <repo> [--ref HEAD]         snapshot a git ref as the "Before" side for components
  tokens <repo>                     scan design tokens and checks into .lathe/ui/tokens.json
  smells <repo> [--baseline] [--check]   AI-smell scan with the installed UI skills' scanner → .lathe/ui/smells.md
  skills [repo]                     which of the companion skills are installed, and where
  archive <repo> [--to dir] [--label name]   copy .lathe/ somewhere durable (default lathe/archive/)
  restore <repo> --from <archive dir>        put an archived work dir back
  migrate <repo>                    rename a project's old .lathe/ to .lathe/
  diff  <repo> [--from a --to b]    print a change summary
  brief <repo> [--from a --to b]    write .lathe/ia/brief.md, the rework reference`);
}
