# Lathe

Product brief, 2026-10-18. Lathe is the next shape and new name of UX Mapper. The rename (phase 1) is done; the owner's answers to the first round of questions are under [Decided](#decided).

## What Lathe is

Lathe is the workbench where design decisions on a coded system get made, by a person on a canvas or by an agent through the same actions, and written back into the code. The canvas is the real components, rendered by the app's own build, not a drawing of them. Storybook (or the base site, where a project starts from base) stays the **catalog**: the canonical place to browse, document and test components. Lathe is the **workbench** beside it: components and screens laid out side by side, changed in place, compared before and after, and handed back as a diff and a brief. A catalog answers "what do we have and how do I use it"; a workbench answers "what should change, and what does that change touch".

What already exists and carries over: Map (IA before/after with the morph and brief), Parts (components rendered through the app's own Vite, before/after against a git ref, themes, widths), Tokens (live overrides, reach, contrast, Apply), Smells (the scanner from the installed UI skills), comments that agents read, and skill discovery (`lib/skills.mjs`).

## Six decisions

### a. Visual edits use only system values

A visual edit picks a token, a prop value or a variant. It never sets a raw pixel, hex or font size. If the value you want isn't in the system, the edit becomes a proposal to change the system (a new token or variant), which goes through the token brief or an intent edit, not a free-form style.

Why: drift is the problem the whole practice exists to fix. A free-form inspector (the Figma/Onlook model) produces exactly the hard-coded values `tokens` and `smells` flag. Restricting the palette makes Lathe incapable of introducing drift, and makes every edit legible to an agent ("`Button` size `sm` → `md`" rather than "padding 6 → 10").

Cost: some tweaks need two steps (add the token, then use it). That is the point. Decided: there is no raw-value escape hatch, not even a flagged temporary one.

### b. Values are edited directly; structure is changed by intent

Two kinds of edit, two mechanisms:

- **Values** (token values, prop values, variants, theme): direct manipulation in a panel, previewed live as overrides, applied to source on confirm. This is what Tokens already does.
- **Structure** (move a section, merge two components, add a slot, remove narration): select the element or component, describe the change, an agent edits the code on a branch, Lathe shows the diff and the before/after render, you accept or reject.

Why: dragging DOM nodes around and serialising the result back into JSX is where visual-to-code editors get brittle (conditional rendering, mapped lists, composition). Agents are already good at structural edits when they're pointed at the right file and shown the result. Lathe's job is the pointing and the showing.

### c. A dev-only Vite plugin tags elements with source and line

The harness already injects one plugin into the app's own Vite. Extend it with a JSX transform that adds `data-lathe-src="path:line:col"` (and the component name) to rendered host elements, only inside Lathe's Vite instance. A click on the canvas then resolves to the component, its file and its line, which is what both the inspector (b) and the agent need.

Why: this is how Onlook and React DevTools-style tools map elements to code, and it's the missing piece for the planned "Alt-click → open in Parts". Doing it inside Lathe's own Vite keeps the standing decision: nothing is installed in or committed to the target repo.

Limits to accept: elements rendered by third-party libraries tag to the call site, not the library; non-Vite apps (Next.js) need their own harness, as Parts already does.

### d. One action model, exposed as an MCP server

Every canvas action is a named operation with typed input: `list_components`, `list_tokens`, `screenshot` (component, variant, theme, width), `set_token`, `set_prop`, `set_variant`, `select` (returns source location), `propose_edit` (intent + target → branch diff), `accept` / `reject`, `comment`, `smells`, `brief`. The UI calls these; so does an agent, through an MCP server Lathe runs. The CLI wraps the same functions.

Why: "AI-legible" only means something if the agent can do what the person does, with the same guarantees (system values only, overrides before apply, diff before accept). Today the agent works by writing files Lathe watches; that stays as the storage layer, and the MCP server becomes the interface. Lathe doesn't run an agent itself: `propose_edit` records the intent and target, and whichever agent is connected over MCP does the edit. Lathe checks the result (diff, render, system values only) and the person accepts or rejects. Screenshots matter most: an agent that can render a variant in three themes and look at it is the difference between guessing and checking.

### e. Read Storybook when it's there; fall back to fixtures

When a repo has Storybook, Lathe reads its config and story files (statically, so Storybook needn't be running or built) and treats each story as a variant of the component its meta names: no fixtures to write, and the catalog stays the source of examples. When there's no Storybook, Lathe uses its own fixtures in `.lathe/ui/fixtures/`. Lathe never requires Storybook and never writes to it except by proposing new stories as an intent edit. Stories render inside Lathe's own harness (imported as CSF), not in Storybook's iframe, so one renderer applies the app's CSS, Lathe's token overrides and the before/after snapshot.

Why: this is the same pattern as the skills, aware but not dependent. Storybook is common in client repos and is the catalog chosen for the current specimen; base has its own site and registry. Duplicating stories as fixtures would split the truth.


### f. One infinite canvas for pages and components

Map pages become frames on the same canvas as component sheets (a component's variants laid out in a grid, per theme). A token change previews on the components and on every screen at once; selecting a component highlights the frames it appears in, using the map's existing `source`/`component` links.

Why: the reach panel in Tokens already lists where a token lands; the canvas shows it. It also closes the gap between IA and UI work, which today live in separate tabs with a link between them.

Cost: page frames need real renders (routes with fixtures or a running app with test logins), not just the map's wireframe glyphs. Start with the wireframes and swap in renders page by page.

## How it fits

| Piece | Role | Lathe's relation |
|---|---|---|
| **Skills** (bomajosiah/skills) | The judgment: `review-ui` critiques, `improve-ui` fixes causes and sweeps, `do-ui` composes new screens; IA suite for structure | Lathe discovers installed skills and runs their scanner; smells appear as an overlay on the canvas, anchored by source line. Intent edits name the skill the agent should use. Lathe never bundles skills. |
| **Storybook** | Catalog and test bench for a repo's components | Source of variants (e); Lathe's accepted changes show up there because they are code. Visual regression stays Storybook's/CI's job. |
| **base** | Reference kit for the creation path, with its own docs site and registry | Same role as Storybook for projects started from base: Lathe reads `registry.json` as the component list. |
| **Agentic design workflow** | Mandate → Audit → Design → Systemize → Agentize → Validate | **Repair:** Audit (map, inventory, tokens, smells) and Design (before/after, intent edits) happen in Lathe. **Creation:** start from base, use Lathe to vary and check new surfaces against the system. Validate stays in CI (`smells --check`, tests). |

## Neighbours

Checked October 2026. Sources at the end.

| Tool | What it does now | Borrow | Where Lathe differs |
|---|---|---|---|
| **Onlook** (Apache 2.0, open source) | Visual editor for Next.js + Tailwind. Instruments code to map elements to source; edits in the iframe and in code; Tailwind style toolbar; AI chat with code access. Hosted product in early access. | The instrument-to-source mapping (c); edit-then-write-back flow. | Onlook edits styles freely (Tailwind classes, layout drags); Lathe restricts to system values. Onlook is per-project and Next-only; Lathe is Vite-first and built to audit many repos it doesn't own. |
| **Builder.io** (Fusion / Code Projects, Visual Copilot) | Connects a Git repo; edit visually or by prompt; AI writes code and opens PRs; design-system indexing on Enterprise; path-scoped permissions. Visual Copilot converts Figma to code matching the codebase. | PR-shaped output; scoped permissions (which files an edit may touch) for intent edits. | Hosted and commercial; works in your repo's PRs. Lathe is local, installs nothing, and leads with audit (map, tokens, smells) before editing. |
| **Figma Make, Dev Mode, MCP server** | Make kits (Apr 2026) package npm React components with usage guidelines so Make prototypes from real components. Copy design turns Make code into Figma layers via Code Connect. The MCP server reads design context, generates code from frames, writes to the canvas, and turns live UI into layers. | Guidelines shipped with components (cf. `AGENTS.md`, base rules); MCP as the agent surface (d). | Figma's canvas is a mirror of code; Lathe's canvas is the code running. The repo stays the source of truth, as the workflow says. |
| **Storybook + Chromatic** | Storybook's MCP addon (preview, React-first) gives agents docs from a components manifest, story previews and test runs. Chromatic's Visual Tests addon snapshots stories in the cloud, highlights pixel changes, accepts baselines per branch. | Story index and manifest as inputs (e); visual tests as the regression gate after Lathe. | Storybook catalogs and tests what exists; it doesn't propose or apply design changes or see screens and tokens together. Lathe is the step before the test. |
| **Plasmic** | Visual builder; developers register code components (props, slots, tokens) on an app host page; output via loader or codegen. | Registration metadata (prop types, allowed values) is what decision (a) needs; Lathe infers it from TS types and stories instead of asking for registration. | Plasmic's pages live in Plasmic and need a host page in the repo. Lathe keeps everything in the repo's own code and `.ux/`. |

**The gap Lathe fills:** none of these is system-first (edits limited to tokens/props/variants), agent-native with the same actions for people and agents, and built for auditing and repairing many repos you don't own without installing anything. Onlook is the closest technically; Storybook is the closest in role, and Lathe is meant to sit beside it, not replace it.

## Plan

Each phase ends with something usable on the specimen: a real, private multi-role product (Vite + React, tenant themes, generated tokens, a Storybook catalog being set up) that Lathe is tested against. Its specifics stay out of this public repo. Changes to the specimen happen only where a phase needs a real case.

| # | Phase | Done when | Specimen need that drives it |
|---|---|---|---|
| 1 | **Rename** (done 2026-10-18) | Folder `ux-mapper/` → `lathe/` (a `ux-mapper` symlink stays in the owner's workspace for sessions mid-flight); CLI `lathe` (`bin/ux.mjs` forwards); work dir `.lathe/`, with an existing `.ux/` read as-is until `lathe migrate <repo>`; `LATHE_SKILLS_DIR` (old `UX_SKILLS_DIR` honoured); internal routes and ids renamed; docs and workspace references updated; public repo `bomajosiah/lathe`. | The specimen's existing `.ux/` (map, inventory, overrides, smells baseline) opens unchanged. |
| 2 | **Storybook connection** (done 2026-10-18) | The scan reads `.storybook/main` globs and links story files to components; Parts renders stories as variants inside Lathe's harness with args, decorators (story, component, preview) and layout; fixtures still work for components without stories; a story that fails to render lands in `harness-errors.json`. Tested on base: 51 stories in 15 files. Not yet: loaders, `play`, globals toolbars, Storybook's components manifest. | The specimen's Storybook is being set up as its catalog; Lathe should pick up its stories with no fixture duplication. |
| 3 | **Canvas** | One pannable canvas: component sheets (variants × themes) and map pages as frames; a token override re-renders both; selecting a component highlights the pages it's on; smells overlay toggle. | Tenant themes and a role-based navigation rework: see a token or nav change across components and every role's home at once. |
| 4 | **Select, inspect, edit values** (done 2026-10-18) | Babel pass in Lathe's Vite tags host elements and package components with `data-lathe-src` and the component they're written in; Inspect (I) picks an element → file:line, owner component, classes, tokens its CSS uses resolved per theme (each opens in Tokens); picks are written to `ui/selection.json` for the agent; props with closed types (literal unions, booleans) get pickers that re-render both sides; token values are edited in Tokens and applied as before. Not yet: picking inside map page frames (phase 3), editing a token straight from the picked element, writing a prop pick back as a story. | The specimen's tokens are generated from a TypeScript source, so edits must route to the source, not the CSS. Its recent UI repair pass shows which props carried narration. |
| 5 | **Intent edits** | Select + describe → `propose_edit` → the connected agent works on a branch with the right skill (`improve-ui`, `do-ui`) → Lathe shows diff and before/after render → accept (commit stays on the branch) or reject (reverted). Every accepted edit appends to the brief. | Structural fixes like the repair pass's (removing a stat row, moving counts onto tabs, adding info tips) done from the canvas rather than by describing files in chat. |
| 6 | **MCP server** | `lathe mcp` exposes the action model (d) over stdio and HTTP; an agent with only the MCP can list components, render and screenshot a variant in each theme, set a token override, propose an edit and comment, with the same guards as the UI. Tested with a cold agent on the specimen. | A cold agent asked to make one screen's header consistent with the system should be able to look, try a value and propose, without reading Lathe's file formats. |

Phases 2 and 3 can swap if the specimen's Storybook isn't ready. Phase 6 can start earlier as a thin wrapper over the CLI, since the action functions exist as soon as phase 4 does.

**Roadmap, after phase 6:** a Next.js harness, then other frameworks. Until then Lathe supports Vite + React only for Parts, Tokens and the canvas (Map already scans Next, Astro, Nuxt, SvelteKit, Remix and static HTML).

## Decided

Answered by the owner, 2026-10-18.

| Question | Decision |
|---|---|
| Rename timing | Now, in one sweep (done). |
| Artifact dir | `.lathe/`, with `.ux/` read until migrated. |
| Repo | Its own public repo, `bomajosiah/lathe`, beside `bomajosiah/skills`. Client work (archives, specimen notes) never goes in it. |
| Storybook rendering | Inside Lathe's harness, not Storybook's iframe. |
| Who runs intent edits | Any agent connected over MCP; Lathe doesn't spawn one. |
| Non-Vite repos | Vite + React for now; Next.js is on the roadmap. |
| Off-system values | Refused. The edit becomes a token (or variant) proposal. |

## Open

1. **Tabs once the canvas exists.** Today Lathe has three tabs: Map (pages), Parts (one component at a time) and Tokens. The canvas (phase 3) puts pages and components on one surface. When it can do everything the tabs do, do the tabs go, or stay as focused views you can jump into from the canvas? Recommendation: the canvas becomes the home view and the tabs stay as focused views (one component large, the token table), since some jobs need one thing big rather than everything small. Decide when phase 3 is in use.

## Sources

- Onlook README: https://github.com/onlook-dev/onlook
- Builder.io Fusion: https://www.builder.io/blog/introducing-fusion and https://www.builder.io/c/docs/get-started-fusion
- Figma Make kits: https://www.figma.com/blog/introducing-make-kits-and-make-attachments/ ; design system packages: https://developers.figma.com/docs/code/bring-your-design-system-package/ ; Make → Figma Design: https://help.figma.com/hc/en-us/articles/43365023930391 ; MCP server: https://developers.figma.com/docs/figma-mcp-server/
- Storybook MCP (preview): https://storybook.js.org/docs/ai/mcp/overview
- Chromatic Visual Tests addon: https://www.chromatic.com/docs/visual-tests-addon/
- Plasmic code components: https://docs.plasmic.app/learn/registering-code-components
