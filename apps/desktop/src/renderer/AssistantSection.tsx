import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { AiKeyStatus, RedactionReport, SendPayload } from '../shared/ipc/contracts.js';

/**
 * The AI assistant Q&A panel (E-12 T-12.5 / E-13 T-13.6): the user-facing thin slice. Ask about
 * the live debug context, review the exact redacted bytes at the E-12 consent gate, then send;
 * the grounded answer streams in. AI is optional: without a stored BYOK key the panel degrades to
 * an "add a key" state, and if the OS keychain is unavailable it says so instead of pretending AI
 * can be enabled.
 */
export function AssistantSection(): ReactElement {
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const refreshKey = useCallback(async () => setKeyStatus(await window.icarus.aiKeyStatus()), []);
  useEffect(() => void refreshKey(), [refreshKey]);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Ask the assistant (E-13 · grounded, BYOK Claude)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Ask about the captured logs and network. You review the exact redacted text before it's sent
        to Claude with your own API key — nothing leaves your machine until you approve it, and
        secrets are always stripped at the boundary.
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

/**
 * The key-present state: type a question, **review** the exact redacted bytes, then explicitly
 * send them. The review → send gate is the E-12 consent surface (T-12.5) — nothing is sent until
 * the user sees what would be sent and approves it. Editing the question or toggles invalidates a
 * standing review, so the user can never send bytes they didn't just look at.
 */
function AskPanel({ onKeyCleared }: { onKeyCleared: () => void }): ReactElement {
  const [question, setQuestion] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [review, setReview] = useState<SendPayload | null>(null); // reviewed, awaiting Send/Cancel
  const [reviewing, setReviewing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState<SendPayload | null>(null); // what was actually sent, post-send
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

  // Any edit to the inputs invalidates a standing review — you can only send what you just saw.
  const invalidateReview = useCallback(() => setReview(null), []);
  const editQuestion = useCallback((v: string) => {
    setQuestion(v);
    setReview(null);
  }, []);
  const toggle = useCallback((set: (fn: (v: boolean) => boolean) => void) => {
    set((v) => !v);
    setReview(null);
  }, []);

  const doReview = useCallback(async () => {
    if (!question.trim()) return;
    setReviewing(true);
    setError(null);
    setAnswer('');
    setSent(null);
    try {
      setReview(
        await window.icarus.aiReview({ question: question.trim(), includeLogs, includeNetwork }),
      );
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), noKey: false });
    } finally {
      setReviewing(false);
    }
  }, [question, includeLogs, includeNetwork]);

  const doSend = useCallback(async () => {
    setAsking(true);
    setAnswer('');
    setError(null);
    try {
      const payload = await window.icarus.aiSend();
      setSent(payload); // exactly what was reviewed and sent — the grounding surface
      setReview(null); // consumed; close the gate and show the streaming answer
    } catch {
      // Surfaced via the onAiError event (with the noKey flag); nothing to do here.
    }
  }, []);

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
          onChange={(e) => editQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !reviewing && !asking && void doReview()}
          placeholder="e.g. why did the login request fail?"
          disabled={asking}
          style={{ ...inputStyle, minWidth: 320 }}
        />
        <button
          type="button"
          onClick={() => void doReview()}
          disabled={reviewing || asking || !question.trim()}
          style={btn}
        >
          {reviewing ? 'Reviewing…' : 'Review what gets sent'}
        </button>
        <ToggleChip label="logs" active={includeLogs} onToggle={() => toggle(setIncludeLogs)} />
        <ToggleChip
          label="network"
          active={includeNetwork}
          onToggle={() => toggle(setIncludeNetwork)}
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

      {review && !asking && (
        <ReviewGate payload={review} onSend={() => void doSend()} onCancel={invalidateReview} />
      )}

      {(asking || answer) && (
        <div ref={answerRef} style={answerBox}>
          {answer || <span style={{ color: '#8c959f' }}>…</span>}
        </div>
      )}

      {sent && !review && <SentSummary payload={sent} />}
    </div>
  );
}

/**
 * The consent gate (E-12 T-12.5): shows the exact redacted bytes that would be sent, always-on
 * redaction clearly indicated, and a mandatory Send / Cancel. Redaction is not disableable — the
 * user narrows scope with the category toggles, never by turning scrubbing off.
 */
function ReviewGate({
  payload,
  onSend,
  onCancel,
}: {
  payload: SendPayload;
  onSend: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <div style={gateBox}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Review before sending to Claude</strong>
        <span style={{ fontSize: 12, color: '#57606a' }}>
          ~{payload.approxTokens} tokens · {redactionLabel(payload.report)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" onClick={onSend} style={sendBtn}>
            Send to Claude
          </button>
          <button type="button" onClick={onCancel} style={btn}>
            Cancel
          </button>
        </span>
      </div>
      <p style={{ margin: '0 0 6px', fontSize: 11.5, color: '#9a6700' }}>
        Secrets are always stripped at the boundary — this is the exact text that will be sent:
      </p>
      <pre style={gatePre}>{payload.text}</pre>
    </div>
  );
}

/** The "what was sent" surface after an answer (T-12.5 / T-13.6): summary + exact bytes, collapsed. */
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

const gateBox = {
  marginTop: 12,
  border: '1px solid #d0a215',
  borderRadius: 6,
  padding: 12,
  background: '#fffbe6',
} as const;

const gatePre = {
  margin: 0,
  maxHeight: 220,
  overflow: 'auto',
  background: '#fff',
  border: '1px solid #eaeef2',
  borderRadius: 6,
  padding: 8,
  fontSize: 11.5,
  whiteSpace: 'pre-wrap',
} as const;

const sendBtn = {
  padding: '8px 16px',
  fontSize: 14,
  cursor: 'pointer',
  fontWeight: 600,
  background: '#1a7f37',
  color: '#fff',
  border: '1px solid #1a7f37',
  borderRadius: 6,
} as const;
