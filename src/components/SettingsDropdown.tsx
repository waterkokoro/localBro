import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser } from "../store";
import { setLocale, SUPPORTED, type Locale } from "../i18n";
import i18n from "../i18n";
import type { Tab as SettingsTab } from "./SettingsModal";

interface Props {
  /** Close the dropdown (click-outside or after picking an item). */
  onClose: () => void;
}

const LOCALE_LABELS: Record<Locale, string> = {
  "en": "English",
  "zh-CN": "简体中文",
};

/**
 * Compact dropdown replacement for the old Settings modal entry point.
 *
 * The goal is to surface the settings most users flip frequently
 * (language, preview pane, hidden items) without forcing a full-screen
 * modal; deeper pages (AI / Skins / Plugins / About) open the modal
 * pre-selected on the right tab.
 */
export default function SettingsDropdown({ onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const previewPaneEnabled = useBrowser((s) => s.previewPaneEnabled);
  const setPreviewPaneEnabled = useBrowser((s) => s.setPreviewPaneEnabled);
  const showHidden = useBrowser((s) => s.showHidden);
  const setShowHidden = useBrowser((s) => s.setShowHidden);
  const currentLocale = (i18n.language as Locale) || "en";

  // Dismiss on outside click / Escape.
  // We deliberately skip the click if it lands inside `.settings-wrap`
  // so the toolbar toggle button can close the menu itself via its own
  // onClick handler — without this guard the sequence would be:
  //   mousedown → onDoc fires → onClose() → click → toggles back open.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Let the anchor button's own onClick handle toggling closed.
      if (target?.closest(".settings-wrap")) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const openTab = (tab: SettingsTab) => {
    window.dispatchEvent(
      new CustomEvent("lb:open-settings", { detail: { tab } }),
    );
    onClose();
  };

  const pickLocale = async (loc: Locale) => {
    await setLocale(loc);
    // Keep the menu open so the user can see the UI flip; they can
    // close it explicitly. Force a re-render via the current state.
    // (react-i18next's LanguageDetector already triggers renders.)
  };

  return (
    <div ref={ref} className="settings-dropdown" role="menu">
      <div className="settings-dropdown-group">
        <div className="group-label">{t("settings.general.language")}</div>
        {SUPPORTED.map((loc) => (
          <button
            key={loc}
            className={`settings-dropdown-item${currentLocale === loc ? " active" : ""}`}
            onClick={() => pickLocale(loc)}
            role="menuitemradio"
            aria-checked={currentLocale === loc}
          >
            <span className="icon">{currentLocale === loc ? "●" : "○"}</span>
            <span className="label">{LOCALE_LABELS[loc]}</span>
          </button>
        ))}
      </div>

      <div className="settings-dropdown-sep" />

      <button
        className="settings-dropdown-item toggle"
        onClick={() => setPreviewPaneEnabled(!previewPaneEnabled)}
        role="menuitemcheckbox"
        aria-checked={previewPaneEnabled}
      >
        <span className="icon">{previewPaneEnabled ? "☑" : "☐"}</span>
        <span className="label">{t("settings.general.previewPane")}</span>
      </button>

      <button
        className="settings-dropdown-item toggle"
        onClick={() => setShowHidden(!showHidden)}
        role="menuitemcheckbox"
        aria-checked={showHidden}
      >
        <span className="icon">{showHidden ? "☑" : "☐"}</span>
        <span className="label">{t("toolbar.hidden")}</span>
      </button>

      <div className="settings-dropdown-sep" />

      <button
        className="settings-dropdown-item"
        onClick={() => openTab("ai")}
        role="menuitem"
      >
        <span className="icon">🤖</span>
        <span className="label">{t("settings.tab.ai")}…</span>
      </button>
      <button
        className="settings-dropdown-item"
        onClick={() => openTab("skins")}
        role="menuitem"
      >
        <span className="icon">🎨</span>
        <span className="label">{t("settings.tab.skins")}…</span>
      </button>
      <button
        className="settings-dropdown-item"
        onClick={() => openTab("plugins")}
        role="menuitem"
      >
        <span className="icon">🧩</span>
        <span className="label">{t("settings.tab.plugins")}…</span>
      </button>

      <div className="settings-dropdown-sep" />

      <button
        className="settings-dropdown-item"
        onClick={() => openTab("general")}
        role="menuitem"
      >
        <span className="icon">⚙</span>
        <span className="label">{t("settings.openFull")}</span>
      </button>
      <button
        className="settings-dropdown-item"
        onClick={() => openTab("about")}
        role="menuitem"
      >
        <span className="icon">ℹ️</span>
        <span className="label">{t("settings.tab.about")}…</span>
      </button>
    </div>
  );
}
