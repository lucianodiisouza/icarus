import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { AssistantSection } from './AssistantSection.js';
import type { DoctorCheckOutput } from '../shared/ipc/contracts.js';
import type {
  CdpConnectionStatus,
  CdpLogEvent,
  CdpNetworkSupport,
  MetroLogEventOut,
  MetroStatus,
  MetroStatusEvent,
  ProjectKind,
  SimDevice,
  UnifiedLogEntryOut,
  NetworkRecord,
  NetworkBodyResult,
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

const VIRT_ITEM_HEIGHT = 18; // px per row in the virtualized log list
const VIRT_OVERSCAN = 8; // extra rows above/below the visible window

const MAX_LOGS = 500;
const MAX_METRO = 200;

interface LogRow extends CdpLogEvent {
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
      <AutoAttachToggle />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <MetroSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <DevicesSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <UnifiedLogSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <AssistantSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <LiveLogsSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <NetworkSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <ComponentTreeSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <StorageSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <PerfSection />
      <hr style={{ margin: '28px 0', border: 0, borderTop: '1px solid #eaeef2' }} />
      <NavSection />
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
  const [textQuery, setTextQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<Set<UnifiedLogEntryOut['source']>>(
    new Set(['cdp', 'native', 'metro']),
  );
  const [levelFilter, setLevelFilter] = useState<Set<UnifiedLogEntryOut['level']>>(
    new Set(['log', 'info', 'warn', 'error', 'debug']),
  );
  const [exportState, setExportState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'done'; path: string; count: number; redacted: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const keyRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(280);

  useEffect(() => {
    // E-03s subscription: apply the initial snapshot, then batched append-deltas.
    // One React update per BATCH (not per entry) is what keeps the UI responsive
    // under a high-rate log stream (TR-6).
    let cancelled = false;
    const append = (
      prev: (UnifiedLogEntryOut & { key: number })[],
      entries: readonly UnifiedLogEntryOut[],
    ): (UnifiedLogEntryOut & { key: number })[] => {
      const next = [...prev];
      for (const entry of entries) next.push({ ...entry, key: keyRef.current++ });
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    };
    const offDelta = window.icarus.onUnifiedLogDelta((delta) => {
      setEntries((prev) => append(prev, delta.appended));
    });
    void window.icarus.unifiedLogSubscribe().then((snapshot) => {
      if (cancelled) return;
      setEntries(snapshot.map((entry) => ({ ...entry, key: keyRef.current++ })));
    });
    return () => {
      cancelled = true;
      offDelta();
      void window.icarus.unifiedLogUnsubscribe();
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const visible = filterUnifiedLog(entries, textQuery, sourceFilter, levelFilter);

  // E-15: opt-in export of the currently-visible log entries. The renderer is the source of
  // truth for what to export (its filter chips + search query ARE the user's intent); the main
  // process writes the file with the same redaction rules the E-12 AI boundary uses, so a
  // planted secret in any entry is scrubbed before the file is written.
  const onExport = useCallback(async () => {
    setExportState({ kind: 'busy' });
    try {
      const out = await window.icarus.logExport({ entries: visible.map(stripKey) });
      setExportState({
        kind: 'done',
        path: out.path,
        count: out.count,
        redacted: out.report.total,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The main process signals a user-canceled dialog with `ExportCancelledError`; that's a
      // clean no-op for the user, not an error — show nothing rather than a red toast.
      if (message.includes('Export cancelled')) {
        setExportState({ kind: 'idle' });
      } else {
        setExportState({ kind: 'error', message });
      }
    }
  }, [visible]);

  // Auto-scroll to bottom when new entries arrive, unless the user has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < VIRT_ITEM_HEIGHT * 3) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visible.length]);

  // Virtualization: only render the rows in the visible window (+ overscan). The
  // total scroll height is preserved by top + bottom spacers.
  const total = visible.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / VIRT_ITEM_HEIGHT) - VIRT_OVERSCAN);
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + containerHeight) / VIRT_ITEM_HEIGHT) + VIRT_OVERSCAN,
  );
  const windowEntries = visible.slice(startIdx, endIdx);
  const topPad = startIdx * VIRT_ITEM_HEIGHT;
  const bottomPad = Math.max(0, (total - endIdx) * VIRT_ITEM_HEIGHT);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Unified app log (E-10 · virtualized in E-11)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Search + filter the live stream of app console, Metro output, and simulator logs.
      </p>
      <div
        style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          type="text"
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          placeholder="search…"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #d0d7de',
            borderRadius: 4,
            minWidth: 160,
          }}
        />
        {(['cdp', 'native', 'metro'] as const).map((s) => (
          <FilterChip
            key={s}
            label={s}
            active={sourceFilter.has(s)}
            onToggle={() => toggleSource(sourceFilter, setSourceFilter, s)}
          />
        ))}
        <span style={{ borderLeft: '1px solid #d0d7de', paddingLeft: 8, display: 'flex', gap: 4 }}>
          {(['error', 'warn', 'info', 'debug', 'log'] as const).map((l) => {
            const color = LEVEL_COLOR[l];
            return (
              <FilterChip
                key={l}
                label={l}
                active={levelFilter.has(l)}
                onToggle={() => toggleLevel(levelFilter, setLevelFilter, l)}
                {...(color !== undefined ? { color } : {})}
              />
            );
          })}
        </span>
        <span style={{ color: '#8c959f', fontSize: 12, marginLeft: 'auto' }}>
          {visible.length} / {entries.length} (rendering {windowEntries.length})
        </span>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={exportState.kind === 'busy' || visible.length === 0}
          title={
            visible.length === 0
              ? 'Nothing to export — adjust the filters or capture some logs first.'
              : 'Write the visible entries to a file (always redacted, local-only).'
          }
          style={{
            padding: '4px 10px',
            fontSize: 12,
            cursor: exportState.kind === 'busy' ? 'wait' : 'pointer',
            border: '1px solid #d0d7de',
            borderRadius: 4,
            background: exportState.kind === 'busy' ? '#f6f8fa' : '#fff',
          }}
        >
          {exportState.kind === 'busy' ? 'Exporting…' : `Export ${visible.length} entries`}
        </button>
      </div>
      <div
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          height: 280,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 0,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          background: '#f6f8fa',
        }}
      >
        {total === 0 ? (
          <p style={{ color: '#8c959f', margin: 8 }}>
            No entries match. Start Metro, connect CDP, or boot a sim.
          </p>
        ) : (
          <>
            <div style={{ height: topPad }} />
            {windowEntries.map((e) => (
              <UnifiedRow key={e.key} entry={e} />
            ))}
            <div style={{ height: bottomPad }} />
          </>
        )}
      </div>
      {exportState.kind === 'done' && (
        <p
          style={{
            marginTop: 6,
            fontSize: 12,
            color: '#1a7f37',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>✓ Exported {exportState.count} entries to</span>
          <code style={{ background: '#f6f8fa', padding: '1px 6px', borderRadius: 3 }}>
            {exportState.path}
          </code>
          {exportState.redacted > 0 && (
            <span style={{ color: '#9a6700' }}>
              · {exportState.redacted} redaction{exportState.redacted === 1 ? '' : 's'} applied
            </span>
          )}
        </p>
      )}
      {exportState.kind === 'error' && (
        <p style={{ marginTop: 6, fontSize: 12, color: STATUS_COLOR.error }}>
          Export failed: {exportState.message}
        </p>
      )}
    </section>
  );
}

/** Strip the renderer's `key` (a list-key field) before sending an entry over IPC. */
function stripKey(entry: UnifiedLogEntryOut & { key: number }): UnifiedLogEntryOut {
  const { key: _unused, ...rest } = entry;
  void _unused;
  return rest;
}

function FilterChip({
  label,
  active,
  onToggle,
  color,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  color?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${active ? (color ?? '#0969da') : '#d0d7de'}`,
        borderRadius: 12,
        background: active ? (color ?? '#0969da') : 'transparent',
        color: active ? '#fff' : '#57606a',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function toggleSource(
  current: Set<UnifiedLogEntryOut['source']>,
  set: (s: Set<UnifiedLogEntryOut['source']>) => void,
  s: UnifiedLogEntryOut['source'],
): void {
  const next = new Set(current);
  if (next.has(s)) next.delete(s);
  else next.add(s);
  set(next);
}

function toggleLevel(
  current: Set<UnifiedLogEntryOut['level']>,
  set: (s: Set<UnifiedLogEntryOut['level']>) => void,
  l: UnifiedLogEntryOut['level'],
): void {
  const next = new Set(current);
  if (next.has(l)) next.delete(l);
  else next.add(l);
  set(next);
}

function filterUnifiedLog(
  entries: readonly (UnifiedLogEntryOut & { key: number })[],
  text: string,
  sources: Set<UnifiedLogEntryOut['source']>,
  levels: Set<UnifiedLogEntryOut['level']>,
): (UnifiedLogEntryOut & { key: number })[] {
  const q = text.toLowerCase();
  return entries.filter((e) => {
    if (sources.size > 0 && !sources.has(e.source)) return false;
    if (levels.size > 0 && !levels.has(e.level)) return false;
    if (q && !e.text.toLowerCase().includes(q)) return false;
    return true;
  });
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

function AutoAttachToggle(): ReactElement {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [userDisconnected, setUserDisconnected] = useState<boolean>(false);

  useEffect(() => {
    void window.icarus.autoAttachGet().then((s) => {
      setEnabled(s.enabled);
      setUserDisconnected(s.userDisconnected);
    });
  }, []);

  const onToggle = useCallback(async (next: boolean) => {
    setEnabled(next);
    await window.icarus.autoAttachSet({ enabled: next });
    if (next) setUserDisconnected(false);
    // Re-fetch to reflect server-side state.
    const s = await window.icarus.autoAttachGet();
    setEnabled(s.enabled);
    setUserDisconnected(s.userDisconnected);
  }, []);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Auto-attach (TD-16)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        When Metro is ready and a simulator is booted, Icarus auto-connects CDP so the "app running
        + live logs" flow is one click from the user's side.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void onToggle(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>Enable auto-attach</span>
        </label>
        {userDisconnected && enabled && (
          <span style={{ color: STATUS_COLOR.warn, fontSize: 12 }}>
            (paused — you clicked Disconnect. Re-enable above to resume.)
          </span>
        )}
      </div>
    </section>
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
    const offLog = window.icarus.onModuleEvent<MetroLogEventOut>(
      'metro',
      'log',
      ({ payload: entry }) => {
        setLogs((prev) => {
          const next = [...prev, { ...entry, key: keyRef.current++ }];
          return next.length > MAX_METRO ? next.slice(next.length - MAX_METRO) : next;
        });
      },
    );
    const offStatus = window.icarus.onModuleEvent<MetroStatusEvent>(
      'metro',
      'status',
      ({ payload: s }) => {
        setStatus(s.status);
        setPort(s.port);
        setProjectName(s.projectName);
        setProjectKind(s.projectKind);
      },
    );
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
  // E-16: the real network inspector. One row per HTTP call, expandable, with
  // method/status/duration at a glance, headers + opt-in body fetch when expanded.
  // Backed by the `NetworkRecorder` in main (E-16) — one source of truth, the renderer
  // just subscribes.
  const [support, setSupport] = useState<CdpNetworkSupport | undefined>(undefined);
  const [status, setStatus] = useState<CdpConnectionStatus>('disconnected');
  const [records, setRecords] = useState<NetworkRecord[]>([]);
  const [textQuery, setTextQuery] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<Set<string>>(
    new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  );
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(['2xx', '3xx', '4xx', '5xx', 'failed']),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(280);

  useEffect(() => {
    const offStatus = window.icarus.onCdpStatus((s) => {
      setStatus(s.status);
      if (s.status === 'connected') {
        setSupport(s.networkSupport);
        // Fresh connect: the inspector in main resets itself; mirror that.
        setRecords([]);
      } else if (s.status === 'disconnected') {
        setSupport(undefined);
      } else if (s.networkSupport) {
        setSupport(s.networkSupport);
      }
    });
    // Subscribe to per-record pushes (low volume; per-call, not per-event).
    const offRecord = window.icarus.onNetworkRecord((record) => {
      setRecords((prev) => {
        // Update if we already have this id (in-place update), otherwise append.
        const i = prev.findIndex((r) => r.requestId === record.requestId);
        if (i === -1) {
          const next = [...prev, record];
          // Bound the in-renderer copy; main also bounds to 500, so this rarely fires.
          return next.length > 500 ? next.slice(next.length - 500) : next;
        }
        const next = prev.slice();
        next[i] = record;
        return next;
      });
    });
    // Initial snapshot — late joiners see the live model.
    void window.icarus.networkList().then((snapshot) => setRecords([...snapshot]));
    return () => {
      offStatus();
      offRecord();
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const visible = filterNetwork(records, textQuery, methodFilter, statusFilter);

  // Auto-scroll to bottom on new records, unless the user has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < VIRT_ITEM_HEIGHT * 3) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visible.length]);

  // Virtualization (same hand-rolled shape as the unified-log panel; E-11).
  const total = visible.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / VIRT_ITEM_HEIGHT) - VIRT_OVERSCAN);
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + containerHeight) / VIRT_ITEM_HEIGHT) + VIRT_OVERSCAN,
  );
  const windowEntries = visible.slice(startIdx, endIdx);
  const topPad = startIdx * VIRT_ITEM_HEIGHT;
  const bottomPad = Math.max(0, (total - endIdx) * VIRT_ITEM_HEIGHT);

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
      <h2 style={{ fontSize: 16 }}>Network inspector (E-16 · grouped, expandable)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        One row per HTTP call. Click to expand and see headers, timing, and (opt-in) bodies.{' '}
        Network: <span style={{ color: supportColor, fontWeight: 600 }}>{supportLabel}</span>
      </p>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          placeholder="filter by URL substring…"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #d0d7de',
            borderRadius: 4,
            minWidth: 180,
          }}
        />
        {(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).map((m) => (
          <FilterChip
            key={m}
            label={m}
            active={methodFilter.has(m)}
            onToggle={() => toggleInSet(methodFilter, setMethodFilter, m)}
          />
        ))}
        <span style={{ borderLeft: '1px solid #d0d7de', paddingLeft: 8, display: 'flex', gap: 4 }}>
          {(['2xx', '3xx', '4xx', '5xx', 'failed'] as const).map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={statusFilter.has(s)}
              onToggle={() => toggleInSet(statusFilter, setStatusFilter, s)}
              color={
                s === '4xx' || s === '5xx' || s === 'failed'
                  ? '#cf222e'
                  : s === '3xx'
                    ? '#0969da'
                    : '#1a7f37'
              }
            />
          ))}
        </span>
        <span style={{ color: '#8c959f', fontSize: 12, marginLeft: 'auto' }}>
          {visible.length} / {records.length} (rendering {windowEntries.length})
        </span>
        <button
          type="button"
          onClick={() => void window.icarus.networkClear()}
          disabled={records.length === 0}
          title="Wipe the inspector's captured records."
          style={{
            padding: '4px 10px',
            fontSize: 12,
            cursor: records.length === 0 ? 'default' : 'pointer',
            border: '1px solid #d0d7de',
            borderRadius: 4,
            background: '#fff',
          }}
        >
          Clear
        </button>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          height: 320,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 0,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          background: '#f6f8fa',
        }}
      >
        {total === 0 ? (
          <p style={{ color: '#8c959f', margin: 8 }}>
            {support === 'unavailable'
              ? 'Network capture requires React Native 0.76 or newer.'
              : status === 'connected'
                ? 'No network requests captured yet. The app needs to make a request.'
                : 'Connect first.'}
          </p>
        ) : (
          <>
            <div style={{ height: topPad }} />
            {windowEntries.map((r) => (
              <NetworkRecordRow key={r.requestId} record={r} />
            ))}
            <div style={{ height: bottomPad }} />
          </>
        )}
      </div>
    </section>
  );
}

function NetworkRecordRow({ record }: { record: NetworkRecord }): ReactElement {
  // A row is collapsed by default; clicking expands to show headers + opt-in body fetch.
  const [expanded, setExpanded] = useState(false);
  const [bodyState, setBodyState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading'; for: 'request' | 'response' }
    | { kind: 'done'; result: NetworkBodyResult; for: 'request' | 'response' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const statusPill = networkStatusPill(record);
  const dur = durationOf(record);
  const durLabel = dur === null ? '—' : `${dur}ms`;

  const onFetchBody = async (kind: 'request' | 'response'): Promise<void> => {
    setBodyState({ kind: 'loading', for: kind });
    try {
      const result = await window.icarus.networkFetchBody({ requestId: record.requestId, kind });
      setBodyState({ kind: 'done', result, for: kind });
    } catch (e) {
      setBodyState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div style={{ borderBottom: '1px solid #eaeef2' }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span style={{ color: '#8c959f', width: 12 }}>{expanded ? '▾' : '▸'}</span>
        <span
          style={{
            display: 'inline-block',
            padding: '1px 6px',
            background: statusPill.bg,
            color: '#fff',
            borderRadius: 3,
            fontWeight: 600,
            fontSize: 11,
            minWidth: 36,
            textAlign: 'center',
          }}
        >
          {statusPill.label}
        </span>
        <span style={{ color: '#0969da', fontWeight: 600, minWidth: 48 }}>{record.method}</span>
        <span
          style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {record.url}
        </span>
        <span style={{ color: '#8c959f', fontSize: 11, minWidth: 60, textAlign: 'right' }}>
          {durLabel}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 8px 10px 28px', fontSize: 12 }}>
          {record.failure && (
            <p style={{ color: STATUS_COLOR.error, margin: '4px 0' }}>✗ {record.failure}</p>
          )}
          {record.contentType && (
            <p style={{ color: '#57606a', margin: '2px 0' }}>
              <strong>content-type:</strong> {record.contentType}
            </p>
          )}
          {record.encodedDataLength !== undefined && (
            <p style={{ color: '#57606a', margin: '2px 0' }}>
              <strong>size:</strong> {formatBytes(record.encodedDataLength)}
            </p>
          )}
          <HeaderTable title="Request headers" headers={record.requestHeaders} />
          <HeaderTable title="Response headers" headers={record.responseHeaders} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => void onFetchBody('request')}
              disabled={bodyState.kind === 'loading'}
              style={smallBtn}
            >
              {bodyState.kind === 'loading' && bodyState.for === 'request'
                ? 'Loading…'
                : 'Fetch request body'}
            </button>
            <button
              type="button"
              onClick={() => void onFetchBody('response')}
              disabled={bodyState.kind === 'loading'}
              style={smallBtn}
            >
              {bodyState.kind === 'loading' && bodyState.for === 'response'
                ? 'Loading…'
                : 'Fetch response body'}
            </button>
          </div>
          {bodyState.kind === 'done' && <BodyView result={bodyState.result} />}
          {bodyState.kind === 'error' && (
            <p style={{ color: STATUS_COLOR.error, marginTop: 6 }}>
              Body fetch failed: {bodyState.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderTable({
  title,
  headers,
}: {
  title: string;
  headers?: Readonly<Record<string, string>> | undefined;
}): ReactElement | null {
  if (headers === undefined) return null;
  const entries = Object.entries(headers);
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <p style={{ margin: '2px 0', color: '#57606a', fontWeight: 600 }}>{title}</p>
      <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid #f0f3f6' }}>
              <td style={{ color: '#8c959f', padding: '1px 8px 1px 0', whiteSpace: 'nowrap' }}>
                {k}
              </td>
              <td style={{ padding: '1px 0', wordBreak: 'break-all' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyView({ result }: { result: NetworkBodyResult }): ReactElement {
  if (result.body === null) {
    return (
      <p style={{ marginTop: 6, color: '#8c959f', fontSize: 12 }}>
        {result.reason === 'too-large'
          ? 'Body too large to display (> 256 KB).'
          : result.reason === 'binary'
            ? 'Binary body — not displayed in v1.'
            : result.reason === 'timeout'
              ? 'Body fetch timed out.'
              : 'Body unavailable.'}
      </p>
    );
  }
  return (
    <pre
      style={{
        marginTop: 6,
        maxHeight: 220,
        overflow: 'auto',
        background: '#fff',
        border: '1px solid #eaeef2',
        borderRadius: 4,
        padding: 8,
        fontSize: 11.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {result.body}
    </pre>
  );
}

function networkStatusPill(record: NetworkRecord): { label: string; bg: string } {
  if (record.failure) return { label: 'FAIL', bg: '#cf222e' };
  const s = record.status;
  if (s === undefined) return { label: '…', bg: '#8c959f' };
  if (s >= 200 && s < 300) return { label: String(s), bg: '#1a7f37' };
  if (s >= 300 && s < 400) return { label: String(s), bg: '#0969da' };
  if (s >= 400 && s < 500) return { label: String(s), bg: '#9a6700' };
  return { label: String(s), bg: '#cf222e' };
}

function durationOf(record: NetworkRecord): number | null {
  if (record.endTimestampMs === undefined) return null;
  return Math.max(0, record.endTimestampMs - record.requestTimestampMs);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function filterNetwork(
  records: readonly NetworkRecord[],
  text: string,
  methods: Set<string>,
  statuses: Set<string>,
): NetworkRecord[] {
  const q = text.toLowerCase();
  return records.filter((r) => {
    if (!methods.has(r.method)) return false;
    if (!statuses.has(statusBucket(r))) return false;
    if (q && !r.url.toLowerCase().includes(q)) return false;
    return true;
  });
}

function statusBucket(r: NetworkRecord): string {
  if (r.failure) return 'failed';
  const s = r.status;
  if (s === undefined) return 'failed'; // not-yet-ended; treat as failed for the filter
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  return '5xx';
}

function toggleInSet<T>(current: Set<T>, set: (s: Set<T>) => void, value: T): void {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  set(next);
}

const smallBtn = {
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
  border: '1px solid #d0d7de',
  borderRadius: 3,
  background: '#fff',
} as const;

/**
 * E-17 component tree inspector. Hierarchical view of the running app's React
 * components, expandable to see props, with name search. Pull-only on click
 * (or `Cmd-R` while focused); never auto-refreshes.
 */
function ComponentTreeSection(): ReactElement {
  const [snapshot, setSnapshot] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; roots: readonly import('../shared/ipc/contracts.js').ComponentNode[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [nameQuery, setNameQuery] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(360);

  const refresh = useCallback(async () => {
    setSnapshot({ kind: 'loading' });
    try {
      const result = await window.icarus.componentTreeSnapshot();
      if (result.ok) {
        setSnapshot({ kind: 'ready', roots: result.roots });
        // Auto-expand the first level so the tree is navigable on first load.
        const initialExpanded = new Set<string>();
        for (const root of result.roots) {
          initialExpanded.add(root.id);
        }
        setExpanded(initialExpanded);
      } else {
        setSnapshot({ kind: 'error', message: formatTreeError(result) });
      }
    } catch (e) {
      setSnapshot({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Cmd-R / Ctrl-R refreshes the tree while the panel is focused (devtools muscle memory).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh]);

  const roots = snapshot.kind === 'ready' ? snapshot.roots : [];
  const query = nameQuery.toLowerCase();
  // Flatten the (visible) tree into rows for the virtualizer. When a name
  // query is active, we keep only matching nodes + their ancestors (so the
  // tree stays navigable).
  const rows = flattenForRender(roots, expanded, query);

  // Virtualization (E-11 hand-rolled pattern).
  const total = rows.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - VIRT_OVERSCAN);
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + containerHeight) / TREE_ROW_HEIGHT) + VIRT_OVERSCAN,
  );
  const visibleRows = rows.slice(startIdx, endIdx);
  const topPad = startIdx * TREE_ROW_HEIGHT;
  const bottomPad = Math.max(0, (total - endIdx) * TREE_ROW_HEIGHT);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>React component tree (E-17)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Click <strong>Refresh</strong> (or <kbd>⌘R</kbd>) to capture the rendered tree. The tree is
        read-only — Icarus never mutates the app to take it.
      </p>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={snapshot.kind === 'loading'}
          style={btnStyle}
        >
          {snapshot.kind === 'loading' ? 'Refreshing…' : 'Refresh tree'}
        </button>
        <input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="filter by component name…"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #d0d7de',
            borderRadius: 4,
            minWidth: 180,
          }}
        />
        <span style={{ color: '#8c959f', fontSize: 12, marginLeft: 'auto' }}>
          {snapshot.kind === 'ready' ? `${rows.length} visible (${countNodes(roots)} total)` : '—'}
        </span>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          height: 360,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 0,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          background: '#f6f8fa',
        }}
      >
        {snapshot.kind === 'idle' && (
          <p style={{ color: '#8c959f', margin: 8 }}>
            No tree captured yet. Click <strong>Refresh tree</strong> to take one.
          </p>
        )}
        {snapshot.kind === 'loading' && (
          <p style={{ color: '#8c959f', margin: 8 }}>Capturing tree…</p>
        )}
        {snapshot.kind === 'error' && (
          <p style={{ color: STATUS_COLOR.error, margin: 8, fontSize: 12 }}>{snapshot.message}</p>
        )}
        {snapshot.kind === 'ready' && rows.length === 0 && (
          <p style={{ color: '#8c959f', margin: 8, fontSize: 12 }}>
            {roots.length === 0
              ? 'Tree is empty (no rendered components).'
              : 'No components match the filter.'}
          </p>
        )}
        {snapshot.kind === 'ready' && rows.length > 0 && (
          <>
            <div style={{ height: topPad }} />
            {visibleRows.map((row) => (
              <TreeRow
                key={row.node.id}
                node={row.node}
                isExpanded={expanded.has(row.node.id)}
                onToggle={() => toggleExpanded(expanded, setExpanded, row.node.id)}
                hasChildren={row.node.children.length > 0}
                isMatch={query.length > 0 && row.node.name.toLowerCase().includes(query)}
              />
            ))}
            <div style={{ height: bottomPad }} />
          </>
        )}
      </div>
    </section>
  );
}

const TREE_ROW_HEIGHT = 24;

interface FlatTreeRow {
  readonly node: import('../shared/ipc/contracts.js').ComponentNode;
}

function flattenForRender(
  roots: readonly import('../shared/ipc/contracts.js').ComponentNode[],
  expanded: Set<string>,
  query: string,
): readonly FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  if (query.length > 0) {
    // Query mode: keep ancestors + matching nodes (and their children, so the
    // user can see context). The simplest correct algorithm: walk the tree,
    // build a "filtered" tree that drops non-matching leaves but keeps internal
    // nodes that have a match in their subtree.
    collectMatches(roots, query, expanded, out);
    return out;
  }
  // No query: standard depth-first flatten honoring `expanded`.
  const visit = (n: import('../shared/ipc/contracts.js').ComponentNode): void => {
    out.push({ node: n });
    if (expanded.has(n.id)) {
      for (const c of n.children) visit(c);
    }
  };
  for (const r of roots) visit(r);
  return out;
}

function collectMatches(
  nodes: readonly import('../shared/ipc/contracts.js').ComponentNode[],
  query: string,
  expanded: Set<string>,
  out: FlatTreeRow[],
): void {
  for (const n of nodes) {
    const matches = n.name.toLowerCase().includes(query);
    const subtreeHasMatch = matches || n.children.some((c) => nameInTree(c, query));
    if (!subtreeHasMatch) continue;
    out.push({ node: n });
    if (matches) {
      // Force-expand on a direct match so the user sees its context.
      for (const c of n.children) collectMatches([c], query, expanded, out);
    } else {
      // No direct match but a descendant has one — recurse to surface the path.
      if (expanded.has(n.id) || n.depth === 0) {
        for (const c of n.children) collectMatches([c], query, expanded, out);
      }
    }
  }
}

function nameInTree(
  node: import('../shared/ipc/contracts.js').ComponentNode,
  query: string,
): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  return node.children.some((c) => nameInTree(c, query));
}

function countNodes(nodes: readonly import('../shared/ipc/contracts.js').ComponentNode[]): number {
  let total = 0;
  for (const n of nodes) {
    total += 1 + countNodes(n.children);
  }
  return total;
}

function toggleExpanded(current: Set<string>, set: (s: Set<string>) => void, id: string): void {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set(next);
}

function formatTreeError(result: { kind: string; name?: string; message?: string }): string {
  switch (result.kind) {
    case 'not_connected':
      return 'Not connected to a React Native app — connect CDP first.';
    case 'no_root_element':
      return 'No #root element found in the running app. (Is this an RN dev build?)';
    case 'no_fiber_root':
      return 'No React fiber root on the #root element. The app may not be a React app.';
    case 'no_current_fiber':
      return 'React fiber root has no current fiber. The app may have just navigated.';
    case 'timeout':
      return 'Tree fetch timed out. The app may be busy — try again.';
    case 'remote_exception':
      return `JS error: ${result.name ?? 'Error'}: ${result.message ?? 'unknown'}`;
    case 'cdp_error':
      return `CDP error: ${result.message ?? 'unknown'}`;
    default:
      return `Unknown error: ${result.kind}`;
  }
}

function TreeRow({
  node,
  isExpanded,
  onToggle,
  hasChildren,
  isMatch,
}: {
  node: import('../shared/ipc/contracts.js').ComponentNode;
  isExpanded: boolean;
  onToggle: () => void;
  hasChildren: boolean;
  isMatch: boolean;
}): ReactElement {
  const [propsOpen, setPropsOpen] = useState(false);
  const indent = node.depth * 14;
  const hostBadge = node.isHostRoot ? (
    <span
      style={{
        marginLeft: 6,
        padding: '0 4px',
        background: '#ddf4ff',
        color: '#0969da',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      Host
    </span>
  ) : null;
  const propCount = Object.keys(node.props).length;
  return (
    <div
      style={{
        borderBottom: '1px solid #f0f3f6',
        background: isMatch ? '#fff8c5' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          paddingLeft: 8 + indent,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          height: TREE_ROW_HEIGHT,
        }}
      >
        <span style={{ color: '#8c959f', width: 10 }}>
          {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
        </span>
        <span style={{ color: '#24292f', fontWeight: node.isHostRoot ? 600 : 400 }}>
          {node.name}
        </span>
        {hostBadge}
        {propCount > 0 && (
          <span style={{ color: '#8c959f', fontSize: 11 }}>({propCount} props)</span>
        )}
      </button>
      {isExpanded && propCount > 0 && (
        <div style={{ padding: '0 8px 6px 8px', paddingLeft: 8 + indent + 16 }}>
          <button
            type="button"
            onClick={() => setPropsOpen((o) => !o)}
            style={{
              ...smallBtn,
              marginBottom: propsOpen ? 4 : 0,
            }}
          >
            {propsOpen ? 'Hide props' : 'Show props'}
          </button>
          {propsOpen && (
            <pre
              style={{
                margin: 0,
                padding: 6,
                background: '#fff',
                border: '1px solid #eaeef2',
                borderRadius: 4,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {Object.entries(node.props)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * E-18 storage inspector. Backend selector (AsyncStorage | MMKV) → Refresh →
 * list of keys with value previews → click a row to expand the full value + a
 * Delete button. Pull-only on click; no auto-refresh.
 */
function StorageSection(): ReactElement {
  type Backend = 'async-storage' | 'mmkv';
  const [backend, setBackend] = useState<Backend>('async-storage');
  const [snapshot, setSnapshot] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; keys: readonly import('../shared/ipc/contracts.js').StorageKey[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [nameQuery, setNameQuery] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(280);

  const refresh = useCallback(async () => {
    setSnapshot({ kind: 'loading' });
    try {
      const result = await window.icarus.storageList({ backend });
      if (result.ok) {
        setSnapshot({ kind: 'ready', keys: result.keys });
      } else {
        setSnapshot({ kind: 'error', message: formatStorageError(result) });
      }
    } catch (e) {
      setSnapshot({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [backend]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // When the user changes backend, auto-refresh.
  useEffect(() => {
    if (snapshot.kind === 'idle') return;
    void refresh();
  }, [backend]);

  // Refresh on `icarus:storage-changed` (fired by a row's Delete).
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ backend: string }>).detail;
      if (detail.backend === backend) void refresh();
    };
    window.addEventListener('icarus:storage-changed', onChanged);
    return () => window.removeEventListener('icarus:storage-changed', onChanged);
  }, [backend]);

  const visible =
    snapshot.kind === 'ready'
      ? snapshot.keys.filter((k) => {
          if (!nameQuery) return true;
          const q = nameQuery.toLowerCase();
          return k.key.toLowerCase().includes(q) || k.preview.toLowerCase().includes(q);
        })
      : [];

  // Virtualization (E-11 pattern).
  const total = visible.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / STORAGE_ROW_HEIGHT) - VIRT_OVERSCAN);
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + containerHeight) / STORAGE_ROW_HEIGHT) + VIRT_OVERSCAN,
  );
  const windowEntries = visible.slice(startIdx, endIdx);
  const topPad = startIdx * STORAGE_ROW_HEIGHT;
  const bottomPad = Math.max(0, (total - endIdx) * STORAGE_ROW_HEIGHT);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Storage (E-18 · AsyncStorage + MMKV)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Peek at the app's JS-side key-value stores. Click <strong>Refresh</strong> (or <kbd>⌘R</kbd>
        ) to take a snapshot. Delete is opt-in per row.
      </p>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}
      >
        <label style={{ fontSize: 12, color: '#57606a' }}>
          Backend:{' '}
          <select
            value={backend}
            onChange={(e) => setBackend(e.target.value as Backend)}
            style={{
              padding: '2px 6px',
              fontSize: 12,
              border: '1px solid #d0d7de',
              borderRadius: 4,
            }}
          >
            <option value="async-storage">AsyncStorage</option>
            <option value="mmkv">MMKV</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={snapshot.kind === 'loading'}
          style={btnStyle}
        >
          {snapshot.kind === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
        <input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="filter by key or value…"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            border: '1px solid #d0d7de',
            borderRadius: 4,
            minWidth: 180,
          }}
        />
        <span style={{ color: '#8c959f', fontSize: 12, marginLeft: 'auto' }}>
          {snapshot.kind === 'ready' ? `${visible.length} / ${snapshot.keys.length}` : '—'}
        </span>
      </div>
      <div
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          height: 280,
          overflowY: 'auto',
          border: '1px solid #eaeef2',
          borderRadius: 6,
          padding: 0,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          background: '#f6f8fa',
        }}
      >
        {snapshot.kind === 'idle' && (
          <p style={{ color: '#8c959f', margin: 8 }}>
            No snapshot yet. Click <strong>Refresh</strong> to take one.
          </p>
        )}
        {snapshot.kind === 'loading' && <p style={{ color: '#8c959f', margin: 8 }}>Loading…</p>}
        {snapshot.kind === 'error' && (
          <p style={{ color: STATUS_COLOR.error, margin: 8, fontSize: 12 }}>{snapshot.message}</p>
        )}
        {snapshot.kind === 'ready' && visible.length === 0 && (
          <p style={{ color: '#8c959f', margin: 8, fontSize: 12 }}>
            {snapshot.keys.length === 0 ? 'No keys in this store.' : 'No keys match the filter.'}
          </p>
        )}
        {snapshot.kind === 'ready' && windowEntries.length > 0 && (
          <>
            <div style={{ height: topPad }} />
            {windowEntries.map((k) => (
              <StorageRow
                key={k.key}
                backend={backend}
                keyName={k.key}
                preview={k.preview}
                kind={k.kind}
                isExpanded={expanded.has(k.key)}
                onToggle={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(k.key)) next.delete(k.key);
                    else next.add(k.key);
                    return next;
                  });
                }}
              />
            ))}
            <div style={{ height: bottomPad }} />
          </>
        )}
      </div>
    </section>
  );
}

const STORAGE_ROW_HEIGHT = 28;

function StorageRow({
  backend,
  keyName,
  preview,
  kind,
  isExpanded,
  onToggle,
}: {
  backend: 'async-storage' | 'mmkv';
  keyName: string;
  preview: string;
  kind: 'string' | 'number' | 'boolean' | 'object' | 'null' | 'unknown';
  isExpanded: boolean;
  onToggle: () => void;
}): ReactElement {
  const [full, setFull] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; value: string; valueKind: typeof kind }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const loadFull = async (): Promise<void> => {
    setFull({ kind: 'loading' });
    try {
      const result = await window.icarus.storageGet({ backend, key: keyName });
      if (result.ok) {
        setFull({
          kind: 'ready',
          value: result.value.value,
          valueKind: result.value.kind,
        });
      } else {
        setFull({ kind: 'error', message: formatStorageError(result) });
      }
    } catch (e) {
      setFull({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!confirm(`Delete key "${keyName}"?`)) return;
    const result = await window.icarus.storageDelete({ backend, key: keyName });
    if (!result.ok) {
      alert(`Delete failed: ${formatStorageError(result)}`);
    } else {
      window.dispatchEvent(new CustomEvent('icarus:storage-changed', { detail: { backend } }));
    }
  };

  // Listen for the storage-changed event to refresh our row (if expanded).
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ backend: string }>).detail;
      if (detail.backend !== backend) return;
      if (full.kind === 'ready') {
        void loadFull();
      }
    };
    window.addEventListener('icarus:storage-changed', onChanged);
    return () => window.removeEventListener('icarus:storage-changed', onChanged);
  }, [backend, full.kind]);
  return (
    <div style={{ borderBottom: '1px solid #f0f3f6' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          height: STORAGE_ROW_HEIGHT,
        }}
      >
        <span style={{ color: '#8c959f', width: 10 }}>{isExpanded ? '▾' : '▸'}</span>
        <span style={{ flex: 1, color: '#24292f' }}>{keyName}</span>
        <span
          style={{
            color: '#8c959f',
            fontSize: 11,
            padding: '0 4px',
            background: '#eaeef2',
            borderRadius: 3,
          }}
        >
          {kind}
        </span>
        <span
          style={{
            color: '#24292f',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preview}
        </span>
      </button>
      {isExpanded && (
        <div style={{ padding: '0 8px 8px 28px', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button type="button" onClick={() => void loadFull()} style={smallBtn}>
              {full.kind === 'loading' ? 'Loading…' : 'Load full value'}
            </button>
            <button
              type="button"
              onClick={() => void onDelete()}
              style={{ ...smallBtn, color: '#cf222e' }}
            >
              Delete
            </button>
          </div>
          {full.kind === 'ready' && (
            <pre
              style={{
                margin: 0,
                padding: 8,
                background: '#fff',
                border: '1px solid #eaeef2',
                borderRadius: 4,
                fontSize: 11.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {full.value}
            </pre>
          )}
          {full.kind === 'error' && (
            <p style={{ color: STATUS_COLOR.error, fontSize: 11 }}>{full.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatStorageError(result: { kind: string; name?: string; message?: string }): string {
  switch (result.kind) {
    case 'not_connected':
      return 'Not connected to a React Native app — connect CDP first.';
    case 'no_module':
      return 'Storage module not installed in this app. (Is it a fresh RN template?)';
    case 'no_key':
      return 'Key not found.';
    case 'timeout':
      return 'Storage fetch timed out. The app may be busy — try again.';
    case 'remote_exception':
      return `JS error: ${result.name ?? 'Error'}: ${result.message ?? 'unknown'}`;
    case 'cdp_error':
      return `CDP error: ${result.message ?? 'unknown'}`;
    default:
      return `Unknown error: ${result.kind}`;
  }
}

/**
 * E-19 performance inspector (minimal viable). Four cards on click of Refresh:
 *   - JS heap (used / total)
 *   - JS metric counts (scripts + GC events, if available)
 *   - Top 20 estimated re-render hot-spots
 *   - Recent console-error count (currently always 0 — extension point)
 * Pull-only, click-driven.
 */
function PerfSection(): ReactElement {
  const [snapshot, setSnapshot] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').PerfSnapshot }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const refresh = useCallback(async () => {
    setSnapshot({ kind: 'loading' });
    try {
      const snap = await window.icarus.perfSnapshot();
      setSnapshot({ kind: 'ready', snap });
    } catch (e) {
      setSnapshot({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Performance (E-19 · minimal viable)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        JS heap + JS metrics + estimated re-render hot-spots. Click <strong>Refresh</strong> to take
        a snapshot. FPS / native frame timing require the in-app bridge (out of scope for v1).
      </p>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={snapshot.kind === 'loading'}
        style={btnStyle}
      >
        {snapshot.kind === 'loading' ? 'Refreshing…' : 'Refresh perf'}
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 12,
        }}
      >
        <HeapCard snap={snapshot} />
        <MetricsCard snap={snapshot} />
        <ErrorCountCard snap={snapshot} />
        <HotspotsCard snap={snapshot} />
      </div>
    </section>
  );
}

function HeapCard({
  snap,
}: {
  snap:
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').PerfSnapshot }
    | { kind: 'error'; message: string };
}): ReactElement {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>JS heap</p>
      {snap.kind !== 'ready' ? (
        <p style={cardEmptyStyle}>—</p>
      ) : !snap.snap.jsHeap.supported ? (
        <p style={cardEmptyStyle}>
          Not supported
          <br />
          <span style={{ fontSize: 11, color: '#8c959f' }}>{snap.snap.jsHeap.reason}</span>
        </p>
      ) : (
        <>
          <p style={cardValueStyle}>{formatBytes(snap.snap.jsHeap.used)}</p>
          <p style={{ fontSize: 11, color: '#8c959f', margin: '2px 0 0' }}>
            of {formatBytes(snap.snap.jsHeap.total)} total
            {snap.snap.jsHeap.limit !== undefined
              ? ` · cap ${formatBytes(snap.snap.jsHeap.limit)}`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}

function MetricsCard({
  snap,
}: {
  snap:
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').PerfSnapshot }
    | { kind: 'error'; message: string };
}): ReactElement {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>JS performance</p>
      {snap.kind !== 'ready' ? (
        <p style={cardEmptyStyle}>—</p>
      ) : !snap.snap.jsMetrics.supported ? (
        <p style={cardEmptyStyle}>
          Not supported
          <br />
          <span style={{ fontSize: 11, color: '#8c959f' }}>{snap.snap.jsMetrics.reason}</span>
        </p>
      ) : (
        <p style={{ fontSize: 12, color: '#24292f', margin: 0 }}>
          {snap.snap.jsMetrics.metrics.length} metrics
        </p>
      )}
    </div>
  );
}

function ErrorCountCard({
  snap,
}: {
  snap:
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').PerfSnapshot }
    | { kind: 'error'; message: string };
}): ReactElement {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>Recent errors</p>
      {snap.kind !== 'ready' ? (
        <p style={cardEmptyStyle}>—</p>
      ) : (
        <p style={cardValueStyle}>{snap.snap.recentErrorCount ?? 0}</p>
      )}
    </div>
  );
}

function HotspotsCard({
  snap,
}: {
  snap:
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').PerfSnapshot }
    | { kind: 'error'; message: string };
}): ReactElement {
  return (
    <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
      <p style={cardLabelStyle}>
        Top estimated re-renders{' '}
        <span style={{ fontSize: 11, color: '#8c959f', fontWeight: 400 }}>
          (heuristic: counts `memoizedProps` alternates in the fiber chain)
        </span>
      </p>
      {snap.kind !== 'ready' ? (
        <p style={cardEmptyStyle}>—</p>
      ) : !snap.snap.renderHotspots.ok ? (
        <p style={cardEmptyStyle}>
          {snap.snap.renderHotspots.kind === 'no_fiber_root'
            ? 'No React fiber root — connect to an RN app first.'
            : 'Probe failed.'}
        </p>
      ) : snap.snap.renderHotspots.hotspots.length === 0 ? (
        <p style={cardEmptyStyle}>No components to report.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eaeef2', textAlign: 'left' }}>
              <th style={hotThStyle}>Component</th>
              <th style={{ ...hotThStyle, width: 80, textAlign: 'right' }}>Estimated renders</th>
            </tr>
          </thead>
          <tbody>
            {snap.snap.renderHotspots.hotspots.map((h, i) => (
              <tr key={`${h.name}:${i}`} style={{ borderBottom: '1px solid #f0f3f6' }}>
                <td style={hotTdStyle}>{h.name}</td>
                <td style={{ ...hotTdStyle, textAlign: 'right', fontFamily: 'ui-monospace' }}>
                  {h.renders}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #eaeef2',
  borderRadius: 6,
  padding: 12,
  background: '#fff',
};
const cardLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  color: '#57606a',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const cardValueStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 24,
  fontWeight: 600,
  color: '#24292f',
};
const cardEmptyStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  color: '#8c959f',
};
const hotThStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 11,
  fontWeight: 600,
  color: '#57606a',
};
const hotTdStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 12,
};

/**
 * E-20 navigation inspector. Reads from the user-installed in-app bridge
 * (`globalThis.__ICARUS_NAV_STATE__`). If the bridge is missing, the panel
 * shows a copy-paste snippet the user can drop into their app.
 */
function NavSection(): ReactElement {
  const [snapshot, setSnapshot] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; snap: import('../shared/ipc/contracts.js').NavSnapshot }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const refresh = useCallback(async () => {
    setSnapshot({ kind: 'loading' });
    try {
      const snap = await window.icarus.navSnapshot();
      setSnapshot({ kind: 'ready', snap });
    } catch (e) {
      setSnapshot({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  return (
    <section>
      <h2 style={{ fontSize: 16 }}>Navigation (E-20 · React Navigation)</h2>
      <p style={{ color: '#57606a', marginTop: 0, fontSize: 13 }}>
        Reads from <code>globalThis.__ICARUS_NAV_STATE__</code>. Add the one-line bridge to your app
        to expose the state (snippet below).
      </p>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={snapshot.kind === 'loading'}
        style={btnStyle}
      >
        {snapshot.kind === 'loading' ? 'Refreshing…' : 'Refresh nav'}
      </button>
      <div style={{ marginTop: 12 }}>
        {snapshot.kind === 'idle' && <p style={{ color: '#8c959f' }}>No snapshot yet.</p>}
        {snapshot.kind === 'error' && (
          <p style={{ color: STATUS_COLOR.error }}>{snapshot.message}</p>
        )}
        {snapshot.kind === 'ready' && snapshot.snap.ok && (
          <NavReadyView state={snapshot.snap.state} />
        )}
        {snapshot.kind === 'ready' && !snapshot.snap.ok && (
          <NavFailureView failure={snapshot.snap} />
        )}
      </div>
      <BridgeSnippet />
    </section>
  );
}

function NavReadyView({
  state,
}: {
  state: import('../shared/ipc/contracts.js').NavStateSnapshot;
}): ReactElement {
  return (
    <div>
      <p style={{ fontSize: 13, color: '#24292f' }}>
        Active route: <strong>{state.activeRouteName}</strong>{' '}
        <span style={{ color: '#8c959f', fontSize: 11 }}>
          (index {state.index} of {state.routes.length})
        </span>
      </p>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #eaeef2', textAlign: 'left' }}>
            <th style={navThStyle}>Index</th>
            <th style={navThStyle}>Route</th>
            <th style={navThStyle}>Key</th>
            <th style={navThStyle}>Params</th>
          </tr>
        </thead>
        <tbody>
          {state.routes.map((r, i) => {
            const isActive = i === state.index;
            const params = (r as { params?: Record<string, unknown> }).params;
            const preview = previewNavParams(params);
            return (
              <tr
                key={r.key}
                style={{
                  borderBottom: '1px solid #f0f3f6',
                  background: isActive ? '#fff8c5' : 'transparent',
                }}
              >
                <td style={navTdStyle}>{i}</td>
                <td style={{ ...navTdStyle, fontWeight: isActive ? 600 : 400 }}>{r.name}</td>
                <td style={{ ...navTdStyle, color: '#8c959f', fontFamily: 'ui-monospace' }}>
                  {r.key}
                </td>
                <td style={navTdStyle}>
                  {Object.keys(preview).length === 0 ? (
                    <span style={{ color: '#8c959f' }}>—</span>
                  ) : (
                    <code style={{ fontSize: 11 }}>
                      {Object.entries(preview)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')}
                    </code>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NavFailureView({
  failure,
}: {
  failure: Extract<import('../shared/ipc/contracts.js').NavSnapshot, { ok: false }>;
}): ReactElement {
  const message = (() => {
    switch (failure.kind) {
      case 'not_connected':
        return 'Not connected to a React Native app — connect CDP first.';
      case 'no_bridge':
        return 'No in-app bridge installed. Add the snippet below to your app, then click Refresh.';
      case 'invalid_format':
        return `Bridge published an unexpected state: ${failure.reason}`;
      case 'timeout':
        return 'Nav fetch timed out. The app may be busy — try again.';
      case 'remote_exception':
        return `JS error: ${failure.name}: ${failure.message}`;
      case 'cdp_error':
        return `CDP error: ${failure.message}`;
    }
  })();
  return <p style={{ color: STATUS_COLOR.error, fontSize: 12 }}>{message}</p>;
}

const BRIDGE_SNIPPET = `// In your app's root component, once (and on every nav-state change if you want live updates):
import { useEffect } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';

const navRef = createNavigationContainerRef();

function App() {
  useEffect(() => {
    if (!navRef.isReady()) return;
    const publish = () => {
      globalThis.__ICARUS_NAV_STATE__ = JSON.parse(JSON.stringify(navRef.getRootState()));
    };
    publish();
    return navRef.addListener('state', publish);
  }, []);
  return <NavigationContainer ref={navRef}>{/* ... */}</NavigationContainer>;
}`;

function BridgeSnippet(): ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(BRIDGE_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard write may be blocked; user can copy manually
    }
  };
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#57606a' }}>
        Bridge snippet (one-time setup)
      </summary>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <pre
          style={{
            margin: 0,
            padding: 8,
            background: '#fff',
            border: '1px solid #eaeef2',
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: '#24292f',
          }}
        >
          {BRIDGE_SNIPPET}
        </pre>
        <button
          type="button"
          onClick={() => void onCopy()}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            border: '1px solid #d0d7de',
            borderRadius: 3,
            background: '#fff',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </details>
  );
}

const navThStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 11,
  fontWeight: 600,
  color: '#57606a',
};
const navTdStyle: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 12,
};

function previewNavParams(
  params: Record<string, unknown> | undefined,
): Readonly<Record<string, string>> {
  if (params === undefined) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params).slice(0, 5)) {
    if (v === null) out[k] = 'null';
    else if (v === undefined) out[k] = 'undefined';
    else if (typeof v === 'string') out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

const btnStyle = { padding: '8px 16px', fontSize: 14, cursor: 'pointer' } as const;
