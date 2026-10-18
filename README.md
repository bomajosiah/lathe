# Lathe

The workbench where design decisions on a coded product get made, by you or by an agent, and written back into the code. It maps how the product is structured, renders its real components and tokens through the app's own build, shows every change before and after, and hands back a brief.

Lathe sits beside your catalog (Storybook, or a docs site), not instead of it. The catalog is where components are browsed and tested; Lathe is where you decide what should change and see everything that change touches. Where it's heading: [docs/LATHE.md](docs/LATHE.md).

Lathe was called UX Mapper until October 2026. Projects with an old `.ux/` folder keep working; `lathe migrate <repo>` renames it to `.lathe/`.

The loop:

1. **Snapshot.** Scan the repo (routes, page sections, links, nav), then an agent curates it into `before.json`, checking the running app in a browser where the code is ambiguous.
2. **Redesign.** Talk it through with your agent. It writes `after.json` (or several alternatives); the workbench reloads as it writes. You comment on pages and sections in the workbench; the agent reads those comments.
3. **Before / after.** Scrub or play the morph: pages move, sections fly to their new homes, removed things fade out, new things fade in.
4. **Brief.** Generate `brief.md`: every change with its reason and the files to touch. That is the reference when you go back to the repo to rework it.

Lathe is the tool half of an agentic design practice; the judgment half is the [skills](https://github.com/bomajosiah/skills) (`review-ia`, `improve-ia`, `review-ui`, `improve-ui`, `do-ui` and the rest). It works on repos you don't own: nothing is installed in them and nothing it writes is committed.

## Install

No dependencies, Node 20+.

```bash
npm install -g github:bomajosiah/lathe
```

Or clone it and run `npm link`, or call `node <path-to-lathe>/bin/lathe.mjs` directly.

## Using it on a project

One command for a new or existing project:

```bash
lathe start <repo>
```

It scans whatever is missing (map, components, tokens), keeps `.lathe/` out of git, and serves the workbench at http://localhost:4747. Running a second project at the same time? It picks the next free port (4749, 4751…). For a repo with several apps, add `--app <dir>`.

Then hand the project to your agent:

> We're mapping `<repo>` with Lathe. Read Lathe's `AGENTS.md`. Curate `before.json`, write fixtures for the shared components, and summarise the token checks, then stop and walk me through what you found.

Working day to day:

- **Map:** the agent curates `before.json`, you discuss, it writes `after.json` (or `after-b.json`…), you play the morph, then save the brief.
- **Parts:** click **Snapshot HEAD** before changing code so Before is today's version; variants come from the repo's Storybook stories, or fixtures the agent writes where there are none; the agent edits components on a branch; compare with Space / Split / Themes.
- **Tokens:** edit values live (they're previews until you **Apply**); check reach and contrast; save the brief.
- **Smells:** `lathe smells <repo>` lists AI-smell candidates (eyebrows, narration, rationale leaks) and the component APIs that cause them; `--baseline` / `--check` make it a ratchet. The scanner comes from the UI skills ([bomajosiah/skills](https://github.com/bomajosiah/skills)); Lathe finds an installed copy and tells you how to install one if there isn't. `lathe skills` lists which companion skills are installed.
- Comments you leave anywhere land in `.lathe/ia/comments.json` for the agent.

In the workbench: **Space** plays before → after, **← / →** jump, **T** switches theme, **Shift+T** shows every theme side by side, **⌘|** focus mode, **F** fits the map, drag to pan, pinch or ⌘-scroll to zoom. Other commands: `scan`, `parts`, `tokens`, `base --ref <ref>`, `diff`, `brief`, `archive`, `restore`.

## Where things live

```
<repo>/.lathe/                 kept out of git via .git/info/exclude (never committed)
  ia/scan.json              raw scan: evidence, regenerated freely
  ia/before.json            curated snapshot of what ships today
  ia/after.json             proposal (add after-b.json etc. for alternatives)
  ia/comments.json          your comments + the agent's replies
  ia/brief.md               the rework reference
  ui/inventory.json         component inventory (Parts)
  ui/base/                  snapshot of a git ref: the "Before" side for components
  ui/fixtures/<id>.json     props per variant, written by the agent
  ui/wrapper.tsx            optional providers / API mocks for isolated renders
  ui/harness-errors.json    render failures, for the agent to fix
  ui/selection.json         the element you last picked in Inspect, for the agent
  ui/brief.md               the component brief
  ui/tokens.json            design tokens, reach and checks (Tokens)
  ui/overrides.json|.css    live token edits: preview only until applied
  ui/tokens-brief.md        the token brief
```

`.lathe/` sits in the repo so any agent working there finds it, but it never reaches the repo's history. If a map should become part of the repo's own docs at handover, copy it out deliberately.

### Keeping old work

- **It survives** branch switches, pulls and restarts: `.lathe/` is untracked and excluded, so git leaves it alone.
- **It doesn't survive** deleting or re-cloning the repo, or `git clean -fdx` (which removes excluded files too).
- **Versions inside a project:** maps are just named files, so keep alternatives and milestones side by side (`after.json`, `after-b.json`, `v2-shipped.json`) and compare any two in the pickers.
- **Archive** a project's work somewhere durable, e.g. at the end of each session or before handover:

  ```bash
  lathe archive <repo> --to <engagement folder>/lathe
  ```

  Without `--to` it goes to `archive/<repo>/<date>/` inside Lathe (never published). Archives skip the rebuildable Before snapshot.
- **Restore** into a fresh clone with `lathe restore <repo> --from <archive dir>`. It archives whatever `.lathe/` is already there first, and rebuilds Before from the recorded ref.

## Themes (dark / light)

Parts and Tokens render in every theme the token scan finds: `:root` plus `[data-theme=…]`, `[data-*-theme=…]`, `.dark` / `.light` / `.theme-*` (for example a default dark theme plus a light one, or per-tenant themes). Pick one in the top bar (or **T**), or show them all side by side (**Themes**, **Shift+T**). In Tokens, the **Themed** filter shows only the tokens whose value changes between themes, and each theme's value is edited separately.

Previews never follow your own OS setting: each frame pins `prefers-color-scheme` to the theme it shows (dark for a dark theme, light otherwise), so a theme that only exists as `@media (prefers-color-scheme: dark)` can be switched like any other, and Default always shows the `:root` values. A token a theme defines in two places (say `[data-theme=dark]` and a media block) gets overrides and Apply in both. Scripts that read `matchMedia` still see the real setting.

## Decision: standalone workbench, not an in-app package

Decided 2026-10-12, with the component tool in view.

**What we chose:** a standalone CLI + local workbench that reads the repo and owns the artifacts. Where the running app adds something, the workbench reaches into it from outside (browser, injected overlay, its own Vite instance), never by adding a dependency.

**Why not a dev-mode package like agentation:**

- **The map is whole-product.** It comes mostly from reading code and has to work on AI-built repos that don't run cleanly. An in-app overlay only sees the page you're on.
- **The repos aren't ours.** Audited client repos keep their stack, and studio files are never committed to them. Adding a package to every audited repo breaks both, and would need undoing at handover.
- **The artifacts outlive any session.** Before, after, comments and brief are files the agent edits and you review. A workbench that watches files suits that better than state inside a running app.
- **One tool, many repos.** A standalone tool is maintained once. A package would mean version drift across every client repo.

**What we keep from the agentation idea:** pointing at the live UI is valuable, so the workbench will be able to *inject* an overlay into a running dev server without installing anything. If a team adopts the workflow for the long run (after handover), the same overlay can ship as a dev-only package then.

## Map + Parts: one workbench, two units

The component tool ("Parts") runs the same loop on a different unit:

| | Map | Parts |
|---|---|---|
| Unit | Page, section, nav, link | Component, variant, instance |
| Snapshot | Route + JSX scan, browser check | Component inventory: files, props, where used, duplicates |
| Work on it | Agent edits `after.json` | Isolate one component, iterate on it in the real build |
| Before / after | Animated map morph | Side-by-side or toggled render of the component |
| Hand back | `brief.md` with files to touch | Brief + the changed component on a branch |

They connect through source references. Every map section carries a `source` (and optionally `component`), so a section on the map *is* an instance of a part. Planned: click a section → open its component in Parts.

**How Parts works:**

- **Inventory:** `lathe parts <repo>` scans every React component: props (with TS types), where it's used and how often, the pages it reaches (via the map), likely duplicates, inline styles and raw colours. The agent annotates it in place; re-scans keep the notes.
- **Isolation without touching the repo:** opening the Parts tab starts the app's own Vite on port 4748 with one injected plugin. Each component renders alone in an iframe with the app's real CSS, fonts, head scripts and router, and hot-reloads as it's edited. Variants come from the repo's Storybook stories when it has them, otherwise from fixtures the agent writes; providers and API mocks go in `.lathe/ui/wrapper.tsx`.
- **Storybook, if the repo has it:** the scan reads `.storybook/main` (its `stories` globs) and links each story file to the component its `meta.component` names (or, without one, to the imported component its title ends with). Those stories become the component's variants, rendered in Lathe's harness, not Storybook's: args, `render`, decorators (story, component, then `.storybook/preview`), parameters and `layout` are applied the way Storybook applies them, and the preview file's CSS imports come along. Storybook doesn't need to be running. Loaders, `play` functions and globals toolbars aren't run. Components without stories keep using fixtures.
- **Inspect (I):** pick any element in a preview to see the line of code that rendered it, the component it's written in, and every token the CSS that styles it uses, resolved in the current theme (click one to open it in Tokens). Elements are tagged with `data-lathe-src` by a Babel pass that runs only inside Lathe's Vite, using the repo's own `@babel/core`; host elements and components imported from packages (Radix, Base UI) are tagged. Nothing is added to the repo's build.
- **Props:** props whose type is a closed set (string-literal unions, booleans) get a picker in Details. A pick re-renders both sides with that value on top of the story or fixture; it's a preview, never a free-form value, and **copy args** hands it to an agent or a new story.
- **Before / after:** `lathe base <repo> --ref HEAD` snapshots a ref into `.lathe/ui/base` (via `git archive`, reusing the installed `node_modules`). Parts renders Before (the ref) and After (the working tree) stacked with a crossfade, or side by side, at mobile/tablet/desktop widths.
- **Map ↔ Parts:** a section or page on the map links to its component ("Open in Parts"), and a component links back to the pages it shows on.

**Parts keys:** Space plays before → after, ← / → jump, S side by side, 0–3 width (fill, mobile, tablet, desktop), ↑ / ↓ next component, / search, R reload, ⌘| focus mode.

**Limits for now:** Vite + React apps only (Next.js and others need their own harness). Components that aren't exported can only be seen through their parent. The Before side resolves path aliases (like `@/`) to the working tree, so aliased imports inside Before show current code.

## Tokens: foundations

The third tab exposes the design tokens (colour, type, space, radius, shadow, motion) so a foundation change is one edit you can see everywhere before it touches the repo.

- **Inventory:** `lathe tokens <repo>` reads CSS custom properties per theme (`:root`, `[data-theme=…]`, `.dark`, `prefers-color-scheme`), keeps each token's comment as its purpose, and respects `@kind` hints. Generated token files (e.g. "Generated from source.ts. Do not edit") are traced back to their source.
- **Specimens in the real build:** swatches, type scale, families, weights, spacing, radii, shadows and motion render inside the app's own Vite, so its fonts and CSS are what you see. Switch themes from the top bar (shared with Parts).
- **Live edits:** change a value in the panel and it becomes an override in `.lathe/ui/overrides.css`, hot-swapped into the specimens *and* every component in Parts (After side). Before = source values, After = with overrides; Space crossfades.
- **Reach:** each token shows what builds on it (`--ink-900` → `--bg-canvas` → …), the components it reaches (open in Parts) and the pages (show on map), plus whether it styles bare elements.
- **Checks:** contrast of every real colour/background pair in the CSS, per theme, recomputed live as you edit; hard-coded values (with the exact token to use where one matches); duplicate and near-duplicate values; unused tokens.
- **Brief + apply:** the brief lists each proposed change with where to edit, reach and contrast impact. *Apply to source* writes overrides into the token files in the working tree (after a confirm), leaving generated tokens to the brief for an agent to change at the source.

**Tokens keys:** Space plays before → after, ← / →, ↑ / ↓ next token, 1–7 groups, / search, ⌘| focus mode.

**Still to build:** the live overlay. `lathe serve --app http://localhost:5173` would proxy the app's dev server and inject a small script: Alt-click any element → its component and source file → "show on map" or "isolate in Parts".

## Files

- `bin/lathe.mjs`: the CLI (`bin/ux.mjs` forwards to it under the old name)
- `lib/workdir.mjs`: where a project's work lives (`.lathe/`, or a legacy `.ux/`)
- `lib/scan.mjs`: repo → skeleton map (React Router, Next, Astro, Nuxt, SvelteKit, Remix, static HTML)
- `lib/diff.mjs`: diff two maps by id (shared by the CLI and the workbench)
- `lib/brief.mjs`: diff → markdown brief
- `lib/server.mjs`: local server, file watching, comments API
- `lib/parts-scan.mjs`: repo → component inventory
- `lib/stories.mjs`: finds Storybook's config and story files and links stories to components
- `lib/harness.mjs`: finds the Vite app, runs it with the isolation plugin, snapshots the Before ref
- `lib/parts-brief.mjs`: inventory + changes → component brief
- `lib/tokens-scan.mjs`, `lib/tokens-core.mjs`, `lib/tokens-brief.mjs`: token inventory, reach and checks; colour/contrast maths; brief
- `lib/specimen.mjs`: token specimens rendered inside the app's build
- `viewer/`: the workbench (vanilla JS + SVG, no build); `parts.js` is the Parts tab
- `AGENTS.md`: how an agent maps, redesigns and briefs, plus the map schema
