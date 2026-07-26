import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileStore } from './file-store.js';

describe('fileStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'icarus-filestore-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads null before anything is written, then round-trips', async () => {
    const store = fileStore(join(dir, 'log.json'));
    expect(await store.read()).toBeNull();

    await store.write('[1,2,3]');
    expect(await store.read()).toBe('[1,2,3]');
  });

  it('clear() removes the file and is a no-op when already absent', async () => {
    const path = join(dir, 'log.json');
    const store = fileStore(path);

    await store.write('data');
    await store.clear();
    expect(await store.read()).toBeNull();
    await expect(readFile(path, 'utf8')).rejects.toThrow(); // file is gone

    // Clearing again must not throw (missing file → no-op).
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
