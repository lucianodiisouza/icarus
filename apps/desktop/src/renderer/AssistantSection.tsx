import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { AiKeyStatus, RedactionReport, SendPayload } from '../shared/ipc/contracts.js';

/**
 * The AI assistant Q&A panel (E-13, T-13.6): the user-facing thin slice. Ask a question about the
 * live debug context; the answer streams in. Every ask goes through the E-12 boundary, so the
 * panel always shows "what was sent" (the redacted payload) inline — the grounding + privacy
 * surface. AI is optional: without a stored BYOK key the panel degrades to an "add a key" state,
 * and if the OS keychain is unavailable it says so instead of pretending AI can be enabled.
 */
export function AssistantSection(): ReactElement {
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const refreshKey = useCallback(async () => setKeyStatus(await window.icarus.aiKeyStatus()), []);
  useEffect(() => void refreshKey(), [refreshKey]);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Ask the assistant (E-13 · grounded, BYOK Claude)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Ask about the captured logs and network. The question and a redacted slice of that context
        are sent to Claude with your own API key — nothing leaves your machine without the key, and
        secrets are stripped at the boundary. You can see exactly what was sent below each answer.
      </p>
      {keyStatus === null ? (
        <p style={{ color: '#8c959f', fontSize: 13 }}>Checking key…</p>
      ) : keyStatus.hasKey ? (
        <AskPanel onKeyCleared={() => void refreshKey()} />
      ) : (
        <KeySetup status={keyStatus} onKeySaved={() => void refreshKey()} />
      )}
    </section>
  );
}

/** The no-key state: capture a BYOK key, or explain why AI can't be enabled on this machine. */
function KeySetup({
  status,
  onKeySaved,
}: {
  status: AiKeyStatus;
  onKeySaved: () => void;
}): ReactElement {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.icarus.aiKeySet({ key: key.trim() });
      setKey('');
      onKeySaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [key, onKeySaved]);

  if (!status.secureStorageAvailable) {
    return (
      <p style={{ color: '#9a6700', fontSize: 13 }}>
        Secure key storage isn't available on this system, so the assistant can't be enabled here.
        The key is only ever stored OS-encrypted, never in plaintext — without the OS keychain
        there's no safe place to keep it.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Anthropic API key (sk-ant-…)"
        style={{ ...inputStyle, minWidth: 280 }}
      />
      <button type="button" onClick={() => void save()} disabled={busy || !key.trim()} style={btn}>
        {busy ? 'Saving…' : 'Save key'}
      </button>
      {error && <span style={{ color: '#cf222e', fontSize: 12 }}>{error}</span>}
    </div>
  );
}

interface AskError {
  readonly message: string;
  readonly noKey: boolean;
}

/** The key-present state: ask a question, stream the answer, and show what was sent. */
function AskPanel({ onKeyCleared }: { onKeyCleared: () => void }): ReactElement {
  const [question, setQuestion] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState<SendPayload | null>(null);
  const [error, setError] = useState<AskError | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offChunk = window.icarus.onAiChunk((c) => setAnswer((prev) => prev + c.text));
    const offDone = window.icarus.onAiDone(() => setAsking(false));
    const offError = window.icarus.onAiError((e) => {
      setError(e);
      setAsking(false);
      if (e.noKey) onKeyCleared(); // key vanished mid-session — fall back to the setup state
    });
    return () => {
      offChunk();
      offDone();
      offError();
    };
  }, [onKeyCleared]);

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight });
  }, [answer]);

  const ask = useCallback(async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer('');
    setError(null);
    setSent(null);
    try {
      const payload = await window.icarus.aiAsk({
        question: question.trim(),
        includeLogs,
        includeNetwork,
      });
      setSent(payload); // the exact redacted bytes that were sent — the grounding surface
    } catch {
      // The failure is surfaced via the onAiError event (with the noKey flag); nothing to do here.
    }
  }, [question, includeLogs, includeNetwork]);

  const clearKey = useCallback(async () => {
    await window.icarus.aiKeyClear();
    onKeyCleared();
  }, [onKeyCleared]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !asking && void ask()}
          placeholder="e.g. why did the login request fail?"
          disabled={asking}
          style={{ ...inputStyle, minWidth: 320 }}
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={asking || !question.trim()}
          style={btn}
        >
          {asking ? 'Asking…' : 'Ask'}
        </button>
        <ToggleChip label="logs" active={includeLogs} onToggle={() => setIncludeLogs((v) => !v)} />
        <ToggleChip
          label="network"
          active={includeNetwork}
          onToggle={() => setIncludeNetwork((v) => !v)}
        />
        <button
          type="button"
          onClick={() => void clearKey()}
          style={linkBtn}
          title="Remove the stored API key"
        >
          Clear key
        </button>
      </div>

      {error && (
        <p style={{ color: '#cf222e', fontSize: 13, marginTop: 12 }}>
          {error.noKey ? 'No API key is set — add one to enable the assistant.' : error.message}
        </p>
      )}

      {(asking || answer) && (
        <div ref={answerRef} style={answerBox}>
          {answer || <span style={{ color: '#8c959f' }}>…</span>}
        </div>
      )}

      {sent && <SentSummary payload={sent} />}
    </div>
  );
}

/** The "what was sent" surface (T-12.5 / T-13.6): redaction summary + the exact bytes, collapsed. */
function SentSummary({ payload }: { payload: SendPayload }): ReactElement {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#57606a' }}>
        Grounded on captured context · ~{payload.approxTokens} tokens ·{' '}
        {redactionLabel(payload.report)}
      </summary>
      <pre
        style={{
          marginTop: 8,
          maxHeight: 200,
          overflow: 'auto',
          background: '#f6f8fa',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 8,
          fontSize: 11.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        {payload.text}
      </pre>
    </details>
  );
}

function redactionLabel(report: RedactionReport): string {
  if (report.total === 0) return 'nothing redacted';
  const parts = Object.entries(report.byCategory).map(([cat, n]) => `${cat} ×${n}`);
  return `redacted ${parts.join(', ')}`;
}

function ToggleChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${active ? '#0969da' : '#d0d7de'}`,
        borderRadius: 12,
        background: active ? '#0969da' : 'transparent',
        color: active ? '#fff' : '#57606a',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const inputStyle = {
  flex: 1,
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1px solid #d0d7de',
  borderRadius: 6,
} as const;

const btn = { padding: '8px 16px', fontSize: 14, cursor: 'pointer' } as const;

const linkBtn = {
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  color: '#57606a',
  textDecoration: 'underline',
  marginLeft: 'auto',
} as const;

const answerBox = {
  marginTop: 12,
  maxHeight: 300,
  overflowY: 'auto',
  border: '1px solid #eaeef2',
  borderRadius: 6,
  padding: 12,
  fontSize: 13.5,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  background: '#fff',
} as const;
