/**
 * English dictionary — source of truth for all keys. Other locales
 * should mirror this structure.
 *
 * Keys use dotted namespaces: `<feature>.<thing>`. Keep values short.
 */

const en = {
  common: {
    apply: "Apply",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    close: "Close",
    ok: "OK",
    delete: "Delete",
    rename: "Rename",
    reject: "Reject",
    create: "Create",
    on: "On",
    off: "Off",
  },
  toolbar: {
    back: "Back",
    forward: "Forward",
    up: "Up",
    refresh: "Refresh",
    editAddress: "Double-click to edit",
    hidden: "Hidden",
    addTo: "Add to collection",
    addToTitle: "Add selection to collection",
    remove: "Remove",
    compress: "Compress",
    compressTitle: "Compress selection to .zip",
    extract: "Extract",
    settings: "Settings",
    ai: "AI",
    viewList: "List",
    viewGrid: "Grid",
    viewDetails: "Details",
  },
  sidebar: {
    favorites: "Favorites",
    collections: "Collections",
    volumes: "Volumes",
    noCollections: "No collections yet",
    newCollection: "New collection",
    skins: "Skins",
    ai: "AI",
  },
  list: {
    empty: "This folder is empty.",
    loading: "Loading…",
    loadFailed: "Failed to load: {{error}}",
    column: {
      name: "Name",
      size: "Size",
      modified: "Modified",
      kind: "Kind",
      created: "Created",
      extension: "Extension",
    },
    manageColumns: "Manage columns",
  },
  settings: {
    title: "Settings",
    openFull: "Open full settings…",
    tab: {
      general: "General",
      ai: "AI",
      aiTools: "AI Tools",
      skins: "Skins",
      plugins: "Plugins",
      about: "About",
    },
    general: {
      language: "Language",
      languageHint: "Takes effect immediately. Detected from your OS on first run.",
      defaultView: "Default view mode",
      previewPane: "Show preview pane on the right",
      previewPaneHint:
        "Single-click any file to preview it in the right panel. Double-click opens it with the OS default app.",
    },
    about: {
      version: "Version",
      docs: "Documentation",
      aiDoc: "AI design",
      packsDoc: "Pack specification",
    },
    aiTools: {
      desc:
        "Every callable the AI agent can invoke under the current policy. Write-kind tools are hidden from the model when AI mode is readonly.",
      sectionRead: "Read",
      sectionWrite: "Write",
      kindRead: "read",
      kindWrite: "write",
      ownerBuiltin: "built-in",
      ownerPlugin: "plugin: {{id}}",
      blockedReadonly: "hidden · readonly",
      blockedAllowlist: "hidden · allowlist",
      readonlyOn: "readonly ON",
      readonlyOff: "readonly OFF",
      readonlyHint:
        "Matches the AI-mode toggle on the agent panel. While ON, the model only sees read-kind tools.",
      scopeLabel: "scope",
      scopeHint: "The agent may only touch paths inside this subtree.",
      thresholdLabel: "confirm ≥",
      thresholdHint:
        "Any write touching at least this many paths pauses for your Apply/Reject.",
      empty: "No tools are registered.",
    },
  },
  ai: {
    title: "AI Assistant",
    mode: "AI Mode",
    modeHint:
      "When ON, deletes are globally blocked and the agent is scoped to the current folder.",
    scope: "scope",
    scopeOff: "off",
    scopeUnset: "(unset)",
    readonly: "readonly",
    empty:
      "Turn on AI Mode, then ask the assistant to organise, rename, compress, or collect files under the current folder. Writes beyond {{n}} items need your approval.",
    placeholderOn: "Ask me to organise, rename, compress…",
    placeholderOff: "Turn on AI Mode to start a scoped session.",
    send: "Send",
    stop: "Stop",
    clear: "Clear conversation",
    configurePrompt: "Configure your API key in ⚙ first.",
    toggleOn: "AI mode ON · scope locked to '{{scope}}' · readonly={{readonly}}",
    toggleOff: "AI mode OFF",
    toggleFailed: "Failed to toggle AI guard: {{error}}",
  },
  aiSettings: {
    title: "AI Settings",
    provider: "Provider",
    protocol: "Protocol",
    baseUrl: "Base URL",
    apiKey: "API Key",
    model: "Model",
    modelCustom: "Custom…",
    temperature: "Temperature",
    endpointHint:
      "Any OpenAI-compatible endpoint works: OpenAI, Azure OpenAI, Ollama, LM Studio, OpenRouter, DeepSeek, Qwen… Anthropic's native Messages API is also supported. Keys are stored in LocalBro's settings.json.",
    readonlyLabel: "Readonly mode (when AI mode is on, block all deletes/trash globally)",
    confirmAll: "Require approval for every write (not only large ones)",
    confirmThreshold: "Confirm threshold (≥ N affected paths)",
    maxIterations: "Max iterations per turn",
    scopeHint:
      "Scope is auto-set to the directory you were viewing when AI mode was enabled. The LLM is told this and the agent rejects tool calls targeting paths outside it.",
  },
  skins: {
    title: "Skins",
    install: "Install…",
    uninstall: "Uninstall",
    active: "Active",
    activate: "Activate",
    noSkins: "No skins found.",
  },
  plugins: {
    title: "Plugins",
    empty: "No plugins installed yet.",
    enable: "Enable",
    disable: "Disable",
    permissions: "Permissions",
  },
  preview: {
    title: "Preview",
    hide: "Hide preview pane",
    selectHint: "Select a file to preview it here.",
    multiSelection: "{{n}} items selected — select a single file to preview.",
    directoryHint: "Directories have no preview. Double-click to open.",
    noAdapter: "No preview available for this file type.",
    openExternal: "Open with default app",
    revealInNative: "Reveal in file manager",
  },
  fab: {
    title: "Quick actions",
    newFolder: "New folder",
    newFile: "New file",
    revealHere: "Show current folder in file manager",
    openHere: "Open current folder with default app",
    promptNewFolder: "New folder name:",
    promptNewFile: "New file name:",
  },
  ctx: {
    open: "Open",
    openExternal: "Open with default app",
    preview: "Quick preview",
    reveal: "Reveal in file manager",
    rename: "Rename…",
    copyPath: "Copy full path",
    copyName: "Copy name",
    compress: "Compress to .zip",
    extract: "Extract archive",
    addTo: "Add to collection",
    addToNew: "New collection…",
    removeFromCollection: "Remove from this collection",
    trash: "Move to trash",
    deleteForever: "Delete permanently",
    properties: "Properties",
    promptNewName: "New name:",
    promptZipName: "Create zip as:",
    confirmDelete: "Permanently delete {{name}}? This cannot be undone.",
  },
} as const;

// `Dict` uses plain string values so other locales can provide their own
// text; the structure (keys) is enforced by the typeof indirection.
export type Dict = {
  [K1 in keyof typeof en]: {
    [K2 in keyof typeof en[K1]]: (typeof en)[K1][K2] extends object
      ? { [K3 in keyof (typeof en)[K1][K2]]: string }
      : string;
  };
};

export default en as Dict;
