/**
 * Auto-attach policy (TD-16): when the user has Metro running and an iOS
 * simulator booted, automatically call CdpSession.connect() so the
 * M1 'app running + live logs' flow is one click from the user's side
 * (start Metro, boot a sim, Icarus does the rest).
 *
 * Policy:
 *   - Default: ENABLED. The M1 DoD says the design partner reaches the
 *     flow unaided. Auto-attach is what makes that a single step.
 *   - Triggers: any time the Metro status becomes 'ready' AND there is at
 *     least one Booted simulator. The most recent booted sim wins (we
 *     don't try to be clever about which app to target).
 *   - Idempotent: if CDP is already connected/connecting, do nothing.
 *   - User override: `query:autoAttach.get` / `command:autoAttach.set`
 *     (added in contracts) lets the renderer expose a toggle.
 *   - Disables on explicit disconnect: once the user disconnects, we
 *     do NOT auto-reconnect on the next Metro-ready event. The
 *     "disconnect means stop" rule is what keeps the user in control.
 *
 * Out of scope (deliberately, follow-up slices):
 *   - Auto-attach on a *specific* sim (the user picks "this one").
 *   - Auto-attach on app reload/Metro restart (that's a session-level
 *     feature, separate policy).
 *   - Project detection: we don't know which app/UDID to target until
 *     the user clicks something. For v1, the auto-attach hits the
 *     first Booted sim and the first Main JS target — same as
 *     manual Connect.
 */

export interface AutoAttachDeps {
  /** Read the current Metro status (cheap; the controller exposes a getter). */
  readonly isMetroReady: () => boolean;
  /** Return the UDID of the first Booted simulator, or null if none. */
  readonly firstBootedSimUdid: () => string | null;
  /** Begin a CDP connect. Resolves when the connect attempt completes. */
  readonly cdpConnect: () => Promise<void>;
  /** Cheap check: is CDP already connected/connecting? */
  readonly isCdpBusy: () => boolean;
  /** Read the enabled flag. */
  readonly isEnabled: () => boolean;
  /** Set the enabled flag. */
  readonly setEnabled: (enabled: boolean) => void;
}

/**
 * Should we auto-attach right now? Pure — the caller decides when to ask.
 * Used by the test suite to assert the policy without driving the
 * controller events. Takes an optional \`userDisconnected\` flag (the
 * orchestrator owns this) so the test suite can drive it without
 * instantiating the class.
 */
export function shouldAutoAttach(
  deps: AutoAttachDeps & { readonly userDisconnected?: boolean },
): boolean {
  if (!deps.isEnabled()) return false;
  if (deps.userDisconnected) return false;
  if (deps.isCdpBusy()) return false;
  if (!deps.isMetroReady()) return false;
  if (deps.firstBootedSimUdid() === null) return false;
  return true;
}

/**
 * The live auto-attach orchestrator. Holds the subscriptions and the
 * \`userDisconnected\` flag. Call \`start()\` to wire it up; \`stop()\`
 * detaches every subscription (idempotent).
 */
export class AutoAttach {
  readonly #deps: AutoAttachDeps;
  #userDisconnected = false;
  #metroUnsub: (() => void) | null = null;
  #deviceUnsub: (() => void) | null = null;
  #lastTriggeredAt = 0;

  constructor(deps: AutoAttachDeps) {
    this.#deps = { ...deps };
  }

  /** Whether the user has explicitly disabled auto-attach. */
  get userDisconnected(): boolean {
    return this.#userDisconnected;
  }

  /** Wire up the auto-attach subscriptions. Idempotent. */
  start(opts: {
    onMetroStatusChange: (handler: (status: 'ready' | string) => void) => () => void;
    onDevicesListChange: (handler: (udids: string[]) => void) => () => void;
  }): void {
    if (this.#metroUnsub !== null) return;
    this.#metroUnsub = opts.onMetroStatusChange((status) => {
      if (status === 'ready') void this.#tryAutoAttach();
    });
    this.#deviceUnsub = opts.onDevicesListChange((udids) => {
      if (udids.length > 0) void this.#tryAutoAttach();
    });
  }

  /** Detach all subscriptions. Idempotent. */
  stop(): void {
    this.#metroUnsub?.();
    this.#metroUnsub = null;
    this.#deviceUnsub?.();
    this.#deviceUnsub = null;
  }

  /** User clicked Disconnect. Stop auto-attaching until they re-enable. */
  markUserDisconnected(): void {
    this.#userDisconnected = true;
  }

  /** Reset the user-disconnected flag (e.g. when the user re-enables auto-attach). */
  clearUserDisconnected(): void {
    this.#userDisconnected = false;
  }

  async #tryAutoAttach(): Promise<void> {
    const effective: AutoAttachDeps & { userDisconnected: boolean } = {
      ...this.#deps,
      userDisconnected: this.#userDisconnected,
    };
    if (!shouldAutoAttach(effective)) return;
    // Simple debounce: don't re-fire more than once per second. Avoids a
    // burst of connect attempts when Metro restarts quickly.
    const now = Date.now();
    if (now - this.#lastTriggeredAt < 1000) return;
    this.#lastTriggeredAt = now;
    try {
      await this.#deps.cdpConnect();
    } catch {
      // Swallow — the user will see the CDP status error. The next
      // Metro-ready / sim-list-changed event will retry.
    }
  }
}
