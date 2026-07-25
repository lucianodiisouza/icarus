import { describe, expect, it } from 'vitest';
import { selectableTargets, selectMainTarget } from './target-selection.js';
import type { CdpTarget } from './types.js';

const mainTarget: CdpTarget = {
  id: 'dev-1',
  description: 'React Native Bridgeless [C++ connection]',
  webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=d&page=1',
  reactNative: { capabilities: { prefersFuseboxFrontend: true } },
};

const reanimatedTarget: CdpTarget = {
  id: 'dev-2',
  description: 'Reanimated UI runtime [C++ connection]',
  webSocketDebuggerUrl: 'ws://localhost:8081/inspector/debug?device=d&page=2',
  reactNative: { capabilities: { prefersFuseboxFrontend: false } },
};

const noWsTarget: CdpTarget = { id: 'dev-3', description: 'React Native' };

describe('target selection', () => {
  it('excludes secondary runtimes (Reanimated) and targets without a ws URL', () => {
    const selectable = selectableTargets([mainTarget, reanimatedTarget, noWsTarget]);
    expect(selectable.map((t) => t.id)).toEqual(['dev-1']);
  });

  it('selects the main JS runtime', () => {
    expect(selectMainTarget([reanimatedTarget, mainTarget])?.id).toBe('dev-1');
  });

  it('prefers a Fusebox-advertising target when several are attachable', () => {
    const plain: CdpTarget = {
      id: 'plain',
      description: 'React Native Bridge',
      webSocketDebuggerUrl: 'ws://localhost:8081/x',
    };
    expect(selectMainTarget([plain, mainTarget])?.id).toBe('dev-1');
  });

  it('returns null when nothing is attachable', () => {
    expect(selectMainTarget([reanimatedTarget, noWsTarget])).toBeNull();
  });
});
