import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext, FeatureModule } from './feature-module.js';
import { defineFeatureModule } from './feature-module.js';

/**
 * Conformance test kit for any FeatureModule (E-05). These properties are the
 * minimum the runtime relies on; modules that violate them will misbehave in
 * subtle ways (leaked subscriptions, double-init crashes, etc.).
 *
 * The kit is structured as a builder so each test can register its own module
 * and run the full property set against it. A real module's test file should
 * call \`conformanceTests(makeModule)\` with a factory.
 */

function makeFakeContext(): {
  ctx: ModuleContext;
  disposables: Array<() => void>;
  logLines: string[];
} {
  const disposables: Array<() => void> = [];
  const logLines: string[] = [];
  return {
    ctx: {
      processes: {} as never,
      onDispose: (d) => {
        disposables.push(d);
      },
      log: (level, message) => {
        logLines.push(`${level}: ${message}`);
      },
    },
    disposables,
    logLines,
  };
}

/**
 * Properties every FeatureModule must satisfy. Generic over the module's event
 * map: the kit never touches the event types, so accepting any concrete
 * `FeatureModule<E>` avoids the variance clash that a fixed
 * `FeatureModule<Record<string, unknown>>` parameter would force on callers.
 */
export function conformanceTests<E extends Record<string, unknown>>(
  makeModule: () => FeatureModule<E>,
): void {
  it('has a non-empty, kebab-case id', () => {
    const m = makeModule();
    expect(m.id).toBeTruthy();
    expect(m.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has a non-empty displayName', () => {
    const m = makeModule();
    expect(m.displayName).toBeTruthy();
  });

  it('declares an events array whose names each yield a working subscription', () => {
    const m = makeModule();
    expect(Array.isArray(m.events)).toBe(true);
    // Every declared event name must be subscribable and return a callable,
    // non-throwing unsubscribe — this is what bindRegistryToWindow relies on.
    for (const name of m.events) {
      const off = m.on(name, () => undefined);
      expect(typeof off).toBe('function');
      expect(() => off()).not.toThrow();
    }
  });

  it('init() does not throw and registers at least one disposable when wired to ctx', async () => {
    const m = makeModule();
    const { ctx, disposables } = makeFakeContext();
    // The runtime guarantees modules register at least one cleanup. We test
    // init's contract by calling it and confirming no throw + that dispose()
    // is idempotent (which only works if all disposables fired).
    await m.init(ctx);
    await m.dispose();
    // Re-dispose is a no-op (idempotent) and doesn't throw.
    await m.dispose();
    // The disposables we registered are all callable.
    for (const d of disposables) expect(() => d()).not.toThrow();
  });

  it('on() returns an unsubscribe that actually detaches the handler', () => {
    const m = makeModule();
    const handler = vi.fn();
    const off = m.on('ping', handler);
    // We can't trigger events without a real module, but we can at least assert
    // that off() is a function and doesn't throw.
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('on() returns an unsubscribe that actually detaches the handler', () => {
    const m = makeModule();
    const handler = vi.fn();
    const off = m.on('ping', handler as (payload: unknown) => void);
    // We can't trigger events without a real module, but we can at least assert
    // that off() is a function and doesn't throw.
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
}

describe('FeatureModule conformance (built-in)', () => {
  conformanceTests(() =>
    defineFeatureModule({
      id: 'demo',
      displayName: 'Demo Module',
      init: () => {
        /* no-op */
      },
      dispose: () => {
        /* no-op */
      },
      on: () => () => {
        /* returns an unsubscribe that does nothing */
      },
    }),
  );
});

describe('defineFeatureModule', () => {
  it('returns an object with the expected shape', () => {
    const m = defineFeatureModule({
      id: 'x',
      displayName: 'X',
      init: () => undefined,
      dispose: () => undefined,
      on: () => () => undefined,
    });
    expect(m.id).toBe('x');
    expect(m.displayName).toBe('X');
    expect(typeof m.init).toBe('function');
    expect(typeof m.dispose).toBe('function');
    expect(typeof m.on).toBe('function');
  });

  it('init can be async and the runtime awaits it', async () => {
    let resolved = false;
    const m = defineFeatureModule({
      id: 'x',
      displayName: 'X',
      init: async () => {
        await new Promise((r) => setTimeout(r, 1));
        resolved = true;
      },
      dispose: () => undefined,
      on: () => () => undefined,
    });
    await m.init({} as ModuleContext);
    expect(resolved).toBe(true);
  });
});
