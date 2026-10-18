// Intent edits: a person (or an agent) describes a change to a component; an
// agent makes it in a git worktree of its own (<work>/edits/<id>, branch
// lathe/edit-<id>), never in the working tree; the person compares Now with
// Proposed and accepts (commit stays on the branch) or rejects (worktree and
// branch removed). Applying an accepted edit to the working tree is a separate,
// explicit step. Lathe runs no agent itself: whoever is connected does the edit.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { workDir } from "./workdir.mjs";
import { linkModules } from "./harness.mjs";

const git = (cwd, args, input) => execFileSync("git", args, { cwd, input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();
// node_modules are symlinked into a worktree so it renders; they're never part of an edit.
const NOT_MODULES = [":(exclude)node_modules", ":(exclude)**/node_modules"];

export function editsStore(root) {
  const work = workDir(root);
  const file = path.join(work, "ui", "edits.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const write = (list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n"); };
  const dirOf = (id) => path.join(work, "edits", id);
  const find = (list, id) => { const e = list.find((x) => x.id === id); if (!e) throw new Error(`No edit ${id}`); return e; };
  const update = (id, fn) => { const list = read(); const e = find(list, id); fn(e); e.updatedAt = new Date().toISOString(); write(list); return e; };

  /** Record an intent: { text, target: { part, variant?, theme?, element? }, author }. */
  function create({ text, target = {}, author = "human" }) {
    if (!text || !String(text).trim()) throw new Error("Describe the change.");
    const list = read();
    const id = new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6);
    const e = { id, text: String(text).trim().slice(0, 2000), target, author, status: "open", createdAt: new Date().toISOString() };
    list.push(e); write(list);
    return e;
  }

  /** Give the agent a worktree on its own branch, from HEAD, with the repo's dependencies linked. */
  function begin(id, { agent = "agent" } = {}) {
    const list = read(), e = find(list, id);
    if (e.status !== "open") throw new Error(`Edit ${id} is ${e.status}, not open.`);
    try { git(root, ["rev-parse", "--is-inside-work-tree"]); } catch { throw new Error("Intent edits need a git repo."); }
    const dir = dirOf(id), branch = `lathe/edit-${id}`;
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(root, ["worktree", "add", "-b", branch, dir, "HEAD"]);
    linkModules(root, dir);
    const dirty = git(root, ["status", "--porcelain", "--untracked-files=no"]).split("\n").filter(Boolean).map((l) => l.slice(3));
    Object.assign(e, { status: "editing", branch, dir, base: git(dir, ["rev-parse", "HEAD"]).trim(), agent, startedAt: new Date().toISOString(), dirtyAtStart: dirty });
    write(list);
    return e;
  }

  /** The agent's changes in the worktree, against where it started. */
  function diff(id) {
    const e = find(read(), id);
    if (!e.dir || !fs.existsSync(e.dir)) return { patch: e.patch || "", files: e.files || [] };
    git(e.dir, ["add", "-A", "-N", "--", ".", ...NOT_MODULES]);
    const patch = git(e.dir, ["diff", e.base, "--", ".", ...NOT_MODULES]);
    const files = git(e.dir, ["diff", "--name-only", e.base, "--", ".", ...NOT_MODULES]).split("\n").filter(Boolean);
    return { patch, files };
  }

  // Raw values the edit introduces: the system says tokens, props and variants (decision a).
  // A value already on a removed line of the same hunk was there before, so it isn't flagged.
  function offSystem(patch) {
    const raw = (l) => [...(l.match(/#[0-9a-fA-F]{3,8}\b/g) || []), ...(l.match(/rgba?\([^)]*\)/g) || []), ...(l.match(/\b\d+(\.\d+)?px\b/g) || [])];
    const out = [];
    let file = null, hunk = [];
    const flush = () => {
      const before = new Set(hunk.filter((x) => x.sign === "-").flatMap((x) => raw(x.l)));
      for (const x of hunk) {
        if (x.sign !== "+") continue;
        if (/\.(css|scss|less)$/.test(file || "") && /^\s*--[\w-]+\s*:/.test(x.l)) continue; // defining a token is a system change
        const fresh = [...new Set(raw(x.l))].filter((v) => !before.has(v));
        if (fresh.length) out.push({ file, line: x.l.trim().slice(0, 160), values: fresh.slice(0, 6) });
      }
      hunk = [];
    };
    for (const line of patch.split("\n")) {
      if (line.startsWith("+++ b/")) { flush(); file = line.slice(6); continue; }
      if (line.startsWith("@@") || line.startsWith("diff ")) { flush(); continue; }
      if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) hunk.push({ sign: line[0], l: line.slice(1) });
    }
    flush();
    return out;
  }

  /** The agent says it's done: record the diff and anything off-system for review. */
  function submit(id, { summary = "" } = {}) {
    const st = find(read(), id).status;
    if (st === "open") throw new Error(`Edit ${id} hasn't started: begin_edit gives you its worktree.`);
    const { patch, files } = diff(id);
    if (!files.length) throw new Error("No changes in the worktree yet. Edit the files under the edit's dir, then submit.");
    return update(id, (e) => {
      if (e.status !== "editing" && e.status !== "proposed") throw new Error(`Edit ${id} is ${e.status}.`);
      Object.assign(e, { status: "proposed", summary: String(summary).slice(0, 2000), files, offSystem: offSystem(patch), submittedAt: new Date().toISOString() });
    });
  }

  /** Accept: commit on the edit's branch, remove the worktree, keep the branch; log it. */
  function accept(id) {
    const e0 = find(read(), id);
    if (e0.status !== "proposed") throw new Error(`Only a proposed edit can be accepted (this one is ${e0.status}).`);
    const { patch, files } = diff(id);
    git(e0.dir, ["add", "-A", "--", ".", ...NOT_MODULES]);
    git(e0.dir, ["-c", "user.name=Lathe", "-c", "user.email=lathe@localhost", "commit", "-q", "--no-verify", "-m", `${e0.text.split("\n")[0].slice(0, 72)}\n\n${e0.summary || ""}\n\nLathe edit ${id}`.trim()]);
    const commit = git(e0.dir, ["rev-parse", "HEAD"]).trim();
    git(root, ["worktree", "remove", "--force", e0.dir]);
    const e = update(id, (x) => Object.assign(x, { status: "accepted", commit, files, patch, dir: null, acceptedAt: new Date().toISOString() }));
    const log = path.join(work, "ui", "edits.md");
    fs.appendFileSync(log, `${fs.existsSync(log) ? "" : "# Accepted edits\n\n"}## ${e.text.split("\n")[0]}\n\n${e.acceptedAt.slice(0, 10)} · ${e.target?.part || ""} · branch \`${e.branch}\` at \`${commit.slice(0, 8)}\`\n\n${e.summary || ""}\n\nFiles: ${files.map((f) => `\`${f}\``).join(", ")}\n\n`);
    return e;
  }

  /** Reject: remove the worktree and the branch. */
  function reject(id) {
    const e0 = find(read(), id);
    if (e0.status === "accepted") throw new Error("Already accepted; delete the branch by hand if you want it gone.");
    if (e0.dir && fs.existsSync(e0.dir)) git(root, ["worktree", "remove", "--force", e0.dir]);
    if (e0.branch) try { git(root, ["branch", "-D", e0.branch]); } catch {}
    return update(id, (x) => Object.assign(x, { status: "rejected", dir: null, rejectedAt: new Date().toISOString() }));
  }

  /** Apply an accepted edit's patch to the working tree (only if it applies cleanly). */
  function apply(id) {
    const e0 = find(read(), id);
    if (e0.status !== "accepted") throw new Error("Accept the edit first.");
    const patch = git(root, ["diff", e0.base, e0.commit, "--", ".", ...NOT_MODULES]);
    try { git(root, ["apply", "--check", "-"], patch); }
    catch (err) { throw new Error(`It doesn't apply cleanly to the working tree (${String(err.stderr || err.message).split("\n")[0]}). Merge the branch instead: git merge ${e0.branch}`); }
    git(root, ["apply", "-"], patch);
    return update(id, (x) => Object.assign(x, { applied: true, appliedAt: new Date().toISOString() }));
  }

  return { list: read, get: (id) => find(read(), id), create, begin, submit, diff, accept, reject, apply, dirOf };
}
