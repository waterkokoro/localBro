# LocalBro PRD Index

This folder pins LocalBro's product requirements. One file per release
train; the latest file is the source of truth for that version.

| Version            | Status    | Scope                                              |
| ------------------ | --------- | -------------------------------------------------- |
| [v0.1](./v0.1-mvp.md) | Released  | Core file browser MVP (browse, preview, size)      |
| [v0.2](./v0.2-ai-and-packs.md) | Released  | AI assistant, Skins, Collections, Archives, Pack spec |
| [v0.3](./v0.3-plugins-and-polish.md) | In progress | Plugin runtime, i18n, settings hub, list columns |

## Conventions

- Every new feature needs a bullet in the relevant PRD *before* code
  lands.
- Scope cuts get recorded in a `Non-goals` section, not deleted.
- Architecture / security decisions live under `Design notes`. When
  they change, edit in place and add a dated line under `Decision log`.
- Anything cross-cutting (e.g. the Pack spec) has its own top-level
  doc ([`../../PACKS.md`](../../PACKS.md), [`../../AI.md`](../../AI.md))
  and is only *linked* from PRDs.
