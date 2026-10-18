// lathe mcp: the workbench's actions as an MCP server (stdio), so an agent can do
// what a person does in Lathe with the same guards: look at components and tokens,
// render a variant in any theme and look at it, preview token values as overrides,
// read what the human picked, and comment. It talks to the project's running
// workbench (so the human sees the agent's overrides live) or starts one.
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { serve } from "./server.mjs";
import { workDir } from "./workdir.mjs";
import { screenshot } from "./browser.mjs";

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Closed set of values a prop type allows (string-literal unions, booleans, numbers).
function choicesOf(type) {
  if (!type) return null;
  const t = type.trim();
  if (t === "boolean") return [true, false];
  const parts = t.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2 && !/^['"]/.test(t)) return null;
  const vals = [];
  for (const x of parts) {
    const m = x.match(/^(['"])(.*)\1$/);
    if (m) vals.push(m[2]);
    else if (x === "true" || x === "false") vals.push(x === "true");
    else if (x === "undefined" || x === "null") continue;
    else if (/^-?\d+(\.\d+)?$/.test(x)) vals.push(+x);
    else return null;
  }
  return vals.length ? vals : null;
}

async function findWorkbench(root) {
  for (let p = 4747; p <= 4799; p += 2) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/meta`, { signal: AbortSignal.timeout(400) });
      const m = await r.json();
      if (m.root && path.resolve(m.root) === root) return `http://127.0.0.1:${p}`;
    } catch {}
  }
  return null;
}

export async function startMcp({ root, port = 4747, app }) {
  // stdout is the protocol; everything else goes to stderr.
  console.log = (...a) => console.error(...a);
  root = path.resolve(root);
  let base = await findWorkbench(root);
  if (!base) {
    const server = serve({ root, port, app });
    await new Promise((ok) => server.once("listening", ok));
    base = `http://127.0.0.1:${server.address().port}`;
    console.error(`lathe mcp: started a workbench at ${base.replace("127.0.0.1", "localhost")}`);
  } else console.error(`lathe mcp: using the open workbench at ${base.replace("127.0.0.1", "localhost")}`);

  const api = async (p, body) => {
    const r = await fetch(base + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });
  const parts = async () => (await api("/api/parts")).parts;
  const tokensInv = () => api("/api/tokens");
  const themeParams = (themes, id = "default") => {
    const th = themes.find((t) => t.id === id);
    if (!th) throw new Error(`No theme "${id}". Themes: ${themes.map((t) => t.id).join(", ")}`);
    return { theme: th.id, scheme: th.media || (/dark/.test(th.id) ? "dark" : "light"), ...(th.attr ? { themeAttr: th.attr, themeVal: th.value } : {}), ...(th.cls ? { themeCls: th.cls } : {}) };
  };
  const begun = async (e, p) => ({
    id: e.id, branch: e.branch, dir: e.dir, intent: e.text, target: e.target,
    file: p ? path.join(e.dir, p.file) : undefined,
    ...(e.dirtyAtStart?.length ? { note: `The worktree starts from HEAD. These files have uncommitted changes in the human's working tree that the worktree doesn't have: ${e.dirtyAtStart.join(", ")}` } : {}),
    next: "Edit files under dir (not the repo root), check with screenshot { id, edit }, then submit_edit.",
  });
  const findPart = async (id) => {
    const all = await parts();
    const p = all.find((x) => x.id === id) || all.find((x) => x.name === id && x.exported) || all.find((x) => x.name === id);
    if (!p) throw new Error(`No component "${id}". Use list_components to find ids (they look like "src/ui/Button.tsx#Button").`);
    return p;
  };

  const TOOLS = [
    {
      name: "list_components",
      description: "List the repo's React components: id, file, how often it's used, and its variants (Storybook stories or fixtures). Use the id with get_component and screenshot.",
      inputSchema: { type: "object", properties: {
        query: { type: "string", description: "Filter by name or file" },
        filter: { type: "string", enum: ["all", "shared", "stories", "dupes", "unused", "edited"], description: "edited = changed since the Before snapshot" },
        limit: { type: "number", description: "Default 60" },
      } },
      run: async ({ query = "", filter = "all", limit = 60 }) => {
        const inv = await api("/api/parts");
        const q = query.toLowerCase();
        const list = inv.parts.filter((p) => {
          if (q && !`${p.name} ${p.file}`.toLowerCase().includes(q)) return false;
          if (filter === "shared") return p.instances > 1 || p.pages.length > 1 || p.global;
          if (filter === "stories") return !!p.stories?.length;
          if (filter === "dupes") return p.dupes.length > 0;
          if (filter === "unused") return !p.instances && p.kind !== "page";
          if (filter === "edited") return inv.changed.includes(p.file);
          return true;
        });
        const lines = list.slice(0, limit).map((p) => `${p.id}  ·  ${p.kind}${p.exported ? "" : " (not exported)"} · used ${p.instances}×${p.stories?.length ? ` · stories: ${p.stories.map((s) => s.export).join(", ")}` : ""}${inv.changed.includes(p.file) ? " · edited" : ""}`);
        return text(`${list.length} of ${inv.parts.length} components${list.length > limit ? ` (first ${limit})` : ""}${inv.storybook ? ` · Storybook: ${inv.storybook.stories} stories` : ""}\n${lines.join("\n")}`);
      },
    },
    {
      name: "get_component",
      description: "Everything Lathe knows about one component: props with types (and the values a closed-type prop allows), stories, where it's used, pages it reaches, likely duplicates, design-debt signals, notes.",
      inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "Component id from list_components, or its name" } } },
      run: async ({ id }) => {
        const p = await findPart(id);
        return text({ ...p, props: p.props.map((x) => ({ ...x, ...(choicesOf(x.type) ? { allowed: choicesOf(x.type) } : {}) })) });
      },
    },
    {
      name: "screenshot",
      description: "Render one component variant in the app's own build (its CSS, fonts and the current token overrides) and return a PNG. Pick the variant (a story name or fixture variant), theme, width, and whether to see After (working tree), Before (the snapshot) or both. args may only set props whose type is a closed set, to values that set allows.",
      inputSchema: { type: "object", required: ["id"], properties: {
        id: { type: "string" },
        variant: { type: "string", description: "Story export name or fixture variant; default the first" },
        theme: { type: "string", description: "Theme id from list_tokens; default 'default'" },
        side: { type: "string", enum: ["after", "before", "both"], description: "Default after" },
        width: { type: "number", description: "Viewport width in px; default 800" },
        args: { type: "object", description: "Prop values to preview, e.g. { \"variant\": \"danger\" }" },
        full: { type: "boolean", description: "Whole viewport instead of cropping to what rendered" },
        edit: { type: "string", description: "An intent edit's id: shows Now (working tree) and Proposed (the edit's worktree) instead of side" },
      } },
      run: async ({ id, variant = "", theme = "default", side = "after", width = 800, args = {}, full = false, edit }) => {
        const p = await findPart(id);
        if (!p.exported) throw new Error(`${p.name} isn't exported, so it can only be seen through its parent.`);
        for (const [k, v] of Object.entries(args || {})) {
          const prop = p.props.find((x) => x.name === k);
          const allowed = prop && choicesOf(prop.type);
          if (!allowed) throw new Error(`"${k}" isn't a prop with a closed set of values on ${p.name}, so it can't be set here. Props you can set: ${p.props.filter((x) => choicesOf(x.type)).map((x) => x.name).join(", ") || "none"}.`);
          if (!allowed.includes(v)) throw new Error(`${k} must be one of ${allowed.map((x) => JSON.stringify(x)).join(", ")}.`);
        }
        const H = await api("/api/harness/start", {});
        if (H.state !== "ready") throw new Error(H.error || "The app's dev build didn't start.");
        if (edit && !/^[\w-]+$/.test(edit)) throw new Error("Bad edit id.");
        const sides = edit ? ["work", `edit:${edit}`] : side === "both" ? ["base", "work"] : [side === "before" ? "base" : "work"];
        if (sides.includes("base") && !H.base) throw new Error("No Before snapshot yet. The human takes one with Snapshot HEAD, or run: lathe base <repo>");
        const { themes } = await tokensInv();
        const tp = themeParams(themes || [{ id: "default" }], theme);
        const content = [];
        for (const s of sides) {
          const q = new URLSearchParams({ file: p.file, name: p.export, id: p.id, side: s, variant, pad: p.kind === "component" ? 32 : 0, ...(Object.keys(args || {}).length ? { args: JSON.stringify(args) } : {}), ...tp });
          const shot = await screenshot(`${H.url}/__lathe/harness.html?${q}`, { width, full });
          const label = `${p.name} · ${shot.ready?.variant || variant || "default"} · ${tp.theme} · ${s === "base" ? `Before (${H.base.ref} ${H.base.commit.slice(0, 7)})` : s.startsWith("edit:") ? `Proposed (edit ${edit})` : edit ? "Now (working tree)" : "After (working tree)"} · ${width}px`;
          content.push({ type: "text", text: label + (shot.error ? `\nRender error: ${shot.error}` : "") + (shot.ready ? `\nVariants: ${shot.ready.variants.join(", ")} (from ${shot.ready.source})` : "") });
          content.push({ type: "image", data: shot.png, mimeType: "image/png" });
        }
        return { content };
      },
    },
    {
      name: "list_tokens",
      description: "Design tokens (CSS custom properties) with their value per theme, purpose comment, group, how much uses them, and any preview override. Also lists the themes and the token checks (contrast failures, hard-coded values that match a token).",
      inputSchema: { type: "object", properties: {
        query: { type: "string", description: "Filter by name, value or purpose" },
        group: { type: "string", enum: ["color", "type", "space", "radius", "shadow", "motion", "other"] },
        checks: { type: "boolean", description: "Include the checks summary" },
        limit: { type: "number", description: "Default 80" },
      } },
      run: async ({ query = "", group, checks = false, limit = 80 }) => {
        const inv = await tokensInv();
        const q = query.toLowerCase();
        const list = inv.tokens.filter((t) => (!group || t.group === group) && (!q || `${t.name} ${Object.values(t.values).join(" ")} ${t.comment}`.toLowerCase().includes(q)));
        const out = {
          themes: (inv.themes || []).map((t) => t.id),
          tokens: list.slice(0, limit).map((t) => ({ name: t.name, group: t.group, values: t.values, purpose: t.comment || undefined, uses: t.uses ?? (t.usedBy || []).length, components: (t.components || []).length, override: inv.overrides?.[t.name] })),
          ...(list.length > limit ? { more: list.length - limit } : {}),
        };
        if (checks) {
          const c = inv.checks || {};
          out.checks = { contrastFails: (c.contrast || []).filter((x) => !x.pass).slice(0, 30), hardcodedMatchingAToken: (c.drift || []).filter((d) => d.suggest).slice(0, 30), duplicates: (c.dupes || []).slice(0, 20), unused: c.unused };
        }
        return text(out);
      },
    },
    {
      name: "set_token",
      description: "Preview a new value for an existing token as an override (never written to the repo; the human applies overrides from the Tokens brief). It shows live in the workbench and in later screenshots. Pass an empty value to drop the override for that theme.",
      inputSchema: { type: "object", required: ["name", "value"], properties: {
        name: { type: "string", description: "e.g. --color-primary" },
        value: { type: "string" },
        theme: { type: "string", description: "Theme id; default 'default'" },
      } },
      run: async ({ name, value, theme = "default" }) => {
        const inv = await tokensInv();
        const t = inv.tokens.find((x) => x.name === name);
        if (!t) throw new Error(`No token ${name}. New tokens are a change to the system: propose one to the human instead.`);
        if (!t.defs?.[theme] && theme !== "default") throw new Error(`${name} isn't defined for theme "${theme}". It's defined for: ${Object.keys(t.defs || {}).join(", ")}.`);
        const ov = await api("/api/tokens/overrides", { name, theme, value });
        return text({ overrides: ov, reach: { uses: t.uses ?? (t.usedBy || []).length, components: (t.components || []).slice(0, 20), pages: t.pages } });
      },
    },
    {
      name: "clear_token_overrides",
      description: "Drop every token override (the previews go back to the source values).",
      inputSchema: { type: "object", properties: {} },
      run: async () => text({ overrides: await api("/api/tokens/overrides", { clear: true }) }),
    },
    {
      name: "get_selection",
      description: "What the human last picked in the workbench (Inspect): the component and variant on screen, theme, prop values they set, and the element's file:line, the component it's written in, classes and the tokens its CSS uses with resolved values. Read this when the human says 'this'.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const f = path.join(workDir(root), "ui", "selection.json");
        return text(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "Nothing picked. Ask the human to turn on Inspect (I) in Parts and click the element.");
      },
    },
    {
      name: "list_edits",
      description: "Intent edits: changes the human described (status open, waiting for an agent) and ones in progress, proposed, accepted or rejected. Pick up an open one with begin_edit.",
      inputSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "editing", "proposed", "accepted", "rejected"] } } },
      run: async ({ status }) => text((await api("/api/edits")).filter((e) => !status || e.status === status).map(({ patch, ...e }) => e)),
    },
    {
      name: "propose_edit",
      description: "Start a change to the code by intent: say what should change and on which component. Lathe makes a git worktree on its own branch for you (the human's working tree is never touched) and returns its dir. Edit files under that dir with your normal tools, check with screenshot { edit: id }, then submit_edit. The human reviews Now against Proposed and accepts or rejects. Change how things look through tokens, props and variants, not raw values.",
      inputSchema: { type: "object", required: ["target", "intent"], properties: {
        target: { type: "string", description: "Component id (from list_components) or name" },
        intent: { type: "string", description: "What should change and why, in a sentence or two" },
        variant: { type: "string" },
      } },
      run: async ({ target, intent, variant }) => {
        const p = await findPart(target);
        const e = await api("/api/edits", { action: "create", text: intent, target: { part: p.id, variant }, author: "agent" });
        return text(await begun(await api("/api/edits", { action: "begin", id: e.id, agent: "mcp" }), p));
      },
    },
    {
      name: "begin_edit",
      description: "Pick up an open intent edit the human described: Lathe makes the worktree and returns its dir. Read the edit's target (component, variant, picked element) first.",
      inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      run: async ({ id }) => {
        const e = await api("/api/edits", { action: "begin", id, agent: "mcp" });
        const p = e.target?.part ? (await parts()).find((x) => x.id === e.target.part) : null;
        return text(await begun(e, p));
      },
    },
    {
      name: "get_edit",
      description: "One intent edit with its current diff against where it started.",
      inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      run: async ({ id }) => { const d = await api(`/api/edits/diff?id=${encodeURIComponent(id)}`); return text({ ...d.edit, patch: undefined, files: d.files, diff: d.patch.slice(0, 20000) }); },
    },
    {
      name: "submit_edit",
      description: "Hand the edit to the human for review. Lathe records the diff and flags raw colours and pixel values in added lines (the system uses tokens). Accepting or rejecting is the human's call.",
      inputSchema: { type: "object", required: ["id", "summary"], properties: { id: { type: "string" }, summary: { type: "string", description: "What you changed: what exists, what was wrong, change, why" } } },
      run: async ({ id, summary }) => {
        const e = await api("/api/edits", { action: "submit", id, summary });
        return text({ id: e.id, status: e.status, files: e.files, offSystem: e.offSystem, next: e.offSystem?.length ? "Some added lines use raw values. Replace them with tokens, then submit again." : "The human reviews it in Parts (Now vs Proposed)." });
      },
    },
    {
      name: "list_comments",
      description: "Comments the human and agents left in the workbench. target looks like part:<id>, token:--name, or a map page/section id.",
      inputSchema: { type: "object", properties: { target: { type: "string" }, open: { type: "boolean", description: "Only unresolved; default true" } } },
      run: async ({ target, open = true }) => text((await api("/api/comments")).filter((c) => (!target || c.target === target) && (!open || !c.resolved))),
    },
    {
      name: "comment",
      description: "Leave a comment in the workbench as the agent, on a component (part:<id>), a token (token:--name) or a map page/section id. Use it to explain a change as: what exists, what's wrong, change, why.",
      inputSchema: { type: "object", required: ["target", "text"], properties: { target: { type: "string" }, text: { type: "string" } } },
      run: async ({ target, text: t }) => { await api("/api/comments", { target, text: t, author: "agent" }); return text("Comment added."); },
    },
  ];

  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (method === "initialize") return reply({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lathe", version: VERSION },
        instructions: "Lathe is the workbench for design changes on this repo's coded system. Look before changing: list_components / get_component, then screenshot a variant (in each theme that matters) and look at it. Visual changes use only system values: token values via set_token (previews, never written to the repo), and prop values from a closed set. If the right value doesn't exist, propose a token or variant to the human. When the human says 'this', read get_selection.",
      });
      if (method === "ping") return reply({});
      if (method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
      if (method === "tools/call") {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return fail(-32602, `Unknown tool ${params?.name}`);
        try { return reply(await tool.run(params.arguments || {})); }
        catch (e) { return reply({ content: [{ type: "text", text: e.message }], isError: true }); }
      }
      if (method?.startsWith("notifications/")) return;
      fail(-32601, `Method not found: ${method}`);
    } catch (e) { fail(-32603, e.message); }
  });
  rl.on("close", () => process.exit(0));
}
