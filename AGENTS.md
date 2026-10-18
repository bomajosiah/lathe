# Lathe: instructions for agents

You map a product's information architecture (IA), help the human redesign it, and hand back a brief they rework the repo from. This is human + AI work: you inspect, propose and write files; the human makes the structural calls.

The human watches the workbench (`lathe serve <repo>`, http://localhost:4747) while you work. It reloads whenever you write a file in `<repo>/.lathe/ia/`, so write early and often rather than describing maps in chat.

If the repo has its own agent rules (an `AGENTS.md` or `CLAUDE.md`, or a workspace one above it), follow them too. During mapping you change **no** product code, and `.lathe/` is never committed. Projects from before the rename may still have `.ux/` instead of `.lathe/`: Lathe reads it as-is, so use whichever exists (`lathe migrate <repo>` renames it once nobody else is working there).

## 1. Snapshot: curate `before.json`

1. `lathe start <repo>` (new or existing project: scans what's missing and serves), or `init` / `scan` on their own. Read `.lathe/ia/scan.json`. It's a heuristic skeleton: routes are usually right, sections are rough, and labels come from code.
2. Read the router file (`snapshot.routes`), each page file, and the shared chrome (header, footer, sidebars). Build `before.json` so it describes **what a user experiences**, not how the code is organised:
   - **Pages** are destinations with a URL. Modals, tabs and steps that change what the user is doing count as sections or notes, unless they have their own URL.
   - **Sections** are the blocks a user scans, in order. Label them in user language ("Pricing", not `PlansGrid`), and keep the component path in `source`.
   - **Parent** is the *perceived* hierarchy, which may differ from URL nesting. Say so in `notes` when they disagree.
   - **Groups** separate audiences or zones: public, signed-in, staff, utility. A page in the wrong group is a finding.
   - **States** that change the page a lot (paywall, empty, expired, unverified) go in as sections with `notes`, or as page `notes`.
   - **Links** that matter: CTAs, flows, cross-links. Leave out the header/footer links; those live in `nav`.
3. **Use the browser where the code is ambiguous**: conditional sections, redirects, auth gates, client-side tabs, content from a CMS. Note in `snapshot.sources` that you did (`"browser"`). Never invent sections you couldn't confirm.
4. Write `notes` on pages for IA problems you notice (orphans, staff pages in public nav, duplicated destinations, mislabelled nav, very long pages), but **don't fix them in `before.json`**. Before is the truth as shipped.
5. Stop. Walk the human through the map: what's there, what surprised you, the 3–5 biggest IA issues. Ask what they want to change before proposing anything.

## 2. Redesign: write `after.json`

- Start from a copy of `before.json`. Set `title` and `summary` (the intent in two or three sentences).
- **Keep ids stable.** The diff and the animation match by id. A page or section that survives keeps its id, even if renamed or moved. Give an id only to something genuinely new.
- A new page built from old ones lists them in `from: [...]`. A page that disappears goes in `retired: [{ id, into?, why }]`.
- Put a `why` on every changed page and every new section. One sentence, about the user, not the code. Put nav reasons in `navWhy`.
- For alternatives, write `after-b.json`, `after-c.json` and let the human compare them in the pickers.
- Read `.lathe/ia/comments.json` after every round. Reply by appending `{ "id", "map", "target", "author": "agent", "text", "at" }`. Don't delete the human's comments; they resolve them.
- Lay out options with a recommendation. Structural choices (what's primary, what merges, what's hidden) are the human's call.

## 3. Brief

When the human is happy: `lathe brief <repo>` writes `.lathe/ia/brief.md` (or they click *Save brief.md*). Review it, add anything the generator can't know (redirects for retired URLs, analytics, SEO impact), and use it as the checklist when reworking the repo, on a branch, per the repo's own rules. After the rework, re-scan and check that the live product matches `after.json`.

## Parts: components

The **Parts** tab in the workbench is the same loop for components: inventory, isolate, change, compare before/after, brief. It renders each component on its own through the app's *own* Vite (its config, CSS, fonts, aliases), started by the workbench on port 4748. Nothing gets installed in the repo. Vite + React only for now.

1. **Inventory.** `lathe parts <repo>` writes `.lathe/ui/inventory.json`: every component, its props (with TS types), where it's used, which pages it reaches, likely duplicates, and design-debt signals (inline styles, raw colours). Re-scans keep `notes`, `status` (e.g. `keep`, `merge`, `fix`, `remove`), `group`, `tags` and `why`, so annotate in place. Walk the human through duplicates and one-offs before changing anything.
2. **Before.** `lathe base <repo> [--ref HEAD]` snapshots a git ref into `.lathe/ui/base/`. That's the "Before" side; the working tree is "After". Take it *before* you start editing (the human can also click *Snapshot HEAD*).
3. **Stories first, then fixtures.** If the repo has Storybook, the scan links its stories to components (`stories` on each part in the inventory; `storybook` at the top says how many, and which story files it couldn't link). A component with stories renders them as its variants, so don't write fixtures for it: if a state is missing, the right fix is usually a new story in the repo (that's a code change, on a branch, the human's call). Stories render with their args and decorators; if one needs a provider Storybook gets from somewhere Lathe can't see, put it in `wrapper.tsx` (step 4).

   For components without stories, write fixtures. Most components need props. Write `.lathe/ui/fixtures/<id>.json` (the exact path is shown in the component's Details), one entry per variant:
   ```json
   { "variants": {
       "default": { "score": 72, "grade": "B" },
       "empty":   { "score": 0, "grade": "F", "onRetry": "$fn" },
       "page":    { "$route": "/r/abc123", "$path": "/r/:id" }
   } }
   ```
   `"$fn"` becomes a no-op function. `$route` / `$path` render the component inside a router at that URL (for pages using `useParams`). For JSX children or real functions, write `<id>.tsx` with `export default { variants: { … } }` instead. Base fixtures on the real types in the inventory, and cover the states that matter (empty, loading, error, long content, paid/unpaid), not just the happy path.
4. **Providers and mocks.** If components need context (auth, query client, theme) or call APIs, write `.lathe/ui/wrapper.tsx` with a default export `({ children, variant, side }) => …`. Stub `fetch` there rather than hitting real services.
5. **Errors.** Render failures go to `.lathe/ui/harness-errors.json` (newest first). Read it after you change fixtures and fix what's missing; don't ask the human to read stack traces.
6. **Point, don't describe.** When the human picks an element (Inspect, I), Lathe writes `.lathe/ui/selection.json`: the component and variant on screen, the theme, any prop values they set, and the element's `file:line`, the component it's written in, its classes and the tokens its CSS uses with their resolved values. When they say "this", read that file: it's exact. A change to how something looks goes through a token or a prop value the system already has; if the right value doesn't exist, propose a token (Tokens) or a variant instead of a raw value.
7. **Change it.** Edit the component on a branch. The After frame hot-reloads as you save, and the human compares with **Space**, **← →**, **S** (side by side) and **0–3** (widths). Explain each change as *what exists → what's wrong → change → why*, and leave comments as `author: "agent"` with `target: "part:<id>"` in `.lathe/ia/comments.json`.
8. **Themes.** If the repo has more than one theme, check fixtures in each (**Themes** in the dock): a component that only works in dark mode is a finding.
9. **Brief.** *Parts → Brief → Save* writes `.lathe/ui/brief.md`: changed components and the pages they reach, decisions, duplicates, unused parts, open comments.

## Tokens: foundations

The **Tokens** tab exposes design tokens with their purpose, reach and checks. Use it to make foundation changes deliberately.

1. `lathe tokens <repo>` writes `.lathe/ui/tokens.json`. Read `checks` first: contrast failures, `drift` (hard-coded values, with `suggest` naming the exact token where one matches), `dupes`, `unused`. Summarise them for the human before proposing anything.
2. **Propose changes as overrides, not edits.** Write `.lathe/ui/overrides.json` (`{ "--token": { "default": "value", "light": "value" } }`); the workbench regenerates `overrides.css` and the human sees it live in the specimens and in every component. Keep a token's role intact: change `--signal-500`'s value, don't repurpose it.
3. **Check reach and contrast** before recommending: `tokens[].usedBy`, `components`, `pages`, `global`. A change to a base token flows through every semantic token built on it.
4. **Applying** is the human's call (*Brief → Apply to source*). For generated tokens, change the source the brief names (e.g. `source.ts`) and run the repo's generator, then rescan.
5. **Drift fixes** (replacing hard-coded values with tokens) are code changes: do them on a branch, one token at a time, and confirm in Parts that the component looks the same.
6. Comments on tokens use `target: "token:--name"`.

## Smells: AI-made copy and composition

`lathe smells <repo>` runs the scanner that ships with the UI skills (see Skills below) and writes `.lathe/ui/smells.md` and `smells.json`. It lists candidates by id from the skill's `SMELLS.md` (eyebrows, narrating captions, rationale or status leaks, "X, not Y", inline styles), plus **causes**: component APIs with narration slots (S1). They're candidates, not verdicts. Judge each one in context with the `review-ui` skill and check screenshots before reporting.

- Lead with the causes. One `eyebrow` prop explains a hundred instances.
- Strings from server modules are listed separately: they reach the screen only if the UI renders them.
- `--baseline` saves the current counts; `--check` fails if any count rises above them. In repos you don't own, the baseline stays in `.lathe/`. At handover, copy the skill's `scripts/smells.mjs` into the repo's `scripts/` and commit a `smells.baseline.json`.
- Legitimate exceptions (say, one eyebrow on marketing pages) go in `.lathe/ui/smells.config.json`: `{ "ignore": ["regex"], "exceptions": [{ "rule": "A1", "path": "marketing/", "why": "…" }] }`, and in the repo's decision record.

## Skills

Lathe is the workbench; the judgment lives in agent skills from [bomajosiah/skills](https://github.com/bomajosiah/skills), installed separately. `lathe skills <repo>` shows which are installed and where (the repo's `.claude/skills` or `.agents/skills`, then `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, then a local checkout next to Lathe; `LATHE_SKILLS_DIR` overrides). Use them when present; never copy them into Lathe.

| Step | Skill |
|---|---|
| Map: curate before, critique | `review-ia` |
| Map: write after | `improve-ia` (existing) or `do-ia` (new area) |
| Parts, Tokens, Smells: critique | `review-ui` |
| Parts: change components | `improve-ui` (existing) or `do-ui` (new) |
| Naming things in notes and briefs | `ia-vocabulary`, `ui-vocabulary` |

If one is missing, say so and give the install command (`npx skills add bomajosiah/skills --skill <name>`) rather than improvising its method.

## Map schema

```jsonc
{
  "version": 1,
  "product": "Relay",
  "title": "Before: as shipped",            // shown in the workbench
  "summary": "…",                            // after maps: the intent
  "snapshot": { "commit": "…", "date": "2026-10-12", "sources": ["scan", "code-read", "browser"], "routes": "web/src/App.tsx" },
  "groups": [{ "id": "main", "label": "Main" }, { "id": "staff", "label": "Staff" }],
  "nodes": [
    {
      "id": "report",                        // stable across before/after
      "label": "Report",
      "path": "/r/:id",
      "group": "main",
      "parent": "audit",                     // perceived hierarchy, same group; null = root
      "audience": "public | lead | signed-in | subscriber | staff",
      "source": "web/src/pages/Report.tsx",
      "notes": "…",                          // observations
      "why": "…",                            // after maps: reason for the change
      "from": ["old-id"],                    // after maps: built from these pages
      "sections": [
        {
          "id": "report.score",              // unique across the whole map, stable
          "label": "Score",
          "kind": "header | nav | hero | content | cards | list | form | data | media | cta | gate | footer",
          "source": "web/src/components/ReportView.tsx:73",
          "component": "ScoreGauge",          // optional: bridge to the Parts workbench
          "notes": "…", "why": "…"
        }
      ]
    }
  ],
  "links": [{ "from": "audit", "to": "report", "label": "on submit" }],
  "nav": { "header": ["audit", "methodology"], "footer": ["home"] },
  "navWhy": { "header": "…" },               // after maps
  "retired": [{ "id": "architecture", "into": "admin", "why": "…" }]   // after maps
}
```

Optional, when roles matter (most products with staff):

```jsonc
"roles": [{ "id": "member", "label": "Member", "home": "projects", "login": "…", "notes": "…" }],
// per node:
"access": { "member": "full | partial | refused", "admin": "full" },
"accessNotes": "what a partial/refused role actually sees",
"utilities": [{ "id": "search", "label": "Global search", "scope": "projects, people, files" }],
// capabilities that exist in the API/domain but have no screen:
{ "id": "cap-exports", "label": "Exports", "path": "(API · PRD 3.2)", "group": "no-screen", "kind": "capability", "notes": "…" }
```

Measure access, don't infer it: log in as each role (the repo's dev logins) and call each page's reads, then confirm in the browser what a refused read looks like. The workbench's **View as** picker fades refused pages and marks partial ones and each role's home; the diff reports access changes per role.

`kind` sets the colour and the small wireframe glyph in the workbench: header and nav teal, footer purple, gate slate, cta indigo, everything else blue.

## Saving work

`.lathe/` is excluded from git, so it isn't backed up by the repo. At the end of a working session, or before anything destructive (re-clone, `git clean -fdx`), run `lathe archive <repo>` (add `--to <engagement folder>/lathe` for client work) and say where it went.
