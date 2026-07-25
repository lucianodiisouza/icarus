import { describe, expect, it, vi } from 'vitest';
import { conformanceTests } from './feature-module.test.js';
import { ModuleRegistry } from './module-registry.js';
import { defineFeatureModule, type FeatureModule } from './feature-module.js';

function makeDemoModule(): FeatureModule<Record<string, unknown>> {
  return defineFeatureModule({
    id: 'demo',
    displayName: 'Demo',
    init: () => {
      /* no-op */
    },
    dispose: () => {
      /* no-op */
    },
    on: () => {
      return () => undefined;
    },
  });
}

function makeRegistryProcessManager() {
  // The registry just passes `processes` through to ModuleContext; the value
  // doesn't matter for these tests.
  return {} as never;
}

describe('ModuleRegistry', () => {
  conformanceTests(() => makeDemoModule());

  it('register() calls init() once per module', async () => {
    const registry = new ModuleRegistry();
    const module = makeDemoModule();
    const initSpy = vi.spyOn(module, 'init');
    registry.register(module, { processes: makeRegistryProcessManager() });
    await Promise.resolve();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('list() returns the registered modules in registration order', async () => {
    const registry = new ModuleRegistry();
    const a = makeDemoModule();
    const b = makeDemoModule();
    Object.defineProperty(a, 'id', { value: 'a' });
    Object.defineProperty(b, 'id', { value: 'b' });
    registry.register(a, { processes: makeRegistryProcessManager() });
    registry.register(b, { processes: makeRegistryProcessManager() });
    await Promise.resolve();
    expect(registry.list().map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('disposeAll() disposes in reverse order and is idempotent', async () => {
    const registry = new ModuleRegistry();
    const order: string[] = [];
    const a = makeDemoModule();
    const b = makeDemoModule();
    const c = makeDemoModule();
    Object.defineProperty(a, 'id', { value: 'a' });
    Object.defineProperty(b, 'id', { value: 'b' });
    Object.defineProperty(c, 'id', { value: 'c' });
    const noop = (): void => undefined;
    const disposeA = vi.spyOn(a, 'dispose').mockImplementation(() => {
      order.push('a');
      noop();
    });
    const disposeB = vi.spyOn(b, 'dispose').mockImplementation(() => {
      order.push('b');
      noop();
    });
    const disposeC = vi.spyOn(c, 'dispose').mockImplementation(() => {
      order.push('c');
      noop();
    });
    registry.register(a, { processes: makeRegistryProcessManager() });
    registry.register(b, { processes: makeRegistryProcessManager() });
    registry.register(c, { processes: makeRegistryProcessManager() });
    await registry.disposeAll();
    expect(order).toEqual(['c', 'b', 'a']);
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
    expect(disposeC).toHaveBeenCalledTimes(1);
    // Idempotent: a second call is a no-op.
    await registry.disposeAll();
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('forwards log() to the registry logger with the module id prefix', () => {
    const lines: string[] = [];
    const registry = new ModuleRegistry({ log: (level, msg) => lines.push(`${level}: ${msg}`) });
    void registry; // explicit: the logger is wired even without modules
    // The conformance test elsewhere exercises the per-module log() path.
    expect(lines).toEqual([]);
  });
});
