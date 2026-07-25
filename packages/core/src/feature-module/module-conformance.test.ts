import { describe, expect, it, vi } from 'vitest';
import { conformanceTests } from './feature-module.test.js';
import { createMetroModule } from './metro-module.js';
import { createUnifiedLogModule } from './unified-log-module.js';
import { createDevicesModule } from './devices-module.js';
import { MetroController } from '../metro/metro-controller.js';
import { UnifiedLogController } from '../unified-log/unified-log-controller.js';

/**
 * Conformance tests against the THREE real feature modules (TD-14). The
 * conformance kit in feature-module.test.ts is the contract; running it
 * against every real module is the proof that the interface was extracted
 * from the right shape.
 */
describe('Metro feature module', () => {
  conformanceTests(() =>
    createMetroModule(
      new MetroController({
        processes: {} as never,
        spawn: () => {
          throw new Error('not used in conformance tests');
        },
      }),
    ),
  );
});

describe('UnifiedLog feature module', () => {
  conformanceTests(() => createUnifiedLogModule(new UnifiedLogController()));
});

describe('Devices feature module', () => {
  conformanceTests(() => createDevicesModule());

  it('on() returns a working unsubscribe (no events to deliver)', () => {
    const module = createDevicesModule();
    const handler = vi.fn();
    const off = module.on('foo' as never, handler as never);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});
