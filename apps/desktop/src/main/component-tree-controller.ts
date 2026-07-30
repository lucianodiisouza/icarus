import type { BrowserWindow } from 'electron';
import {
  evaluateOnTarget,
  FIBER_ROOT_EXPRESSION,
  walkReactTree,
  type CdpSendLike,
  type ComponentNode,
  type EvaluateResult,
} from '@icarus/core';
import { CHANNELS } from '../shared/ipc/contracts.js';
import { componentTreeSnapshotInputSchema } from '../shared/ipc/contracts.js';
import type { IpcRouter } from './ipc/router.js';

/**
 * The desktop wiring of the M3 component tree inspector (E-17). Same shape as
 * `NetworkController` (E-16) and `AssistantBridge` (E-13): a small main-process
 * orchestrator that owns a `Runtime.evaluate` round-trip and walks the result.
 *
 * The renderer drives the inspector by calling `componentTreeSnapshot` on click.
 * The expression shipped to the app (`FIBER_ROOT_EXPRESSION`) is a single read
 * from the React fiber root — it does NOT mutate the app, does NOT call any
 * user code, and does NOT run a full tree walk inside the JS context (we do
 * that in `core` so it's unit-testable without an app).
 *
 * Why click-time, not live: a React tree changes constantly; per-frame refresh
 * would flood the renderer. The user clicks "Refresh" (or `Cmd-R`) when they
 * want a fresh tree. The previous snapshot stays visible until the next click.
 */

export type ComponentTreeSnapshot =
  | { readonly ok: true; readonly roots: readonly ComponentNode[] }
  | { readonly ok: false; readonly kind: 'not_connected' }
  | { readonly ok: false; readonly kind: 'no_root_element' }
  | { readonly ok: false; readonly kind: 'no_fiber_root' }
  | { readonly ok: false; readonly kind: 'no_current_fiber' }
  | {
      readonly ok: false;
      readonly kind: 'remote_exception';
      readonly name: string;
      readonly message: string;
    }
  | { readonly ok: false; readonly kind: 'timeout' }
  | { readonly ok: false; readonly kind: 'cdp_error'; readonly message: string };

export interface ComponentTreeController {
  /** The CDP `send` seam (set when the session is connected). */
  readonly setCdpSend: (send: CdpSendLike | null) => void;
  /**
   * Take a snapshot of the running app's React component tree. Returns a typed
   * result; never throws. The renderer pattern-matches on `ok` to render the
   * right "why this didn't work" message.
   */
  readonly snapshot: () => Promise<ComponentTreeSnapshot>;
}

const DEFAULT_EVAL_TIMEOUT_MS = 5_000;

/** The shape `FIBER_ROOT_EXPRESSION` returns. We tag every failure path so the
 *  renderer can show the right "what's missing" message. */
interface FiberExpressionResult {
  readonly ok: boolean;
  readonly kind?: 'no_root_element' | 'no_fiber_root' | 'no_current_fiber';
  readonly fiber?: unknown;
}

export function createComponentTreeController(): ComponentTreeController {
  let cdpSend: CdpSendLike | null = null;
  return {
    setCdpSend: (send) => {
      cdpSend = send;
    },
    snapshot: async () => {
      if (cdpSend === null) return { ok: false, kind: 'not_connected' };
      const raw = await evaluateOnTarget<FiberExpressionResult>(cdpSend, FIBER_ROOT_EXPRESSION, {
        timeoutMs: DEFAULT_EVAL_TIMEOUT_MS,
      });
      if (raw.ok) {
        const root = raw.value;
        if (!root || typeof root !== 'object') {
          return { ok: false, kind: 'no_fiber_root' };
        }
        if (root.ok !== true) {
          switch (root.kind) {
            case 'no_root_element':
              return { ok: false, kind: 'no_root_element' };
            case 'no_fiber_root':
              return { ok: false, kind: 'no_fiber_root' };
            case 'no_current_fiber':
              return { ok: false, kind: 'no_current_fiber' };
            default:
              return { ok: false, kind: 'no_fiber_root' };
          }
        }
        return { ok: true, roots: walkReactTree(root.fiber ?? null) };
      }
      return mapEvalFailure(raw);
    },
  };
}

type EvalFailure = Extract<EvaluateResult<FiberExpressionResult>, { ok: false }>;

function mapEvalFailure(raw: EvalFailure): ComponentTreeSnapshot {
  if (raw.kind === 'timeout') {
    return { ok: false, kind: 'timeout' };
  }
  if (raw.kind === 'remote_exception') {
    return {
      ok: false,
      kind: 'remote_exception',
      name: raw.name,
      message: raw.message,
    };
  }
  // cdp_error is the only remaining kind.
  return { ok: false, kind: 'cdp_error', message: raw.message };
}

export interface RegisterComponentTreeChannelsDeps {
  readonly router: IpcRouter;
  readonly controller: ComponentTreeController;
  /** Currently unused — kept for parity with the other inspectors. */
  readonly window?: () => BrowserWindow | null;
}

export function registerComponentTreeChannels(deps: RegisterComponentTreeChannelsDeps): () => void {
  const { router, controller } = deps;
  router.register(CHANNELS.COMPONENT_TREE_SNAPSHOT, componentTreeSnapshotInputSchema, async () =>
    controller.snapshot(),
  );
  // No subscriptions to detach in v1 (the inspector is pull-only on click).
  return () => undefined;
}
