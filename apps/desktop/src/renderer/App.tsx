import { useCallback, useState, type ReactElement } from 'react';
import type { DoctorCheckOutput } from '../shared/ipc/contracts.js';

/**
 * The walking-skeleton screen: a single button that runs the environment doctor through
 * the validated IPC boundary and renders the real result. This proves the whole path
 * renderer → preload → IPC (validated) → core → typed result → UI (Epic 1 DoD).
 */
const STATUS_COLOR: Record<string, string> = {
  ok: '#1a7f37',
  warn: '#9a6700',
  error: '#cf222e',
};

export function App(): ReactElement {
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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginBottom: 4 }}>Icarus — RNStudio</h1>
      <p style={{ color: '#57606a', marginTop: 0 }}>Walking skeleton · environment doctor</p>

      <button
        type="button"
        onClick={() => void runDoctor()}
        disabled={loading}
        style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
      >
        {loading ? 'Checking…' : 'Run environment doctor'}
      </button>

      {error && <p style={{ color: STATUS_COLOR.error }}>Error: {error}</p>}

      {report && (
        <section style={{ marginTop: 20 }}>
          <p>
            Overall:{' '}
            <strong style={{ color: STATUS_COLOR[report.overall] ?? '#000' }}>
              {report.overall.toUpperCase()}
            </strong>{' '}
            <span style={{ color: '#57606a' }}>({report.platform})</span>
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {report.checks.map((c) => (
              <li key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid #eaeef2' }}>
                <strong>{c.label}</strong> — {c.status}
                {c.version ? ` (${c.version})` : ''}
                {c.remedy && c.status !== 'ok' && (
                  <div style={{ color: '#57606a', fontSize: 13 }}>→ {c.remedy}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
