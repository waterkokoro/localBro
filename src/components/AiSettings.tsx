import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  loadConfig,
  loadPolicy,
  saveConfig,
  savePolicy,
  type AiConfig,
  type AiPolicy,
} from "../ai/policy";
import {
  PROVIDERS,
  findProvider,
  guessProvider,
  type Protocol,
  type ProviderPreset,
} from "../ai/providers";

interface Props {
  onClose: () => void;
  /** When true, render as inline content (no backdrop / no outer frame / no title bar). */
  embedded?: boolean;
}

export default function AiSettings({ onClose, embedded = false }: Props) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
  const [policy, setPolicy] = useState<AiPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([loadConfig(), loadPolicy()]);
      // Back-fill provider/protocol for configs saved before v0.3.
      if (!c.provider) {
        const guess = guessProvider(c.baseUrl);
        c.provider = guess.id;
        if (!c.protocol) c.protocol = guess.protocol;
      }
      if (!c.protocol) c.protocol = "openai";
      setConfig(c);
      setPolicy(p);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    // In embedded mode a parent owns the Esc handler, so don't steal it.
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  const currentProvider: ProviderPreset | null = useMemo(
    () => findProvider(config.provider),
    [config.provider],
  );

  const selectProvider = (id: string) => {
    const preset = findProvider(id);
    if (!preset) return;
    // Only overwrite url/protocol/model with preset values — keep the
    // api key the user already typed.
    setConfig({
      ...config,
      provider: preset.id,
      protocol: preset.protocol,
      baseUrl: preset.id === "custom" ? config.baseUrl : preset.baseUrl,
      model:
        preset.models.length > 0 && !preset.models.includes(config.model)
          ? preset.models[0]
          : config.model,
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(config);
      await savePolicy(policy);
      if (embedded) {
        // Stay on the panel; just give a small visual ack.
        setSavedTick((t) => t + 1);
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const modelOptions = currentProvider?.models ?? [];
  const modelIsCustom =
    modelOptions.length === 0 || !modelOptions.includes(config.model);

  const body = (
    <>
      <section>
        <label>
          <span>{t("aiSettings.provider")}</span>
          <select
            value={config.provider ?? "custom"}
            onChange={(e) => selectProvider(e.currentTarget.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("aiSettings.protocol")}</span>
          <select
            value={config.protocol ?? "openai"}
            onChange={(e) =>
              setConfig({ ...config, protocol: e.currentTarget.value as Protocol })
            }
          >
            <option value="openai">OpenAI Chat Completions</option>
            <option value="anthropic">Anthropic Messages API</option>
          </select>
        </label>
        <label>
          <span>{t("aiSettings.baseUrl")}</span>
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.currentTarget.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label>
          <span>{t("aiSettings.apiKey")}</span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.currentTarget.value })}
            placeholder="sk-…"
          />
        </label>
        <label>
          <span>{t("aiSettings.model")}</span>
          {modelOptions.length > 0 ? (
            <select
              value={modelIsCustom ? "__custom__" : config.model}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "__custom__") {
                  setConfig({ ...config, model: "" });
                } else {
                  setConfig({ ...config, model: v });
                }
              }}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="__custom__">{t("aiSettings.modelCustom")}</option>
            </select>
          ) : null}
          {(modelIsCustom || modelOptions.length === 0) && (
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.currentTarget.value })}
              placeholder="gpt-4o-mini / deepseek-v4-pro / claude-3-5-sonnet-latest"
            />
          )}
        </label>
        <label>
          <span>{t("aiSettings.temperature")}</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={config.temperature ?? 0.2}
            onChange={(e) =>
              setConfig({ ...config, temperature: parseFloat(e.currentTarget.value) || 0 })
            }
          />
        </label>
        <div className="hint">
          {currentProvider?.note ?? t("aiSettings.endpointHint")}
        </div>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={policy.readonly}
            onChange={(e) => setPolicy({ ...policy, readonly: e.currentTarget.checked })}
          />
          <span>{t("aiSettings.readonlyLabel")}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={policy.confirmAllWrites}
            onChange={(e) =>
              setPolicy({ ...policy, confirmAllWrites: e.currentTarget.checked })
            }
          />
          <span>{t("aiSettings.confirmAll")}</span>
        </label>
        <label>
          <span>{t("aiSettings.confirmThreshold")}</span>
          <input
            type="number"
            min={1}
            value={policy.confirmThreshold}
            onChange={(e) =>
              setPolicy({
                ...policy,
                confirmThreshold: parseInt(e.currentTarget.value, 10) || 1,
              })
            }
          />
        </label>
        <label>
          <span>{t("aiSettings.maxIterations")}</span>
          <input
            type="number"
            min={1}
            max={64}
            value={policy.maxIterations}
            onChange={(e) =>
              setPolicy({
                ...policy,
                maxIterations: parseInt(e.currentTarget.value, 10) || 1,
              })
            }
          />
        </label>
        <div className="hint">{t("aiSettings.scopeHint")}</div>
      </section>

      {error && <div className="hint" style={{ color: "var(--lb-danger)" }}>{error}</div>}
    </>
  );

  if (embedded) {
    return (
      <div className="ai-settings-inline">
        <div className="body">{body}</div>
        <div className="inline-footer">
          {savedTick > 0 && !saving && (
            <span className="saved-ack">{t("common.save")} ✓</span>
          )}
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-settings-backdrop" onClick={onClose}>
      <div className="ai-settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{t("aiSettings.title")}</h3>
          <button onClick={onClose} title={t("common.close")}>✕</button>
        </header>

        <div className="body">{body}</div>

        <footer>
          <button onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
