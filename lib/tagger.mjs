// Source tags for the canvas: inside Lathe's own Vite (never the app's), every
// host JSX element gets data-lathe-src="file:line:col" and data-lathe-in="Component",
// so a click on a rendered element reaches its line of code. Uses the repo's own
// @babel/core (Vite React apps nearly always have it); without it, nothing is tagged.
import path from "node:path";
import { createRequire } from "node:module";

export async function loadTagger({ root, appDir }) {
  let babel;
  try {
    const req = createRequire(path.join(appDir, "package.json"));
    babel = req(req.resolve("@babel/core", { paths: [appDir, root] }));
  } catch { return null; }

  // file → path relative to the repo, for both the working tree and the Before snapshot.
  // file → path relative to the repo, for the working tree, the Before snapshot and edit worktrees alike.
  const relOf = (id) => path.relative(root, id.split("?")[0]).split(path.sep).join("/").replace(/^\.(lathe|ux)\/(ui\/base|edits\/[\w-]+)\//, "");

  const plugin = ({ types: t }) => ({
    name: "lathe-source-tags",
    visitor: {
      // Components imported from packages (Radix, Base UI, a router's Link) render the DOM
      // themselves and forward data-* props, so they're tagged like host elements.
      Program(p, state) {
        state.pkg = new Set();
        for (const imp of p.node.body) {
          if (imp.type !== "ImportDeclaration" || imp.importKind === "type") continue;
          const src = imp.source.value;
          if (/^(\.|\/|@\/|~\/|#)/.test(src) || src === "react" || src.startsWith("react/")) continue;
          for (const sp of imp.specifiers) state.pkg.add(sp.local.name);
        }
      },
      JSXOpeningElement(p, state) {
        const n = p.node.name;
        const host = n.type === "JSXIdentifier" && /^[a-z]/.test(n.name);
        const head = n.type === "JSXIdentifier" ? n.name : n.type === "JSXMemberExpression" ? (function first(m) { return m.object.type === "JSXIdentifier" ? m.object.name : m.object.type === "JSXMemberExpression" ? first(m.object) : null; })(n) : null;
        if (!host && !(head && state.pkg?.has(head))) return;
        if (p.node.attributes.some((a) => a.type === "JSXAttribute" && a.name?.name === "data-lathe-src")) return;
        const loc = p.node.loc?.start;
        if (!loc) return;
        // The component this element is written in: nearest named function or const.
        let owner = null;
        for (let f = p.getFunctionParent(); f && !owner; f = f.getFunctionParent()) {
          const name = f.node.id?.name || (f.parentPath?.isVariableDeclarator() && f.parentPath.node.id.name)
            || (f.parentPath?.isCallExpression() && f.parentPath.parentPath?.isVariableDeclarator() && f.parentPath.parentPath.node.id.name);
          if (name && /^[A-Z]/.test(name)) owner = name;
        }
        p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier("data-lathe-src"), t.stringLiteral(`${state.opts.rel}:${loc.line}:${loc.column + 1}`)));
        if (owner) p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier("data-lathe-in"), t.stringLiteral(owner)));
      },
    },
  });

  return async function tag(code, id) {
    const file = id.split("?")[0];
    if (!/\.[jt]sx$/.test(file) || file.includes(`${path.sep}node_modules${path.sep}`) || !code.includes("<")) return null;
    if (!file.startsWith(root + path.sep)) return null;
    try {
      const out = await babel.transformAsync(code, {
        filename: file, babelrc: false, configFile: false, sourceMaps: true, compact: false, retainLines: true,
        parserOpts: { plugins: file.endsWith(".tsx") ? ["jsx", "typescript"] : ["jsx"] },
        plugins: [[plugin, { rel: relOf(file) }]],
      });
      return out && { code: out.code, map: out.map };
    } catch { return null; } // unparseable: leave it to Vite
  };
}
