import { describe, expect, it } from 'vitest';
import { classifyProject, detectProject } from './detect-project.js';

const reader =
  (map: Record<string, string | null>) =>
  (path: string): Promise<string | null> =>
    Promise.resolve(path in map ? (map[path] ?? null) : null);

describe('classifyProject', () => {
  it('returns "expo" when the expo dep is present', () => {
    expect(classifyProject({ dependencies: { expo: '~51.0.0' } })).toBe('expo');
  });
  it('returns "expo" when only expo-cli is present (legacy)', () => {
    expect(classifyProject({ devDependencies: { 'expo-cli': '^5.0.0' } })).toBe('expo');
  });
  it('returns "bare-rn" when react-native is present without expo', () => {
    expect(classifyProject({ dependencies: { 'react-native': '0.74.0' } })).toBe('bare-rn');
  });
  it('returns "unknown" for empty or null package.json', () => {
    expect(classifyProject(null)).toBe('unknown');
    expect(classifyProject({})).toBe('unknown');
    expect(classifyProject({ dependencies: { react: '18.2.0' } })).toBe('unknown');
  });
  it('prefers "expo" when both are present (Expo can host RN projects)', () => {
    expect(
      classifyProject({
        dependencies: { 'react-native': '0.74.0', expo: '~51.0.0' },
      }),
    ).toBe('expo');
  });
});

describe('detectProject', () => {
  it('reads <cwd>/package.json via the injected reader', async () => {
    const detected = await detectProject('/work/app', {
      readFile: reader({
        '/work/app/package.json': JSON.stringify({
          name: 'myapp',
          dependencies: { 'react-native': '0.74.0' },
        }),
      }),
    });
    expect(detected).toMatchObject({
      cwd: '/work/app',
      name: 'myapp',
      kind: 'bare-rn',
    });
    expect(detected.id).toBe('metro-myapp-/work/app');
  });

  it('handles a missing package.json gracefully (kind: "unknown")', async () => {
    const detected = await detectProject('/empty', { readFile: reader({}) });
    expect(detected.cwd).toBe('/empty');
    expect(detected.name).toBeNull();
    expect(detected.kind).toBe('unknown');
  });

  it('handles malformed JSON gracefully (kind: "unknown")', async () => {
    const detected = await detectProject('/broken', {
      readFile: reader({ '/broken/package.json': '{ this is not json' }),
    });
    expect(detected.kind).toBe('unknown');
    expect(detected.name).toBeNull();
  });

  it('produces a stable id for repeated calls with the same input', async () => {
    const r = reader({ '/a/package.json': JSON.stringify({ name: 'x' }) });
    const a = await detectProject('/a', { readFile: r });
    const b = await detectProject('/a', { readFile: r });
    expect(a.id).toBe(b.id);
  });
});
