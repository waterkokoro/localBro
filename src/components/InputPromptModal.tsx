import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Lightweight input dialog used in place of `window.prompt()`, which
 * is unreliable in Tauri's WKWebView (on macOS it silently returns
 * null). Renders a focused text input inside a standard backdrop
 * modal. Submits on Enter, closes on Escape / backdrop click / the
 * Cancel button.
 */
interface Props {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function InputPromptModal({
  title,
  message,
  defaultValue = "",
  placeholder,
  submitLabel,
  cancelLabel,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus + select the default so the user can immediately retype
  // or edit. Running once on mount matches native prompt() behaviour.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Escape closes the modal (parent handles the state).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    try {
      setBusy(true);
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prompt-backdrop" onMouseDown={onClose}>
      <form
        className="prompt-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header>
          <h3>{title}</h3>
        </header>
        <div className="body">
          {message && <div className="hint">{message}</div>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !value.trim()}
          >
            {submitLabel ?? t("common.ok")}
          </button>
        </footer>
      </form>
    </div>
  );
}
