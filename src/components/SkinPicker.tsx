import { useEffect, useState } from "react";
import * as api from "../api";
import {
  listAllSkins,
  setActiveSkin,
  getActiveSkinId,
} from "../skins/manager";

type Item = Awaited<ReturnType<typeof listAllSkins>>[number];

interface Props {
  onClose: () => void;
  /** When true, render inline content (no backdrop / outer frame / close button). */
  embedded?: boolean;
}

export default function SkinPicker({ onClose, embedded = false }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string>("builtin:default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    const [list, active] = await Promise.all([listAllSkins(), getActiveSkinId()]);
    setItems(list);
    setActiveId(active);
  };

  useEffect(() => {
    refresh();
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  const choose = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await setActiveSkin(id);
      setActiveId(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setError(null);
    const picked = window.prompt(
      "Paste the absolute path to a skin Pack folder (one containing manifest.json):",
    );
    if (!picked || !picked.trim()) return;
    setBusy(true);
    try {
      await api.installPackFromFolder(picked.trim());
      await refresh();
    } catch (e) {
      setError(`Install failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (id: string) => {
    if (!window.confirm(`Uninstall skin "${id}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.uninstallPack("skin", id);
      // Fall back to default if removing the active one.
      if (activeId === id) {
        await setActiveSkin("builtin:default");
        setActiveId("builtin:default");
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDir = async () => {
    try {
      const p = await api.packDir("skin");
      await api.createDirectory(p).catch(() => {});
      await api.revealInNative(p);
    } catch (e) {
      setError(String(e));
    }
  };

  const content = (
    <>
      <header className="preview-header">
        <span className="icon">🎨</span>
        <span className="name">Skins</span>
        <span className="muted">{items.length} available</span>
        <div className="spacer" />
        <button onClick={install} disabled={busy} title="Install from folder">＋ Install…</button>
        <button onClick={openDir} title="Open skins folder in file manager">📂</button>
        {!embedded && (
          <button onClick={onClose} title="Close (Esc)">✕</button>
        )}
      </header>

      {error && <div className="skin-error">{error}</div>}

      <div className="skin-grid">
        {items.map((it) => {
          const active = activeId === it.id;
          return (
            <div
              key={it.id}
              className={`skin-card ${active ? "active" : ""}`}
              onClick={() => !busy && choose(it.id)}
            >
              <div className="skin-swatch" data-base={it.base ?? "auto"}>
                {active && <span className="check">✓</span>}
              </div>
              <div className="skin-meta">
                <div className="name">{it.name}</div>
                {it.description && <div className="desc">{it.description}</div>}
                <div className="tags">
                  {it.builtin ? (
                    <span className="tag builtin">Built-in</span>
                  ) : (
                    <>
                      <span className="tag installed">Installed</span>
                      {it.pack?.version && (
                        <span className="tag version">v{it.pack.version}</span>
                      )}
                      <button
                        className="tag danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          uninstall(it.id);
                        }}
                      >
                        Uninstall
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="skin-footer">
        <span className="muted">
          Install a skin Pack by picking a folder containing a{" "}
          <code>manifest.json</code>. See <code>PACKS.md</code> for the format.
        </span>
      </footer>
    </>
  );

  if (embedded) {
    return <div className="skin-picker-inline">{content}</div>;
  }

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div className="skin-picker" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
