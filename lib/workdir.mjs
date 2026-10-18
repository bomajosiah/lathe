// Where a project's Lathe work lives: <repo>/.lathe/. Projects started before
// the rename have <repo>/.ux/ instead; it is read as-is until `lathe migrate`.
import fs from "node:fs";
import path from "node:path";

export const DIR = ".lathe";
export const LEGACY = ".ux";
export const WORK_DIRS = [DIR, LEGACY];

/** Absolute path of the project's work dir: .lathe/, else an existing legacy .ux/, else .lathe/. */
export function workDir(root) {
  const d = path.join(root, DIR);
  if (fs.existsSync(d)) return d;
  const legacy = path.join(root, LEGACY);
  return fs.existsSync(legacy) ? legacy : d;
}

/** The work dir's name as shown to people and agents (".lathe" or ".ux"). */
export const workName = (root) => path.basename(workDir(root));

/** Rename a legacy .ux/ to .lathe/. Returns what happened. */
export function migrate(root) {
  const legacy = path.join(root, LEGACY), d = path.join(root, DIR);
  if (fs.existsSync(d)) return { ok: false, why: `${DIR}/ already exists` };
  if (!fs.existsSync(legacy)) return { ok: false, why: `no ${LEGACY}/ to migrate` };
  fs.renameSync(legacy, d);
  // The Before snapshot links node_modules by absolute path, so the links still hold.
  return { ok: true };
}
