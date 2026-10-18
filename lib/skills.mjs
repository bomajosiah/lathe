// Find the agent skills Lathe works with (github.com/bomajosiah/skills)
// wherever they're installed. Lathe uses them when present and says how to
// install them when not; it never bundles them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILLS = {
  "do-ia": "design a new structure",
  "review-ia": "critique an existing structure",
  "improve-ia": "restructure an existing product",
  "ia-vocabulary": "name IA patterns",
  "do-ui": "compose new screens without AI smells",
  "review-ui": "find AI smells and their causes",
  "improve-ui": "remove smells at the source and ratchet",
  "ui-vocabulary": "name UI and help patterns",
};
export const INSTALL = "npx skills add bomajosiah/skills";

const here = path.dirname(new URL(import.meta.url).pathname);

// Where skill folders live: an explicit override, the repo's own agent
// folders, the user's global ones, then a local checkout of the skills repo.
export function skillRoots(repo) {
  const home = os.homedir();
  return [
    process.env.LATHE_SKILLS_DIR,
    process.env.UX_SKILLS_DIR, // old name, still honoured
    repo && path.join(repo, ".claude", "skills"),
    repo && path.join(repo, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".codex", "skills"),
    path.resolve(here, "..", "..", "skills", "skills"),
  ].filter(Boolean);
}

export function findSkill(name, repo) {
  for (const root of skillRoots(repo)) {
    const dir = path.join(root, name);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return dir;
  }
  return null;
}

// The smells scanner ships inside the UI skills; any of them will do.
export function findSmellsScanner(repo) {
  for (const name of ["review-ui", "improve-ui", "do-ui"]) {
    const dir = findSkill(name, repo);
    const file = dir && path.join(dir, "scripts", "smells.mjs");
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}
