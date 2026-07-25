import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { DoctorCheckOutput } from '../shared/ipc/contracts.js';
import type {
  CdpConnectionStatus,
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpNetworkSupport,
  MetroLogEventOut,
  MetroStatus,
  MetroStatusEvent,
  ProjectKind,
  SimDevice,
  UnifiedLogEntryOut,
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
  debug: '#8c959f',
  log: '#24292f',
};

const MAX_LOGS = 500;
const MAX_NETWORK = 200;
const MAX_METRO = 200;

interface LogRow extends CdpLogEvent {
  readonly key: number;
}

interface NetworkRow extends CdpNetworkEventOut {
  readonly key: number;
}

interface MetroLogRow extends MetroLogEventOut {
  readonly key: number;
}

const METRO_STATUS_COLOR: Record<MetroStatus, string> = {
  idle: '#57606a',
  starting: '#9a6700',
  ready: '#1a7f37',
  stopping: '#9a6700',
  exited: '#57606a',
  errored: '#cf222e',
  'unsupported-project': '#cf222e',
};

export function App(): ReactElement {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 820 }}>
      <h1 style={{ marginBottom: 4 }}>Icarus — RNStudio</h1>
      <p style={{ color: '#57606a', marginTop: 0 }}>Walking skeleton</p>
      <DoctorSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <MetroSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <DevicesSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <UnifiedLogSection />
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

function DevicesSection(): ReactElement {
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // udid in flight, or null
  const [error, setError] = useState<string | null>(null);
  const [appPath, setAppPath] = useState<string>('');
  const [bundleId, setBundleId] = useState<string>('');

  const refresh = useCallback(async () => {
    setBusy('__list');
    setError(null);
    try {
      setDevices(await window.icarus.devicesList());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const onBoot = useCallback(async (udid: string) => {
    setBusy(udid);
    setError(null);
    try {
      await window.icarus.devicesBoot({ udid });
      setDevices(await window.icarus.devicesList());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const onInstallAndLaunch = useCallback(
    async (udid: string) => {
      if (!appPath.trim() || !bundleId.trim()) return;
      setBusy(udid);
      setError(null);
      try {
        await window.icarus.devicesInstall({ udid, appPath: appPath.trim() });
        const { pid } = await window.icarus.devicesLaunch({ udid, bundleId: bundleId.trim() });
        setError(`Launched as PID ${pid}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [appPath, bundleId],
  );

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>iOS simulators (E-09, iOS only for v1)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Pick a booted simulator and (optionally) install + launch your app on it.
      </p>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={appPath}
          onChange={(e) => setAppPath(e.target.value)}
          placeholder="/path/to/YourApp.app"
          style={inputStyle}
        />
        <input
          type="text"
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
          placeholder="com.example.bundleId"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy !== null}
          style={btnStyle}
        >
          {busy === '__list' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <p style={{ color: STATUS_COLOR.error, fontSize: 12 }}>{error}</p>}

      {devices.length === 0 ? (
        <p style={{ color: '#8c959f', fontSize: 13 }}>
          No simulators. Click <strong>Refresh</strong> to scan.
        </p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid #eaeef2', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Name</th>
              <th style={{ padding: 6 }}>State</th>
              <th style={{ padding: 6 }}>UDID</th>
              <th style={{ padding: 6 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.udid} style={{ borderBottom: '1px solid #f0f3f6' }}>
                <td style={{ padding: 6 }}>{d.name}</td>
                <td
                  style={{
                    padding: 6,
                    color: d.state === 'Booted' ? STATUS_COLOR.connected : '#57606a',
                  }}
                >
                  {d.state}
                </td>
                <td style={{ padding: 6, color: '#8c959f', fontSize: 11 }}>{d.udid}</td>
                <td style={{ padding: 6 }}>
                  {d.state === 'Booted' ? (
                    <button
                      type="button"
                      onClick={() => void onInstallAndLaunch(d.udid)}
                      disabled={busy !== null || !appPath.trim() || !bundleId.trim()}
                      style={btnStyle}
                    >
                      {busy === d.udid ? 'Working…' : 'Install + Launch'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onBoot(d.udid)}
                      disabled={busy !== null}
                      style={btnStyle}
                    >
                      {busy === d.udid ? 'Booting…' : 'Boot'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const inputStyle = {
  flex: 1,
  minWidth: 200,
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1px solid #d0d7de',
  borderRadius: 6,
} as const;

function UnifiedLogSection(): ReactElement {
  const [entries, setEntries] = useState<(UnifiedLogEntryOut & { key: number })[]>([]);
  const [filter, setFilter] = useState<Array<'cdp' | 'native' | 'metro'>>([
    'cdp',
    'native',
    'metro',
  ]);
  const keyRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = window.icarus.onUnifiedLog((entry) => {
      setEntries((prev) => {
        const next = [...prev, { ...entry, key: keyRef.current++ }];
        return next.length > 800 ? next.slice(next.length - 800) : next;
      });
    });
    return off;
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  const visible = entries.filter((e) => filter.includes(e.source));

  const toggle = (s: 'cdp' | 'native' | 'metro'): void => {
    setFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Unified app log (E-10)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        One stream for app console (CDP), Metro dev-server output, and native simulator logs.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {(['cdp', 'native', 'metro'] as const).map((s) => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={filter.includes(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
        <span style={{ color: '#8c959f', fontSize: 12, marginLeft: 'auto' }}>
          {visible.length} / {entries.length}
        </span>
      </div>
      <div
        ref={listRef}
        style={{
          height: 240,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          background: '#f6f8fa',
        }}
      >
        {visible.length === 0 ? (
          <p style={{ color: '#8c959f', margin: 8 }}>
            No entries yet. Connect to a running app (CDP) or start Metro to see logs here.
          </p>
        ) : (
          visible.map((e) => <UnifiedRow key={e.key} entry={e} />)
        )}
      </div>
    </section>
  );
}

const SOURCE_COLOR: Record<string, string> = {
  cdp: '#0969da',
  native: '#bf3989',
  metro: '#9a6700',
};

function UnifiedRow({ entry }: { entry: UnifiedLogEntryOut }): ReactElement {
  return (
    <div style={{ padding: '1px 0', whiteSpace: 'pre-wrap' }}>
      <span style={{ color: SOURCE_COLOR[entry.source] ?? '#57606a', fontWeight: 600 }}>
        [{entry.source}]
      </span>{' '}
      <span style={{ color: LEVEL_COLOR[entry.level] ?? '#24292f' }}>[{entry.level}]</span>{' '}
      {entry.text}
    </div>
  );
}

function MetroSection(): ReactElement {
  const [status, setStatus] = useState<MetroStatus>('idle');
  const [port, setPort] = useState<number | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectKind, setProjectKind] = useState<ProjectKind>('unknown');
  const [cwd, setCwd] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<MetroLogRow[]>([]);
  const keyRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offLog = window.icarus.onMetroLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, { ...entry, key: keyRef.current++ }];
        return next.length > MAX_METRO ? next.slice(next.length - MAX_METRO) : next;
      });
    });
    const offStatus = window.icarus.onMetroStatus((s: MetroStatusEvent) => {
      setStatus(s.status);
      setPort(s.port);
      setProjectName(s.projectName);
      setProjectKind(s.projectKind);
    });
    return () => {
      offLog();
      offStatus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [logs]);

  const onStart = useCallback(async () => {
    if (!cwd.trim()) return;
    setBusy(true);
    setError(null);
    setLogs([]);
    try {
      await window.icarus.metroStart({ cwd: cwd.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [cwd]);

  const onStop = useCallback(async () => {
    setBusy(true);
    try {
      await window.icarus.metroStop();
    } finally {
      setBusy(false);
    }
  }, []);

  const statusColor = METRO_STATUS_COLOR[status];
  const ready = status === 'ready';
  const busyRunning = busy || status === 'starting' || status === 'stopping';

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Metro dev server</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        {projectName ? (
          <>
            <strong>{projectName}</strong> <span style={{ color: '#8c959f' }}>({projectKind})</span>
          </>
        ) : (
          'Detect a React Native / Expo project and start its dev server.'
        )}
        {' · '}
        <span style={{ color: statusColor, fontWeight: 600 }}>{status}</span>
        {port !== null && <> on :{port}</>}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/path/to/your/react-native-or-expo-project"
          disabled={ready || busyRunning}
          style={{
            flex: 1,
            padding: '6px 10px',
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            border: '1px solid #d0d7de',
            borderRadius: 6,
          }}
        />
        <button
          type="button"
          onClick={() => void onStart()}
          disabled={ready || busyRunning || !cwd.trim()}
          style={btnStyle}
        >
          {status === 'starting' ? 'Starting…' : 'Start Metro'}
        </button>
        <button
          type="button"
          onClick={() => void onStop()}
          disabled={status === 'idle' || status === 'exited' || busyRunning}
          style={btnStyle}
        >
          {status === 'stopping' ? 'Stopping…' : 'Stop'}
        </button>
      </div>
      {error && <p style={{ color: STATUS_COLOR.error }}>Error: {error}</p>}

      <div
        ref={listRef}
        style={{
          height: 200,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          background: '#0d1117',
          color: '#c9d1d9',
        }}
      >
        {logs.length === 0 ? (
          <p style={{ color: '#8b949e', margin: 8 }}>Metro output will appear here.</p>
        ) : (
          logs.map((l) => (
            <div
              key={l.key}
              style={{
                padding: '1px 0',
                color: l.stream === 'stderr' ? '#ffa198' : '#79c0ff',
                whiteSpace: 'pre-wrap',
              }}
            >
              {l.text}
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
