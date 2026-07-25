import { describe, expect, it } from 'vitest';
import type { MetroController, MetroStatus } from '../metro/metro-controller.js';
import type { DetectedProject } from '../detect-project/detect-project.js';
import { createMetroModule, type MetroStatusSnapshot } from './metro-module.js';

/**
 * A minimal stand-in for MetroController. The metro module only reads
 * `onLog` / `onStatus` and the `status` / `port` / `project` getters, so the
 * fake exposes exactly those and lets the test drive a status change and mutate
 * the getters to prove the snapshot is built at emit time (not subscribe time).
 */
function makeFakeController(): {
  controller: MetroController;
  fireStatus: () => void;
  set: (state: {
    status: MetroStatus;
    port: number | null;
    project: DetectedProject | null;
  }) => void;
} {
  let statusHandler: (() => void) | null = null;
  const state = {
    status: 'idle' as MetroStatus,
    port: null as number | null,
    project: null as DetectedProject | null,
  };
  const controller = {
    get status() {
      return state.status;
    },
    get port() {
      return state.port;
    },
    get project() {
      return state.project;
    },
    onLog: () => () => undefined,
    onStatus: (handler: (status: MetroStatus) => void) => {
      statusHandler = () => handler(state.status);
      return () => {
        statusHandler = null;
      };
    },
  } as unknown as MetroController;
  return {
    controller,
    fireStatus: () => statusHandler?.(),
    set: (next) => Object.assign(state, next),
  };
}

describe('createMetroModule', () => {
  it('declares its event stream (log + status)', () => {
    const module = createMetroModule(makeFakeController().controller);
    expect(module.events).toEqual(['log', 'status']);
  });

  it('enriches the bare status into a self-contained snapshot at emit time', () => {
    const fake = makeFakeController();
    const module = createMetroModule(fake.controller);

    const received: MetroStatusSnapshot[] = [];
    module.on('status', (snapshot) => received.push(snapshot));

    fake.set({
      status: 'ready',
      port: 8081,
      project: { cwd: '/app', name: 'myapp', kind: 'bare-rn', id: 'metro-myapp-/app' },
    });
    fake.fireStatus();

    expect(received).toEqual([
      { status: 'ready', port: 8081, projectName: 'myapp', projectKind: 'bare-rn' },
    ]);
  });

  it('falls back to null name and unknown kind when no project is detected', () => {
    const fake = makeFakeController();
    const module = createMetroModule(fake.controller);

    const received: MetroStatusSnapshot[] = [];
    module.on('status', (snapshot) => received.push(snapshot));

    fake.set({ status: 'starting', port: null, project: null });
    fake.fireStatus();

    expect(received).toEqual([
      { status: 'starting', port: null, projectName: null, projectKind: 'unknown' },
    ]);
  });
});
