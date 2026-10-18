// Token maths shared by the scanner (Node) and the workbench (browser):
// colour parsing, var() resolution per theme, WCAG contrast.

const NAMED = { black: "#000000", white: "#ffffff", transparent: "rgba(0,0,0,0)" };

/** Parse a CSS colour into {r,g,b,a} (0–255, a 0–1), or null. Supports hex, rgb(a), hsl(a), black/white. */
export function parseColor(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (NAMED[v]) v = NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: alpha(m[4]) };
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
    const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return { r: f(0), g: f(8), b: f(4), a: alpha(m[4]) };
  }
  return null;
}
const alpha = (s) => (s == null ? 1 : s.endsWith("%") ? parseFloat(s) / 100 : +s);

export const toHex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("") + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : "");
export const isColor = (v) => !!parseColor(v);

const lum = (c) => {
  const ch = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
};
/** Composite a (possibly translucent) colour over an opaque one. */
export const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
export function contrast(fg, bg) {
  if (!fg || !bg || bg.a < 1) return null;
  const f = fg.a < 1 ? over(fg, bg) : fg;
  const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}
export const colorDistance = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2 + ((a.a - b.a) * 255) ** 2);

/**
 * Resolve every token for a theme. `tokens` = [{name, values: {theme: raw}}],
 * themes fall back to "default". `overrides` = {name: {theme: raw}}.
 */
export function resolver(tokens, overrides = {}) {
  const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));
  const raw = (name, theme) => {
    const o = overrides[name];
    if (o && o[theme] != null) return o[theme];
    if (o && theme !== "default" && o.default != null && byName[name]?.values?.[theme] == null) return o.default;
    const t = byName[name];
    if (!t) return null;
    return t.values[theme] ?? t.values.default ?? Object.values(t.values)[0];
  };
  const resolve = (value, theme, depth = 0) => {
    if (value == null || depth > 12) return value;
    return String(value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, n, fb) => {
      const r = raw(n, theme);
      return r != null ? resolve(r, theme, depth + 1) : fb != null ? resolve(fb.trim(), theme, depth + 1) : `var(${n})`;
    });
  };
  return { raw, value: (name, theme = "default") => resolve(raw(name, theme), theme), resolve };
}
