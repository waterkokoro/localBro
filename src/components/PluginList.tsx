import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import type { PackInfo } from "../api";
import {
  getEnabledPlugins,
  setPluginEnabled,
  reloadPlugins,
} from "../plugins/runtime";

/**
 * Manage installed Plugin Packs.
 *
 * Rendered inside Settings → Plugins. Skins show up in Settings →
 * Skins via the existing picker.
 */
export default function PluginList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<PackInfo[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const [list, en] = await Promise.all([
        api.listPacks("plugin"),
        getEnabledPlugins(),
      ]);
      setItems(list);
      setEnabled(new Set(en));
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = async (id: string, on: boolean) => {
    setBusy(true);
    try {
      await setPluginEnabled(id, on);
      const next = new Set(enabled);
      if (on) next.add(id);
      else next.delete(id);
      setEnabled(next);
      await reloadPlugins();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    const src = window.prompt("Absolute path to plugin Pack folder:");
    if (!src) return;
    setBusy(true);
    try {
      await api.installPackFromFolder(src.trim());
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (id: string) => {
    if (!window.confirm(`Uninstall plugin ${id}?`)) return;
    setBusy(true);
    try {
      await api.uninstallPack("plugin", id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plugin-list">
      <div className="plugin-list-actions">
        <button className="primary" onClick={install} disabled={busy}>
          {t("skins.install")}
        </button>
        <button onClick={refresh} disabled={busy} title="Refresh">
          ⟳
        </button>
      </div>

      {error && <div className="hint" style={{ color: "var(--lb-danger)" }}>{error}</div>}

      {items.length === 0 ? (
        <div className="hint">{t("plugins.empty")}</div>
      ) : (
        <ul className="plugin-rows">
          {items.map((p) => (
            <li key={p.id} className="plugin-row">
              <div className="head">
                <span className="icon">🧩</span>
                <span className="name">{p.name}</span>
                <span className="ver">v{p.version}</span>
              </div>
              {p.description && <div className="desc">{p.description}</div>}
              <div className="perm">
                {t("plugins.permissions")}:{" "}
                {p.plugin?.permissions?.length
                  ? p.plugin.permissions.map((x) => (
                      <code key={x}>{x}</code>
                    ))
                  : <em>none</em>}
              </div>
              <div className="row-actions">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={enabled.has(p.id)}
                    disabled={busy}
                    onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                  />
                  <span>
                    {enabled.has(p.id) ? t("plugins.disable") : t("plugins.enable")}
                  </span>
                </label>
                <button onClick={() => uninstall(p.id)} disabled={busy}>
                  {t("skins.uninstall")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
