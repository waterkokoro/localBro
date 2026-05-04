/**
 * SkinManager — applies a Pack's tokens/overrides CSS by injecting
 * `<style>` blocks into the document head. Re-applying swaps out cleanly
 * so skin switches are instant and non-flashing.
 *
 * The "default" skin is represented as `null` and simply clears injected
 * styles, letting `tokens.css` (bundled with the app) take full effect.
 */

import * as api from "../api";
import type { PackInfo } from "../api";

const TOKENS_STYLE_ID = "lb-skin-tokens";
const OVERRIDES_STYLE_ID = "lb-skin-overrides";
const SETTING_KEY = "activeSkin";

/**
 * Built-in skins. These are shipped in-app so the picker is never empty
 * and users have live examples of the Pack token system. Each one is just
 * a delta over `tokens.css`; unset vars inherit from the default skin.
 */
export interface BuiltinSkin {
  /** Stable id, always prefixed with `builtin:` */
  id: string;
  name: string;
  description: string;
  /** "light" | "dark" | "auto" — UI hint only */
  base: "light" | "dark" | "auto";
  /** CSS text to inject verbatim. */
  css: string;
}

export const BUILTIN_SKINS: BuiltinSkin[] = [
  {
    id: "builtin:default",
    name: "System Default",
    description: "Follow system light/dark preference",
    base: "auto",
    css: "",
  },
  {
    id: "builtin:ocean-dark",
    name: "Ocean Dark",
    description: "Deep blue night theme",
    base: "dark",
    css: `
:root {
  color-scheme: dark;
  --lb-bg:             #0d1b2a;
  --lb-bg-elevated:    #13243a;
  --lb-bg-sidebar:     #0a1522;
  --lb-bg-hover:       rgba(255, 255, 255, 0.06);
  --lb-bg-selected:    #1d4e89;
  --lb-bg-selected-fg: #ffffff;

  --lb-fg:             #e6edf5;
  --lb-fg-muted:       #8fa3bf;
  --lb-fg-subtle:      #5c7291;
  --lb-border:         rgba(143, 163, 191, 0.15);
  --lb-border-strong:  rgba(143, 163, 191, 0.3);

  --lb-accent:         #4cc9f0;
  --lb-accent-fg:      #0a1522;
  --lb-danger:         #ff6b6b;
}
`,
  },
  {
    id: "builtin:nord",
    name: "Nord",
    description: "Arctic, north-bluish palette",
    base: "dark",
    css: `
:root {
  color-scheme: dark;
  --lb-bg:             #2e3440;
  --lb-bg-elevated:    #3b4252;
  --lb-bg-sidebar:     #292e39;
  --lb-bg-hover:       rgba(236, 239, 244, 0.05);
  --lb-bg-selected:    #5e81ac;
  --lb-bg-selected-fg: #eceff4;

  --lb-fg:             #eceff4;
  --lb-fg-muted:       #d8dee9;
  --lb-fg-subtle:      #81a1c1;
  --lb-border:         rgba(216, 222, 233, 0.1);
  --lb-border-strong:  rgba(216, 222, 233, 0.22);

  --lb-accent:         #88c0d0;
  --lb-accent-fg:      #2e3440;
  --lb-danger:         #bf616a;
}
`,
  },
  {
    id: "builtin:solarized-light",
    name: "Solarized Light",
    description: "Ethan Schoonover's balanced light palette",
    base: "light",
    css: `
:root {
  color-scheme: light;
  --lb-bg:             #fdf6e3;
  --lb-bg-elevated:    #eee8d5;
  --lb-bg-sidebar:     #f3eccb;
  --lb-bg-hover:       rgba(101, 123, 131, 0.08);
  --lb-bg-selected:    #b58900;
  --lb-bg-selected-fg: #fdf6e3;

  --lb-fg:             #073642;
  --lb-fg-muted:       #657b83;
  --lb-fg-subtle:      #93a1a1;
  --lb-border:         rgba(7, 54, 66, 0.1);
  --lb-border-strong:  rgba(7, 54, 66, 0.2);

  --lb-accent:         #268bd2;
  --lb-accent-fg:      #fdf6e3;
  --lb-danger:         #dc322f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --lb-bg: #fdf6e3;
    --lb-bg-elevated: #eee8d5;
    --lb-bg-sidebar: #f3eccb;
    --lb-fg: #073642;
    --lb-fg-muted: #657b83;
    --lb-fg-subtle: #93a1a1;
  }
}
`,
  },
];

function isBuiltin(id: string): boolean {
  return id.startsWith("builtin:");
}

function findBuiltin(id: string): BuiltinSkin | undefined {
  return BUILTIN_SKINS.find((s) => s.id === id);
}

function injectStyle(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function clearStyle(id: string) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/**
 * Apply a skin by id. `null` or `"builtin:default"` restores the bundled
 * default tokens. Unknown ids are treated as the default and logged.
 */
export async function applySkin(id: string | null): Promise<void> {
  if (!id || id === "builtin:default") {
    clearStyle(TOKENS_STYLE_ID);
    clearStyle(OVERRIDES_STYLE_ID);
    return;
  }

  if (isBuiltin(id)) {
    const s = findBuiltin(id);
    if (!s) {
      console.warn(`[skin] unknown builtin '${id}', falling back to default`);
      clearStyle(TOKENS_STYLE_ID);
      clearStyle(OVERRIDES_STYLE_ID);
      return;
    }
    injectStyle(TOKENS_STYLE_ID, s.css);
    clearStyle(OVERRIDES_STYLE_ID);
    return;
  }

  // Installed pack: read tokens.css (and optional overrides.css) from the
  // manifest-declared paths.
  try {
    const packs = await api.listPacks("skin");
    const pack = packs.find((p) => p.id === id);
    if (!pack || !pack.skin) {
      console.warn(`[skin] pack '${id}' not installed, falling back to default`);
      clearStyle(TOKENS_STYLE_ID);
      clearStyle(OVERRIDES_STYLE_ID);
      return;
    }
    const tokensCss = await api.readPackText("skin", id, pack.skin.tokens);
    injectStyle(TOKENS_STYLE_ID, tokensCss);
    if (pack.skin.overrides) {
      const ovCss = await api.readPackText("skin", id, pack.skin.overrides);
      injectStyle(OVERRIDES_STYLE_ID, ovCss);
    } else {
      clearStyle(OVERRIDES_STYLE_ID);
    }
  } catch (e) {
    console.error(`[skin] failed to apply '${id}':`, e);
    clearStyle(TOKENS_STYLE_ID);
    clearStyle(OVERRIDES_STYLE_ID);
  }
}

export async function getActiveSkinId(): Promise<string> {
  try {
    const v = await api.settingsGet<string>(SETTING_KEY);
    return v ?? "builtin:default";
  } catch {
    return "builtin:default";
  }
}

export async function setActiveSkin(id: string): Promise<void> {
  await api.settingsSet(SETTING_KEY, id);
  await applySkin(id);
}

/** Load and apply persisted skin at startup. */
export async function initSkins(): Promise<string> {
  const id = await getActiveSkinId();
  await applySkin(id);
  return id;
}

/** Combined list: builtins first, then installed user packs. */
export async function listAllSkins(): Promise<Array<{
  id: string;
  name: string;
  description?: string | null;
  base?: string | null;
  builtin: boolean;
  pack?: PackInfo;
}>> {
  const builtins = BUILTIN_SKINS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    base: s.base,
    builtin: true,
  }));
  const installed = await api.listPacks("skin").catch(() => []);
  return [
    ...builtins,
    ...installed.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      base: p.skin?.base ?? null,
      builtin: false,
      pack: p,
    })),
  ];
}
