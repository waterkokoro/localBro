# LocalBro Pack Format (v1)

LocalBro's **Skins** and **Plugins** share one open, JSON-first package
format called a **Pack**. A Pack is just a directory that contains a
`manifest.json` conforming to the schema below, plus whatever assets the
manifest references (CSS, JS, images, …).

The format is deliberately simple so that:

* anyone can author a Pack by hand, no tooling required
* a future package registry / marketplace can index them by reading
  manifests alone
* LocalBro's runtime can add capabilities over time without breaking
  existing packs (the manifest is versioned)

---

## 1. Directory layout

```
my-pack/
├── manifest.json          (required)
├── tokens.css             (skin only, path declared in manifest.json)
├── overrides.css          (optional, skin only)
├── preview.png            (optional, skin only — marketplace thumbnail)
├── entry.js               (plugin only, path declared in manifest.json)
├── icon.png               (optional, both)
└── …any other assets referenced from the files above
```

Installed packs live under:

* macOS / Linux: `~/Library/Application Support/localbro/{skins,plugins}/<pack-id>/`
* Windows: `%APPDATA%\localbro\{skins,plugins}\<pack-id>\`

You can open these folders from **Sidebar → 🎨 Skins → 📂**.

---

## 2. `manifest.json` schema

```jsonc
{
  "manifestVersion": 1,                 // integer, MUST be 1
  "id": "com.example.ocean-dark",       // reverse-dns recommended
  "type": "skin",                       // "skin" | "plugin"
  "name": "Ocean Dark",                 // human-readable
  "version": "1.0.0",                   // SemVer
  "description": "A deep blue theme.",  // optional
  "author": {                           // optional
    "name": "Jane Doe",
    "url": "https://example.com",
    "email": "jane@example.com"
  },
  "homepage": "https://example.com/ocean-dark", // optional
  "license": "MIT",                     // optional, SPDX id
  "icon": "icon.png",                   // optional, relative path
  "engine": {                           // optional
    "localbro": "^0.3.0"                // SemVer range against LocalBro
  },

  // Required when type === "skin"
  "skin": {
    "base": "dark",                     // "light" | "dark" (hint)
    "tokens": "tokens.css",             // REQUIRED, relative path
    "overrides": "overrides.css",       // optional
    "preview": "preview.png"            // optional
  },

  // Required when type === "plugin"
  "plugin": {
    "entry": "entry.js",                // REQUIRED, relative path
    "contributes": {                    // declarative extension points
      "previewAdapters": [],
      "archiveHandlers": []
      /* future keys are allowed */
    },
    "permissions": ["read_text"]        // see "Permissions" below
  }
}
```

### Field rules

| Field             | Rule                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `manifestVersion` | MUST equal `1`. Future breaking changes bump this.                        |
| `id`              | `[A-Za-z0-9._-]+`. Reverse-DNS is strongly recommended for uniqueness.    |
| `type`            | `"skin"` or `"plugin"`.                                                   |
| `version`         | Valid SemVer 2.0.0.                                                       |
| `skin.tokens`     | Required for skins. Relative path, MUST stay inside the pack directory.   |
| `plugin.entry`    | Required for plugins.                                                     |

Unknown top-level keys are silently ignored and preserved for
forward-compatibility.

---

## 3. Skins — how `tokens.css` is applied

LocalBro exposes every visual property as a CSS custom property under
the `--lb-*` namespace. A skin simply overrides them in `:root`:

```css
/* tokens.css */
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
```

Any token **not** overridden inherits from the bundled default
(`src/styles/tokens.css`), so authors only need to set what they want
to change.

### `overrides.css` (optional)

For non-token tweaks (e.g. hiding a specific element, adjusting a
corner radius). Applied after `tokens.css`.

### Token reference

See [`src/styles/tokens.css`](src/styles/tokens.css) for the full,
authoritative list. Every exposed token starts with `--lb-`.

---

## 4. Plugins (Task 9, runtime landed in v0.3)

The runtime loader ships in v0.3. Plugins listed in `Settings → Plugins`
can be enabled/disabled at any time; toggling triggers a hot reload of
just that plugin's contributions.

### Entry point (`entry.js`)

`manifest.plugin.entry` points at an ES module whose `default` export is
an `async (ctx) => void` called once on activation:

```js
// entry.js
export default async function activate(ctx) {
  // ctx.api  -> whitelisted LocalBro APIs (see Permissions)
  // ctx.manifest -> the parsed manifest
  // ctx.register.previewAdapter(adapter) -> register a preview adapter
  // ctx.register.aiTool(tool)           -> register an AI tool (OpenAI shape)
  ctx.register.aiTool({
    name: "hello",
    kind: "read",
    description: "Say hi.",
    pathFields: [],
    parameters: { type: "object", properties: {} },
    summary: () => "hello()",
    execute: async () => ({ ok: true, message: "hi from plugin" }),
  });
}
```

Failures inside `activate` are caught and logged; a broken plugin
cannot crash the host.

### `contributes.previewAdapters`

Declarative way to register a file-preview adapter without JS. The
runtime will build an `iframe`-based adapter automatically.

```jsonc
"previewAdapters": [
  {
    "id": "com.example.heic-viewer",
    "label": "HEIC",
    "priority": 60,
    "match": {
      "extensions": ["heic", "heif"],
      "mimes": ["image/heic"],
      "maxSize": 52428800
    },
    "renderer": {
      "kind": "iframe",
      "src": "renderer.html"
    }
  }
]
```

### `contributes.archiveHandlers` (Task 8 interop)

LocalBro ships built-in handlers for `zip`, `tar`, and `tar.gz`. Plugins
can add more (e.g. `rar`, `7z`) by declaring them here. At runtime the
Pack's `list` and `extract` JS entry files are called with the archive
path and expected to return/write the same shape as the built-ins.

```jsonc
"archiveHandlers": [
  {
    "id": "com.example.rar",
    "extensions": ["rar"],
    "list": "list.js",    // exports: (path) => Promise<ArchiveEntry[]>
    "extract": "extract.js" // exports: (path, dest) => Promise<ExtractResult>
  }
]
```

`ArchiveEntry` / `ExtractResult` shapes are documented in
[`src/api.ts`](src/api.ts) — they are the same ones the built-in
`list_archive` / `extract_archive` commands return.

#### `contributes.aiTools`

A Pack may expose additional OpenAI-compatible tool definitions to the
in-app AI agent. The runtime injects these into the tool list whenever
**AI Mode** is on, subject to the same policy (readonly / scope root /
confirm threshold).

```json
"aiTools": [
  {
    "name": "tag_files",
    "kind": "write",
    "description": "Apply a label to one or more files under the AI scope.",
    "pathFields": ["paths"],
    "parameters": {
      "type": "object",
      "properties": {
        "paths": { "type": "array", "items": { "type": "string" } },
        "tag":   { "type": "string" }
      },
      "required": ["paths", "tag"]
    },
    "entry": "tag.js"   // exports default async (args, ctx) => Result
  }
]
```

Rules:

- `kind: "write"` tools MUST declare every argument-field that contains
  a path under `pathFields` so LocalBro can enforce the scope lock.
- Tools are filtered out entirely when the user sets `readonly = true`
  and `kind === "write"`, so the LLM never sees them.
- The tool is registered at activation time via `ctx.register.aiTool`;
  declaring it in `contributes.aiTools` is informational so installers
  can show the permission-style prompt before the user enables the
  plugin.
- `aiTools` is **opt-in per plugin** — the user enables the Pack in
  `Settings → Plugins` and can disable it at any time.

As of v0.3, `ctx.register.aiTool` is live; tool names are namespaced
internally under the plugin's id so multiple plugins can ship a tool
with the same simple name.

### Permissions

Plugins MUST list the capabilities they need; anything not listed will
be blocked at runtime. Recognised values:

| Permission          | What it grants                                                |
| ------------------- | ------------------------------------------------------------- |
| `read_file`         | Read binary bytes of files the user is previewing.            |
| `read_text`         | Read UTF-8 text of files the user is previewing.              |
| `list_dir`          | Enumerate directories (read-only).                            |
| `spawn_sidecar:<n>` | Spawn the bundled native sidecar named `<n>`.                 |
| `net:<host>`        | Make HTTPS requests to `<host>` (e.g. `net:api.github.com`).  |

The full list will be finalised with Task 9. Plugins should ship the
narrowest set that works.

---

## 5. Installing a Pack (today)

Until a marketplace/installer exists, install is manual:

1. Put your Pack directory somewhere on disk.
2. Open LocalBro → **⚙ Settings → Skins** (for `type: "skin"`) or
   **⚙ Settings → Plugins** (for `type: "plugin"`).
3. Click **Install…** and paste the **absolute** path to the Pack
   directory.
4. LocalBro validates the manifest, copies the directory to
   `<app_data>/{skins,plugins}/<id>/`, and the Pack appears in the
   picker / plugin list.

Programmatic install (for future CLI/marketplace integrations):

```ts
await invoke("install_pack_from_folder", { src: "/absolute/path" });
```

Uninstall removes the directory:

```ts
await invoke("uninstall_pack", { kind: "skin", id: "com.example.x" });
```

---

## 6. Publishing (coming soon)

The planned registry is just **a git repo of manifest.json files**. To
list a Pack you'll open a PR adding a one-line entry pointing at a
downloadable zip of your Pack. No build tooling, no JS runtime, no
account required — everything a crawler needs lives in the manifest.

Stay tuned.
