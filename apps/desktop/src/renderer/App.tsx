import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { DoctorCheckOutput } from '../shared/ipc/contracts.js';
import type {
  CdpConnectionStatus,
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpNetworkSupport,
} from '../shared/ipc/contracts.js';

const STATUS_COLOR: Record<string, string> = {
  ok: '#1a7f37',
  warn: '#9a6700',
  error: '#cf222e',
  connected: '#1a7f37',
  connecting: '#9a6700',
  reconnecting: '#9a6700',
  disconnected: '#57606a',
};

const LEVEL_COLOR: Record<string, string> = {
  error: '#cf222e',
  warning: '#9a6700',
  warn: '#9a6700',
  info: '#0969da',
};

const MAX_LOGS = 500;
const MAX_NETWORK = 200;

interface LogRow extends CdpLogEvent {
  readonly key: number;
}

interface NetworkRow extends CdpNetworkEventOut {
  readonly key: number;
}

export function App(): ReactElement {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 820 }}>
      <h1 style={{ marginBottom: 4 }}>Icarus — RNStudio</h1>
      <p style={{ color: '#57606a', marginTop: 0 }}>Walking skeleton</p>
      <DoctorSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <LiveLogsSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <NetworkSection />
    </main>
  );
}

function DoctorSection(): ReactElement {
  const [report, setReport] = useState<DoctorCheckOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDoctor = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await window.icarus.doctorCheck());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Environment doctor</h2>
      <button type="button" onClick={() => void runDoctor()} disabled={loading} style={btnStyle}>
        {loading ? 'Checking…' : 'Run environment doctor'}
      </button>
      {error && <p style={{ color: STATUS_COLOR.error }}>Error: {error}</p>}
      {report && (
        <div style={{ marginTop: 12 }}>
          <p>
            Overall:{' '}
            <strong style={{ color: STATUS_COLOR[report.overall] ?? '#000' }}>
              {report.overall.toUpperCase()}
            </strong>{' '}
            <span style={{ color: '#57606a' }}>({report.platform})</span>
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {report.checks.map((c) => (
              <li key={c.id} style={{ padding: '4px 0' }}>
                <strong>{c.label}</strong> — {c.status}
                {c.version ? ` (${c.version})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LiveLogsSection(): ReactElement {
  const [status, setStatus] = useState<CdpConnectionStatus>('disconnected');
  const [detail, setDetail] = useState<string>('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const keyRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offLog = window.icarus.onCdpLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, { ...entry, key: keyRef.current++ }];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    });
    const offStatus = window.icarus.onCdpStatus((s) => {
      setStatus(s.status);
      setDetail(s.detail ?? '');
    });
    return () => {
      offLog();
      offStatus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [logs]);

  const connected = status === 'connected';
  const busy = status === 'connecting' || status === 'reconnecting';

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Live logs from a running React Native app</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => void window.icarus.cdpConnect()}
          disabled={connected || busy}
          style={btnStyle}
        >
          {status === 'connecting'
            ? 'Connecting…'
            : status === 'reconnecting'
              ? 'Reconnecting…'
              : 'Connect'}
        </button>
        <button
          type="button"
          onClick={() => void window.icarus.cdpDisconnect()}
          disabled={status === 'disconnected'}
          style={btnStyle}
        >
          Disconnect
        </button>
        <span style={{ color: STATUS_COLOR[status] ?? '#57606a', fontWeight: 600 }}>{status}</span>
        {detail && <span style={{ color: '#57606a', fontSize: 13 }}>— {detail}</span>}
      </div>

      <div
        ref={listRef}
        style={{
          marginTop: 12,
          height: 320,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          background: '#f6f8fa',
        }}
      >
        {logs.length === 0 ? (
          <p style={{ color: '#8c959f', margin: 8 }}>
            No logs yet. Start a React Native app (Metro running), then click Connect.
          </p>
        ) : (
          logs.map((log) => (
            <div key={log.key} style={{ padding: '2px 0', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: LEVEL_COLOR[log.level] ?? '#57606a' }}>[{log.level}]</span>{' '}
              {log.text}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function NetworkSection(): ReactElement {
  const [support, setSupport] = useState<CdpNetworkSupport | undefined>(undefined);
  const [status, setStatus] = useState<CdpConnectionStatus>('disconnected');
  const [events, setEvents] = useState<NetworkRow[]>([]);
  const keyRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offNet = window.icarus.onCdpNetwork((entry) => {
      setEvents((prev) => {
        const next = [...prev, { ...entry, key: keyRef.current++ }];
        return next.length > MAX_NETWORK ? next.slice(next.length - MAX_NETWORK) : next;
      });
    });
    const offStatus = window.icarus.onCdpStatus((s) => {
      setStatus(s.status);
      // Reset captured events on every fresh connect — the old request IDs are gone.
      if (s.status === 'connected') {
        setSupport(s.networkSupport);
        setEvents([]);
      } else if (s.status === 'disconnected') {
        setSupport(undefined);
      } else if (s.networkSupport) {
        setSupport(s.networkSupport);
      }
    });
    return () => {
      offNet();
      offStatus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [events]);

  const supportLabel: string =
    support === undefined
      ? status === 'connected'
        ? 'checking…'
        : '—'
      : support === 'available'
        ? 'available'
        : 'unavailable on this RN version';

  const supportColor = support === 'available' ? STATUS_COLOR.connected : STATUS_COLOR.warn;

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Network requests (CDP, RN ≥ 0.76)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Network: <span style={{ color: supportColor, fontWeight: 600 }}>{supportLabel}</span>
      </p>

      <div
        ref={listRef}
        style={{
          height: 240,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          background: '#f6f8fa',
        }}
      >
        {events.length === 0 ? (
          <p style={{ color: '#8c959f', margin: 8 }}>
            {support === 'unavailable'
              ? 'Network capture requires React Native 0.76 or newer.'
              : status === 'connected'
                ? 'No network requests captured yet. The app needs to make a request.'
                : 'Connect first.'}
          </p>
        ) : (
          events.map((e) => <NetworkRowView key={e.key} event={e} />)
        )}
      </div>
    </section>
  );
}

function NetworkRowView({ event }: { event: CdpNetworkEventOut }): ReactElement {
  if (event.kind === 'request') {
    return (
      <div style={{ padding: '2px 0' }}>
        <span style={{ color: '#0969da' }}>→ {event.method ?? '?'}</span>{' '}
        <span>{event.url ?? '(no url)'}</span>
      </div>
    );
  }
  if (event.kind === 'response') {
    const statusColor = (event.status ?? 0) >= 400 ? STATUS_COLOR.error : STATUS_COLOR.ok;
    return (
      <div style={{ padding: '2px 0' }}>
        <span style={{ color: statusColor }}>← {event.status ?? '?'}</span>{' '}
        <span>
          {event.method ?? '?'} {event.url ?? '(no url)'}
        </span>
        {event.contentType && <span style={{ color: '#57606a' }}> — {event.contentType}</span>}
      </div>
    );
  }
  return (
    <div style={{ padding: '2px 0' }}>
      <span style={{ color: STATUS_COLOR.error }}>✗ failed</span>{' '}
      <span style={{ color: '#57606a' }}>{event.errorText ?? 'unknown error'}</span>
    </div>
  );
}

const btnStyle = { padding: '8px 16px', fontSize: 14, cursor: 'pointer' } as const;
