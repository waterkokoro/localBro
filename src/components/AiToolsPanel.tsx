import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { allTools, toolOwner, type ToolDef } from "../ai/tools";
import { loadPolicy, type AiPolicy } from "../ai/policy";

/**
 * Settings → "AI Tools" tab.
 *
 * Shows every tool the agent can call, grouped by kind (Read / Write).
 * Each row surfaces:
 *   - name + description (from the OpenAI function schema)
 *   - provenance (built-in vs. plugin id)
 *   - whether it's currently visible to the LLM under the active
 *     policy (readonly / allowedTools filter)
 *
 * This panel is informational — configuration still happens under the
 * "AI" tab. The read-only view is what users most often want here:
 * "what can the agent actually do right now?"
 */
export default function AiToolsPanel() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<AiPolicy | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPolicy().then((p) => {
      if (!cancelled) setPolicy(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Recompute on each render — plugin tool registrations happen
  // asynchronously at boot, so a snapshot at mount time can miss them.
  const tools = useMemo(() => allTools(), []);

  const reads = tools.filter((x) => x.kind === "read");
  const writes = tools.filter((x) => x.kind === "write");

  // A tool is "hidden from the LLM" when either:
  //   - policy.readonly is true and the tool is a write, OR
  //   - policy.allowedTools is a non-null whitelist that excludes it.
  // These mirror the logic inside buildToolList() in ai/tools.ts so
  // what the user sees here matches what the agent actually receives.
  const isBlocked = (tool: ToolDef): "readonly" | "allowlist" | null => {
    if (!policy) return null;
    if (policy.allowedTools && !policy.allowedTools.includes(tool.name)) {
      return "allowlist";
    }
    if (policy.readonly && tool.kind === "write") {
      return "readonly";
    }
    return null;
  };

  return (
    <section className="ai-tools-panel">
      <p className="hint" style={{ marginBottom: 12 }}>
        {t("settings.aiTools.desc")}
      </p>

      {policy && (
        <div className="ai-tools-status">
          <span
            className={`ai-tools-chip ${policy.readonly ? "warn" : "ok"}`}
            title={t("settings.aiTools.readonlyHint")}
          >
            {policy.readonly
              ? t("settings.aiTools.readonlyOn")
              : t("settings.aiTools.readonlyOff")}
          </span>
          <span className="ai-tools-chip" title={t("settings.aiTools.scopeHint")}>
            {t("settings.aiTools.scopeLabel")}:{" "}
            <code>{policy.scopeRoot ?? t("ai.scopeUnset")}</code>
          </span>
          <span
            className="ai-tools-chip"
            title={t("settings.aiTools.thresholdHint")}
          >
            {t("settings.aiTools.thresholdLabel")}: {policy.confirmThreshold}
          </span>
        </div>
      )}

      <ToolGroup
        title={t("settings.aiTools.sectionRead")}
        tools={reads}
        isBlocked={isBlocked}
      />
      <ToolGroup
        title={t("settings.aiTools.sectionWrite")}
        tools={writes}
        isBlocked={isBlocked}
      />

      {tools.length === 0 && (
        <div className="empty-state">{t("settings.aiTools.empty")}</div>
      )}
    </section>
  );
}

interface ToolGroupProps {
  title: string;
  tools: ToolDef[];
  isBlocked: (t: ToolDef) => "readonly" | "allowlist" | null;
}

function ToolGroup({ title, tools, isBlocked }: ToolGroupProps) {
  const { t } = useTranslation();
  if (tools.length === 0) return null;
  return (
    <div className="ai-tools-group">
      <h4>
        {title}
        <span className="count">({tools.length})</span>
      </h4>
      <ul className="ai-tools-list">
        {tools.map((tool) => {
          const owner = toolOwner(tool.name);
          const block = isBlocked(tool);
          return (
            <li key={tool.name} className={`ai-tool-row${block ? " blocked" : ""}`}>
              <div className="ai-tool-row-head">
                <code className="name">{tool.name}</code>
                <span className={`kind kind-${tool.kind}`}>
                  {tool.kind === "read"
                    ? t("settings.aiTools.kindRead")
                    : t("settings.aiTools.kindWrite")}
                </span>
                {owner && owner !== "builtin" ? (
                  <span className="owner owner-plugin" title={owner}>
                    {t("settings.aiTools.ownerPlugin", { id: owner })}
                  </span>
                ) : (
                  <span className="owner owner-builtin">
                    {t("settings.aiTools.ownerBuiltin")}
                  </span>
                )}
                {block && (
                  <span className="block-reason">
                    {block === "readonly"
                      ? t("settings.aiTools.blockedReadonly")
                      : t("settings.aiTools.blockedAllowlist")}
                  </span>
                )}
              </div>
              <div className="ai-tool-row-desc">{tool.description}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
