import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { useBrowser } from "../store";
import {
  loadConfig,
  loadPolicy,
  savePolicy,
  type AiConfig,
  type AiPolicy,
} from "../ai/policy";
import type { ChatMessage } from "../ai/client";
import {
  buildSystemPrompt,
  runTurn,
  type AgentHandle,
  type CallRecord,
} from "../ai/agent";
import AiSettings from "./AiSettings";

interface Props {
  onClose: () => void;
}

/** Timeline entry rendered in the transcript. */
type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "system"; text: string }
  | { kind: "tool"; call: CallRecord };

export default function AiPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const cwd = useBrowser((s) => s.cwd);
  const aiPanelWidth = useBrowser((s) => s.aiPanelWidth);
  const setAiPanelWidth = useBrowser((s) => s.setAiPanelWidth);

  const [config, setConfig] = useState<AiConfig | null>(null);
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  // AI mode defaults to ON. The effect below flips the Rust guard and
  // pins the scope to cwd once config/policy/cwd are all ready; the
  // `didAutoEnableRef` flag ensures this only happens on first mount,
  // so toggling OFF manually later sticks.
  const [aiOn, setAiOn] = useState(true);
  const didAutoEnableRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  // Persisted conversation history (OpenAI messages).
  const historyRef = useRef<ChatMessage[]>([]);
  const handleRef = useRef<AgentHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // --- Resizer (drag the left edge to widen / narrow the panel) --------
  // We read the live width from the store on mousedown (closure capture)
  // and write it back on every mousemove via setAiPanelWidth, which also
  // persists the new width to settings.json.
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = useBrowser.getState().aiPanelWidth;
      const move = (ev: MouseEvent) => {
        // The panel sits on the right, so dragging left (Δx < 0) widens it.
        setAiPanelWidth(startW - (ev.clientX - startX));
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setAiPanelWidth],
  );

  // Load settings on mount and whenever the settings modal closes.
  const reload = useCallback(async () => {
    const [c, p] = await Promise.all([loadConfig(), loadPolicy()]);
    setConfig(c);
    setPolicy(p);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  // Auto-scroll on new entries.
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries]);

  // Materialize the default-ON AI mode: once we have a loaded policy,
  // a loaded config and a non-empty cwd, fire the same side-effects a
  // manual toggle would (Rust readonly guard + scopeRoot). We gate on
  // cwd to avoid pinning scope to an empty string, which would leave
  // the agent unscoped.
  useEffect(() => {
    if (didAutoEnableRef.current) return;
    if (!policy || !config || !aiOn || !cwd) return;
    didAutoEnableRef.current = true;
    void toggleAi(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy, config, aiOn, cwd]);

  // Flip the Rust guard whenever the local toggle changes. This is the
  // ground-truth protection — even a bug in the JS agent can't bypass it.
  const toggleAi = async (next: boolean) => {
    try {
      await api.aiSetReadonly(next && (policy?.readonly ?? true));
      setAiOn(next);
      // Pin the scope to the directory the user was viewing when they
      // enabled AI mode. They can still `cd` freely in the file list;
      // the scope stays frozen until they disable AI mode.
      if (next && policy) {
        const updated = { ...policy, scopeRoot: cwd || null };
        setPolicy(updated);
        await savePolicy(updated);
        pushSystem(
          t("ai.toggleOn", {
            scope: cwd || "(none)",
            readonly: String(updated.readonly),
          }),
        );
      } else {
        pushSystem(t("ai.toggleOff"));
      }
    } catch (e) {
      pushSystem(t("ai.toggleFailed", { error: String(e) }));
    }
  };

  const pushSystem = (text: string) => setEntries((xs) => [...xs, { kind: "system", text }]);

  const send = async () => {
    if (!prompt.trim() || running || !config || !policy) return;
    if (!config.apiKey && !config.baseUrl.includes("localhost") && !config.baseUrl.includes("127.0.0.1")) {
      pushSystem(t("ai.configurePrompt"));
      return;
    }

    const userText = prompt.trim();
    setPrompt("");
    setEntries((xs) => [...xs, { kind: "user", text: userText }]);

    // First turn: inject the system prompt.
    if (historyRef.current.length === 0) {
      historyRef.current.push({
        role: "system",
        content: buildSystemPrompt(policy, cwd),
      });
    }
    historyRef.current.push({ role: "user", content: userText });

    setRunning(true);
    const callIndex = new Map<string, number>();
    try {
      const updated = await runTurn({
        config,
        policy,
        messages: historyRef.current,
        onHandle: (h) => (handleRef.current = h),
        emit: (evt) => {
          if (evt.type === "assistant") {
            setEntries((xs) => [...xs, { kind: "assistant", text: evt.content }]);
          } else if (evt.type === "tool") {
            setEntries((xs) => {
              callIndex.set(evt.call.id, xs.length);
              return [...xs, { kind: "tool", call: evt.call }];
            });
          } else if (evt.type === "tool_update") {
            setEntries((xs) => {
              const idx = callIndex.get(evt.call.id);
              if (idx == null) return xs;
              const next = xs.slice();
              next[idx] = { kind: "tool", call: evt.call };
              return next;
            });
          } else if (evt.type === "error") {
            setEntries((xs) => [...xs, { kind: "system", text: `⚠ ${evt.error}` }]);
          }
        },
      });
      historyRef.current = updated;
    } finally {
      handleRef.current = null;
      setRunning(false);
      // Nudge the file list so the user sees any mutations.
      useBrowser.getState().refresh().catch(() => {});
    }
  };

  const approve = (id: string) => handleRef.current?.approve(id);
  const reject = (id: string) => handleRef.current?.reject(id);
  const abort = () => handleRef.current?.abort();

  const resetConversation = () => {
    historyRef.current = [];
    setEntries([]);
  };

  const scopeLabel = useMemo(() => {
    if (!aiOn) return t("ai.scopeOff");
    return policy?.scopeRoot ?? t("ai.scopeUnset");
  }, [aiOn, policy?.scopeRoot, t]);

  return (
    <aside className="ai-panel">
      <div
        className="ai-resizer"
        onMouseDown={onResizeStart}
        title={`${aiPanelWidth}px`}
        role="separator"
        aria-orientation="vertical"
      />
      <header className="ai-panel-header">
        <span className="icon">🤖</span>
        <span className="title">{t("ai.title")}</span>
        <label className="toggle" title={t("ai.modeHint")}>
          <input
            type="checkbox"
            checked={aiOn}
            disabled={running}
            onChange={(e) => toggleAi(e.currentTarget.checked)}
          />
          <span>{t("ai.mode")}</span>
        </label>
        <button onClick={() => setSettingsOpen(true)} title={t("toolbar.settings")}>⚙</button>
        <button onClick={resetConversation} title={t("ai.clear")}>🗑</button>
        <button onClick={onClose} title={t("common.close")}>✕</button>
      </header>

      <div className="ai-scope" data-on={aiOn}>
        <span>{t("ai.scope")}</span>
        <code title={scopeLabel}>{scopeLabel}</code>
        {aiOn && policy?.readonly && <span className="badge">{t("ai.readonly")}</span>}
      </div>

      <div className="ai-transcript" ref={scrollerRef}>
        {entries.length === 0 && (
          <div className="empty-state">
            {t("ai.empty", { n: policy?.confirmThreshold ?? 10 })}
          </div>
        )}
        {entries.map((e, i) => (
          <EntryView key={i} entry={e} onApprove={approve} onReject={reject} />
        ))}
      </div>

      <footer className="ai-compose">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder={
            aiOn ? t("ai.placeholderOn") : t("ai.placeholderOff")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!aiOn || running}
          rows={3}
        />
        <div className="ai-compose-actions">
          {running ? (
            <button className="danger" onClick={abort}>
              {t("ai.stop")}
            </button>
          ) : (
            <button className="primary" onClick={send} disabled={!aiOn || !prompt.trim()}>
              {t("ai.send")}
            </button>
          )}
        </div>
      </footer>

      {settingsOpen && (
        <AiSettings
          onClose={() => {
            setSettingsOpen(false);
            reload();
          }}
        />
      )}
    </aside>
  );
}

function EntryView({
  entry,
  onApprove,
  onReject,
}: {
  entry: Entry;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (entry.kind === "user") {
    return (
      <div className="ai-msg user">
        <div className="bubble">{entry.text}</div>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="ai-msg assistant">
        <div className="bubble">{entry.text}</div>
      </div>
    );
  }
  if (entry.kind === "system") {
    return <div className="ai-msg system">{entry.text}</div>;
  }
  // tool
  const c = entry.call;
  return (
    <div className={`ai-tool status-${c.status}`}>
      <div className="head">
        <span className="dot" />
        <code className="name">{c.name}</code>
        <span className="status">{c.status}</span>
      </div>
      <div className="body">{c.summary}</div>
      {c.detail && (
        <pre className="detail">
          {c.detail.length > 400 ? c.detail.slice(0, 400) + "…" : c.detail}
        </pre>
      )}
      {c.awaitingApproval && (
        <div className="approval">
          <button className="primary" onClick={() => onApprove(c.id)}>
            {t("common.apply")}
          </button>
          <button onClick={() => onReject(c.id)}>{t("common.reject")}</button>
        </div>
      )}
    </div>
  );
}
