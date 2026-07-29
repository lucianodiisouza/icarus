import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { AssistantSection } from './AssistantSection.js';
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

const VIRT_ITEM_HEIGHT = 18; // px per row in the virtualized log list
const VIRT_OVERSCAN = 8; // extra rows above/below the visible window

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
