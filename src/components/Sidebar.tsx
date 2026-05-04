import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser, COLLECTION_SCHEME } from "../store";

const iconFor = (kind: string) => {
  switch (kind) {
    case "home": return "🏠";
    case "desktop": return "🖥️";
    case "documents": return "📄";
    case "downloads": return "⬇️";
    case "pictures": return "🖼️";
    case "music": return "🎵";
    case "videos": return "🎬";
    case "volume": return "💽";
    case "recent": return "🕒";
    default: return "📁";
  }
};

export default function Sidebar() {
  const { t } = useTranslation();
  const shortcuts = useBrowser((s) => s.shortcuts);
  const volumes = useBrowser((s) => s.volumes);
  const collections = useBrowser((s) => s.collections);
  const cwd = useBrowser((s) => s.cwd);
  const navigate = useBrowser((s) => s.navigate);
  const createCollection = useBrowser((s) => s.createCollection);
  const deleteCollection = useBrowser((s) => s.deleteCollection);
  const renameCollection = useBrowser((s) => s.renameCollection);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const commitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      setNewName("");
      return;
    }
    try {
      const c = await createCollection(name);
      await navigate(`${COLLECTION_SCHEME}${c.id}`);
    } catch (e) {
      console.error("create collection failed:", e);
    }
    setCreating(false);
    setNewName("");
  };

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    if (name) {
      try {
        await renameCollection(id, name);
      } catch (e) {
        console.error("rename failed:", e);
      }
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const confirmDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete collection "${name}"?\n(Files on disk are untouched.)`)) {
      return;
    }
    try {
      await deleteCollection(id);
    } catch (e) {
      console.error("delete failed:", e);
    }
  };

  return (
    <aside className="sidebar">
      <h3>{t("sidebar.favorites")}</h3>
      {shortcuts.map((s) => (
        <div
          key={s.id}
          className={`sidebar-item ${cwd === s.path ? "active" : ""}`}
          onClick={() => navigate(s.path)}
          title={s.path}
        >
          <span className="icon">{iconFor(s.kind)}</span>
          <span>{s.label}</span>
        </div>
      ))}

      <div className="sidebar-heading">
        <h3 style={{ margin: 0, flex: 1 }}>{t("sidebar.collections")}</h3>
        <button
          className="icon-btn"
          onClick={() => setCreating(true)}
          title={t("sidebar.newCollection")}
        >
          ＋
        </button>
      </div>

      {collections.length === 0 && !creating && (
        <div className="sidebar-item sidebar-empty">
          <span className="icon">✨</span>
          <span>{t("sidebar.noCollections")}</span>
        </div>
      )}

      {collections.map((c) => {
        const virtualPath = `${COLLECTION_SCHEME}${c.id}`;
        const active = cwd === virtualPath;
        const isRenaming = renamingId === c.id;
        return (
          <div
            key={c.id}
            className={`sidebar-item collection ${active ? "active" : ""}`}
            onClick={() => !isRenaming && navigate(virtualPath)}
            onDoubleClick={() => {
              setRenamingId(c.id);
              setRenameValue(c.name);
            }}
            title={`${c.items.length} item${c.items.length === 1 ? "" : "s"}`}
          >
            <span className="icon">{c.icon ?? "⭐"}</span>
            {isRenaming ? (
              <input
                autoFocus
                className="sidebar-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id);
                  else if (e.key === "Escape") {
                    setRenamingId(null);
                    setRenameValue("");
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="label">{c.name}</span>
                <span className="count">{c.items.length}</span>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmDelete(c.id, c.name);
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        );
      })}

      {creating && (
        <div className="sidebar-item collection">
          <span className="icon">⭐</span>
          <input
            autoFocus
            className="sidebar-input"
            placeholder="Collection name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              else if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
          />
        </div>
      )}

      {volumes.length > 0 && (
        <>
          <h3>{t("sidebar.volumes")}</h3>
          {volumes.map((v) => (
            <div
              key={v.id}
              className={`sidebar-item ${cwd === v.path ? "active" : ""}`}
              onClick={() => navigate(v.path)}
              title={v.path}
            >
              <span className="icon">{iconFor(v.kind)}</span>
              <span>{v.label}</span>
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
