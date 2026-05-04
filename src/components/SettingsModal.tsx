import { useState } from "react";
import { useTranslation } from "react-i18next";
import AiSettings from "./AiSettings";
import AiToolsPanel from "./AiToolsPanel";
import SkinPicker from "./SkinPicker";
import PluginList from "./PluginList";
import { setLocale, SUPPORTED, type Locale } from "../i18n";
import i18n from "../i18n";
import { useBrowser } from "../store";

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

export type Tab = "general" | "ai" | "aiTools" | "skins" | "plugins" | "about";

const LOCALE_LABELS: Record<Locale, string> = {
  "en": "English",
  "zh-CN": "简体中文",
};

export default function SettingsModal({ onClose, initialTab }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(initialTab ?? "general");
  const [currentLocale, setCurrentLocale] = useState<Locale>(
    (i18n.language as Locale) || "en",
  );
  const previewPaneEnabled = useBrowser((s) => s.previewPaneEnabled);
  const setPreviewPaneEnabled = useBrowser((s) => s.setPreviewPaneEnabled);

  const changeLocale = async (loc: Locale) => {
    await setLocale(loc);
    setCurrentLocale(loc);
  };

  return (
    <div className="ai-settings-backdrop" onClick={onClose}>
      <div
        className="ai-settings settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3>{t("settings.title")}</h3>
          <button onClick={onClose} title={t("common.close")}>✕</button>
        </header>

        <div className="settings-tabs">
          {(["general", "ai", "aiTools", "skins", "plugins", "about"] as Tab[]).map((x) => (
            <button
              key={x}
              className={tab === x ? "active" : ""}
              onClick={() => setTab(x)}
            >
              {t(`settings.tab.${x}`)}
            </button>
          ))}
        </div>

        <div className="body">
          {tab === "general" && (
            <section>
              <label>
                <span>{t("settings.general.language")}</span>
                <select
                  value={currentLocale}
                  onChange={(e) => changeLocale(e.currentTarget.value as Locale)}
                >
                  {SUPPORTED.map((loc) => (
                    <option key={loc} value={loc}>
                      {LOCALE_LABELS[loc]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="hint">{t("settings.general.languageHint")}</div>

              <label className="checkbox-row" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={previewPaneEnabled}
                  onChange={(e) => setPreviewPaneEnabled(e.currentTarget.checked)}
                />
                <span>{t("settings.general.previewPane")}</span>
              </label>
              <div className="hint">{t("settings.general.previewPaneHint")}</div>
            </section>
          )}

          {tab === "ai" && (
            <AiSettings embedded onClose={onClose} />
          )}

          {tab === "aiTools" && <AiToolsPanel />}

          {tab === "skins" && (
            <SkinPicker embedded onClose={onClose} />
          )}

          {tab === "plugins" && (
            <section>
              <PluginList />
            </section>
          )}

          {tab === "about" && (
            <section>
              <div className="about-grid">
                <span className="k">{t("settings.about.version")}</span>
                <span className="v">LocalBro v0.3.0-dev</span>
                <span className="k">{t("settings.about.docs")}</span>
                <span className="v">
                  <a href="https://example.invalid/AI.md" onClick={(e) => e.preventDefault()}>
                    AI.md
                  </a>
                  {" · "}
                  <a href="https://example.invalid/PACKS.md" onClick={(e) => e.preventDefault()}>
                    PACKS.md
                  </a>
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
