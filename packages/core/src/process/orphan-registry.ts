/**
 * Cross-launch orphan reaper (TR-2, TD-11). `ProcessManager.disposeAll()` covers a clean
 * shutdown, but a hard crash of Icarus itself (SIGKILL, power loss) can't run cleanup — its
 * detached child groups (Metro and its workers, simulators) then survive as orphans. This
 * module persists the process groups we spawn and reaps any survivors on the next launch.
 *
 * The hazard is **PID recycling**: a persisted pid may belong to an unrelated process by the
 * time we next start, so we must never blind-kill a stored pid. Each record carries a stable
 * per-process **identity marker** (the OS-reported start time) captured at spawn; at reap we
 * re-read the marker and only kill when it still matches — an exact compare, no clock math.
 *
 * Electron-free (ADR-0002). All I/O — persistence, identity probing, killing — is injected,
 * so the reconciliation logic is pure and unit-testable.
 */

/** A supervised process group we persist so it can be reaped after a hard crash. */
export interface OrphanRecord {
  /** The group-leader pid (== pgid for a POSIX detached spawn). */
  readonly pid: number;
  /** The process group id to signal (negative pid) when reaping. */
  readonly pgid: number;
  /** The command, for diagnostics only — never used as an identity check. */
  readonly command: string;
  /**
   * Stable per-process identity captured at spawn (OS start time). `null` while still being
   * captured; a record without a marker is treated as unverifiable and is never reaped.
   */
  readonly marker: string | null;
}

/** The subset of a spawn the registry needs to start tracking a group. */
export interface OrphanSpawn {
  readonly pid: number;
  readonly pgid: number;
  readonly command: string;
}

/**
 * The hook `ProcessManager` calls. Deliberately fire-and-forget (returns `void`) so spawning
 * stays synchronous; the implementation owns its own persistence and identity capture.
 */
export interface OrphanRegistry {
  /** Begin tracking a newly-spawned process group. */
  onSpawn(spawn: OrphanSpawn): void;
  /** Stop tracking a group that exited under our supervision (clean teardown). */
  onExit(pid: number): void;
}

/** Reads a stable identity marker for a live pid, or `null` if the pid is not alive. */
export interface ProcessIdentityProbe {
  identify(pid: number): Promise<string | null>;
}

/** Signals a whole process group (the reaper always force-kills). */
export type KillGroup = (pgid: number) => void;

/** Injected persistence for the record set (a JSON file in production). */
export interface RegistryStore {
  /** The serialized record set, or `null` if nothing has been persisted yet. */
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

/** What a reap pass did — surfaced for logging and tests. */
export interface ReapReport {
  /** pgids we signaled (verified-still-ours survivors). */
  readonly reaped: number[];
  /** pids skipped because the identity marker no longer matched (pid was recycled). */
  readonly recycled: number[];
  /** pids that were already gone (the common, healthy case). */
  readonly dead: number[];
  /** pids skipped because their record had no captured marker (unverifiable). */
  readonly unverifiable: number[];
}

/**
 * Reconcile a persisted record set against reality: kill the survivors that are provably the
 * same process we spawned, and skip everything else. Pure over its injected effects.
 */
export async function reapOrphans(
  records: readonly OrphanRecord[],
  probe: ProcessIdentityProbe,
  killGroup: KillGroup,
): Promise<ReapReport> {
  const report: ReapReport = { reaped: [], recycled: [], dead: [], unverifiable: [] };
  for (const record of records) {
    if (record.marker === null) {
      report.unverifiable.push(record.pid);
      continue;
    }
    const marker = await probe.identify(record.pid);
    if (marker === null) {
      report.dead.push(record.pid);
    } else if (marker !== record.marker) {
      report.recycled.push(record.pid);
    } else {
      killGroup(record.pgid);
      report.reaped.push(record.pgid);
    }
  }
  return report;
}

/**
 * File-backed `OrphanRegistry`. Keeps the record set in memory and serializes every mutation
 * to the injected store; writes are chained so concurrent spawns/exits can't clobber each
 * other. Identity capture happens asynchronously after `onSpawn` returns (the spawn is
 * already tracked without a marker in the meantime, and an unmarked record is never reaped).
 */
/** Internally the record set is mutable (marker is filled in after spawn); consumers see readonly. */
type TrackedRecord = { -readonly [K in keyof OrphanRecord]: OrphanRecord[K] };

export class FileOrphanRegistry implements OrphanRegistry {
  #records: TrackedRecord[] = [];
  #chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: RegistryStore,
    private readonly probe: ProcessIdentityProbe,
  ) {}

  onSpawn(spawn: OrphanSpawn): void {
    this.#records.push({ ...spawn, marker: null });
    this.#enqueue(async () => {
      const marker = await this.probe.identify(spawn.pid);
      const record = this.#records.find((r) => r.pid === spawn.pid);
      if (record) record.marker = marker;
    });
  }

  onExit(pid: number): void {
    this.#records = this.#records.filter((r) => r.pid !== pid);
    this.#enqueue(async () => Promise.resolve());
  }

  /**
   * Load the previous run's records, reap the survivors, then clear the store so this run
   * starts clean. Call once at startup, before spawning anything.
   */
  async reap(killGroup: KillGroup): Promise<ReapReport> {
    const previous = await this.#load();
    const report = await reapOrphans(previous, this.probe, killGroup);
    this.#records = [];
    await this.store.write(serialize([]));
    return report;
  }

  /** Current in-memory records (test/diagnostic seam). */
  records(): readonly OrphanRecord[] {
    return [...this.#records];
  }

  async #load(): Promise<OrphanRecord[]> {
    const raw = await this.store.read();
    return raw === null ? [] : deserialize(raw);
  }

  #enqueue(mutate: () => Promise<void>): void {
    this.#chain = this.#chain
      .then(mutate)
      .then(() => this.store.write(serialize(this.#records)))
      .catch(() => undefined);
  }

  /** Resolves once all queued persistence has flushed (tests await this). */
  whenFlushed(): Promise<void> {
    return this.#chain;
  }
}

function serialize(records: readonly OrphanRecord[]): string {
  return JSON.stringify(records, null, 2);
}

function deserialize(raw: string): OrphanRecord[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOrphanRecord) : [];
  } catch {
    return [];
  }
}

function isOrphanRecord(value: unknown): value is OrphanRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['pid'] === 'number' &&
    typeof record['pgid'] === 'number' &&
    typeof record['command'] === 'string' &&
    (typeof record['marker'] === 'string' || record['marker'] === null)
  );
}
