/**
 * Project detection for the `metro` module (E-08). Reads a `package.json` and decides
 * whether the directory is a bare React Native project, an Expo project, or neither.
 * Pure, Electron-free (ADR-0002); the filesystem read is the only side effect, and it's
 * injected so tests don't need real files.
 *
 * The distinction matters for two reasons:
 *   1. The CLI to start the dev server differs (`react-native start` vs `expo start`).
 *   2. Expo projects have additional capabilities (tunneling, dev-client variants) we
 *      may want to surface later.
 *
 * For v1 we still launch the same `react-native start` for both kinds — Expo's CLI
 * delegates to it under the hood in modern setups, and the user just wants it to
 * work. The detection is still worth doing so we can label the UI correctly and pick
 * the right command if we later diverge.
 */

export type ProjectKind = 'bare-rn' | 'expo' | 'unknown';

export interface DetectedProject {
  /** The directory we read (echoed for the caller's logs). */
  readonly cwd: string;
  /** npm package name from package.json, or null. */
  readonly name: string | null;
  /** What kind of project this is. */
  readonly kind: ProjectKind;
  /** Stable id for the eventual MetroController — derived from the project name + cwd. */
  readonly id: string;
}

/** Minimal package.json shape we care about — anything more would couple us to the schema. */
interface MinimalPackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

export interface DetectOptions {
  /**
   * Read the given path and return its UTF-8 text, or null if the file does not exist.
   * Injected so tests can avoid touching the real filesystem. Default: node:fs/promises.
   */
  readonly readFile?: (path: string) => Promise<string | null>;
}

const DEFAULT_READER = async (path: string): Promise<string | null> => {
  // Lazy import so this module is fully pure when the reader is injected (tests).
  const fs = await import('node:fs/promises');
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/** Pure classification — given a parsed package.json, what kind is it? */
export function classifyProject(pkg: MinimalPackageJson | null): ProjectKind {
  if (pkg === null) return 'unknown';
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  // `expo` is the modern indicator (Expo SDK 46+; bare projects don't have it).
  // `expo-cli` was the legacy indicator for older setups.
  if ('expo' in deps || 'expo-cli' in deps) return 'expo';
  // `react-native` is the bare-RN indicator. We require it (not just `react`).
  if ('react-native' in deps) return 'bare-rn';
  return 'unknown';
}

function safeParseJson(text: string): MinimalPackageJson | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    return value as MinimalPackageJson;
  } catch {
    return null;
  }
}

/** Stable id from a name + cwd — same input → same id, so we don't double-spawn. */
function projectId(name: string | null, cwd: string): string {
  return `metro-${name ?? 'unnamed'}-${cwd}`;
}

/**
 * Detect a project at the given cwd. Reads `<cwd>/package.json` and classifies it.
 * Never throws — bad/missing input is mapped to `kind: 'unknown'` so the caller can
 * present a clear error to the user instead of crashing.
 */
export async function detectProject(
  cwd: string,
  options: DetectOptions = {},
): Promise<DetectedProject> {
  const reader = options.readFile ?? DEFAULT_READER;
  const text = await reader(`${cwd}/package.json`);
  const pkg = text === null ? null : safeParseJson(text);
  const name = typeof pkg?.name === 'string' ? pkg.name : null;
  return {
    cwd,
    name,
    kind: classifyProject(pkg),
    id: projectId(name, cwd),
  };
}
