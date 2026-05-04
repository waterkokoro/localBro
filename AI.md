# AI Assistant — Technical Design

LocalBro ships with an in-app AI agent that can organise the folder the
user is currently browsing: **rename**, **move**, **copy**, **batch
collect**, **tag**, **compress**, **extract** and **list / read** files.

This document explains **why** we chose to standardise on the OpenAI
function-calling protocol, **how** the local agent loop works, and
**what** the safety boundaries are. If you only want to use it,
read the section "Using it" at the bottom.

---

## 1. Design goals

1. **BYO model** — the user plugs in any OpenAI-compatible endpoint
   (OpenAI, Azure OpenAI, Ollama, LM Studio, DeepSeek, Qwen, Claude via
   gateway, …). No per-vendor SDK.
2. **No hidden capabilities** — the agent can only do what a tool
   exposes, and every tool is declared in one place.
3. **Defence in depth** — the model is *not* part of the trust chain;
   even a compromised/misbehaving model cannot delete files or escape
   the user-picked folder.
4. **No new Rust commands** for AI — reuse the same `api.*` surface the
   UI uses, so there is exactly one code path for every file mutation.

## 2. Protocol choices

| Layer            | Choice                                       | Rationale                                           |
| ---------------- | -------------------------------------------- | --------------------------------------------------- |
| Transport        | `POST /chat/completions` (OpenAI 1:1)        | De-facto standard; every modern provider speaks it. |
| Tool description | OpenAI `tools[].function` with JSON Schema    | Same shape OpenAI/Anthropic/Qwen/DeepSeek accept.    |
| Tool dispatch    | Client-side loop in TypeScript (`ai/agent.ts`) | No serverless step; works fully offline with Ollama. |
| Policy           | `AiPolicy` JSON persisted via `settings_*`    | Inspectable, syncable, reviewable in diffs.         |

No server component, no gateway, no custom message envelope.

## 3. Four lines of defence

The single most important design decision is that safety **does not
rely on the LLM behaving well**. All four layers are enforced by code
that runs regardless of the model's output.

### (a) Rust guard — the last line

[`src-tauri/src/core/ai_guard.rs`](src-tauri/src/core/ai_guard.rs) is a
process-wide `RwLock<bool>`. Whenever **AI Mode** is ON, the
`move_to_trash` and `delete_forever` commands hard-fail with
`PermissionDenied` — this protects the user even if every JS-level
check is bypassed (e.g. a compromised plugin).

```rust
guard.check_destructive("move_to_trash")?;
fs_ops::move_to_trash(&path)
```

### (b) Scope lock — frontend

When the user flips AI Mode on, the **current cwd** is pinned as
`policy.scopeRoot`. Every tool declares which of its argument-fields
contain paths (`pathFields`), and the dispatcher rejects a call where
any path is not `==` or a descendant of the scope root.

This is enforced in [`src/ai/tools.ts`](src/ai/tools.ts) by
`validateCall()` — the checks run *before* any `api.*` call fires.

### (c) Confirmation threshold

Each tool reports its `affectCount` (e.g. `move_paths.src.length`). If
that count meets the policy threshold, the agent **pauses**, surfaces
an Approve / Reject card in the UI, and only resumes once the user
clicks. `confirmAllWrites = true` asks for approval on every write,
regardless of size.

### (d) Audit trail

Every tool call renders as its own card in the transcript with name,
arguments summary, result, and status. Output is stringified and
appended to the message history as a `tool` message, so the model
cannot "pretend" a call succeeded that in fact failed.

## 4. The agent loop

```
runTurn(config, policy, messages):
  loop up to policy.maxIterations:
    res = chat(config, messages, tools)
    messages.push(res)                  # assistant
    if res.tool_calls is empty: break
    for call in res.tool_calls:
      validate_scope_and_readonly(call)
      if needs_approval(call):
          emit(awaiting); await user_decision
      result = dispatch_to_api(call)
      messages.push({role: "tool", tool_call_id, content: result})
```

Cancellation is wired to an `AbortController` — the UI "Stop" button
aborts the in-flight HTTP request and rejects any pending approval.

[`src/ai/agent.ts`](src/ai/agent.ts) is the full implementation —
~250 lines, no dependencies beyond `fetch`.

## 5. Tool catalogue

Declared once in [`src/ai/tools.ts`](src/ai/tools.ts). Each tool has:

- `name` — what the LLM calls it
- `kind` — `"read"` | `"write"`
- `description` — the LLM's only hint
- `parameters` — JSON Schema validated on arrival
- `pathFields` — for scope enforcement
- `affectCount` — for the confirmation threshold
- `run(args)` — a thin wrapper around an existing `api.*` function

Current tools:

| Tool                 | Kind  | Backed by                 |
| -------------------- | ----- | ------------------------- |
| `list_dir`           | read  | `api.listDir`             |
| `stat`               | read  | `api.stat`                |
| `read_text_file`     | read  | `api.readTextFile`        |
| `list_collections`   | read  | `api.listCollections`     |
| `list_archive`       | read  | `api.listArchive`         |
| `rename`             | write | `api.rename`              |
| `move_paths`         | write | `api.movePath` (per item) |
| `copy_paths`         | write | `api.copyPath` (per item) |
| `create_directory`   | write | `api.createDirectory`     |
| `create_collection`  | write | `api.createCollection`    |
| `add_to_collection`  | write | `api.addToCollection`     |
| `extract_archive`    | write | `api.extractArchive`      |
| `create_zip`         | write | `api.createZip`           |

> **Deletion is intentionally absent.** AI Mode is mutually exclusive
> with delete operations. The user retains full delete power in the
> regular UI (after turning AI Mode off).

### Extending via Packs

Plugins can contribute extra tools (tagging, OCR, metadata edits, …)
via `contributes.aiTools` in `manifest.json`. See
[`PACKS.md`](PACKS.md#contributesaitools-planned). The same validation
and approval pipeline applies.

## 6. Standardisation summary

| Question                                         | Decision                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Unify the tool surface for the LLM?              | **Yes.** One declarative registry, OpenAI-shaped.                       |
| Build a local agent loop?                        | **Yes**, in ~250 lines of TS — no server, no extra process.             |
| Standardise the protocol?                        | **Yes** — OpenAI Chat Completions + function calling, JSON Schema.       |
| Add new Rust commands for AI?                    | **No.** Tools wrap existing commands so the UI and AI share one path.   |
| Let the LLM delete files?                        | **No.** AI Mode globally blocks deletes at the Rust level.              |

## 7. Using it

1. Click **🤖 AI** in the left sidebar.
2. Click **⚙** and paste:
   - Base URL (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`)
   - API key
   - Model (e.g. `gpt-4o-mini`, `qwen2.5:7b`, `claude-3-5-sonnet`)
3. Navigate to the folder you want the agent to operate on.
4. Toggle **AI Mode ON**. The current folder becomes the scope and
   deletes are disabled globally.
5. Chat: *"Rename every `IMG_*.jpg` to include the date they were
   taken"*, *"Group these screenshots into a `2025-Q3` folder"*,
   *"Add all `.pdf` under here to the Research collection"*, *"Make a
   zip of the `src` folder"* …
6. For large batches you'll see an **Apply / Reject** prompt before
   anything writes to disk.
7. Toggle **AI Mode OFF** to restore normal delete capability.

## 8. Roadmap

- Plugin-contributed `aiTools` (Task 9).
- Token usage accounting in the footer.
- Conversation export / shareable "agent recipes".
- Per-tool rate limits.
