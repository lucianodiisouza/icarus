import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolProbeResult, ToolRunner } from './types.js';

const run = promisify(execFile);

/**
 * Real ToolRunner: resolves a command's path via `which` (POSIX) / `where` (Windows) and
 * reads its version via `<command> <versionArgs>`. Best-effort and side-effect-free — any
 * failure resolves to a null field rather than throwing, so a missing tool is a finding,
 * not an exception (TR-4). Uses only Node built-ins — Electron-free (ADR-0002).
 */
export class NodeToolRunner implements ToolRunner {
  readonly platform: NodeJS.Platform = process.platform;

  async probe(command: string, versionArgs: readonly string[]): Promise<ToolProbeResult> {
    const path = await this.#resolvePath(command);
    if (path === null) {
      return { path: null, versionOutput: null };
    }
    const versionOutput = await this.#readVersion(command, versionArgs);
    return { path, versionOutput };
  }

  async #resolvePath(command: string): Promise<string | null> {
    const locator = this.platform === 'win32' ? 'where' : 'which';
    try {
      const { stdout } = await run(locator, [command], { timeout: 4000 });
      const first = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      return first ?? null;
    } catch {
      return null;
    }
  }

  async #readVersion(command: string, versionArgs: readonly string[]): Promise<string | null> {
    try {
      const { stdout, stderr } = await run(command, [...versionArgs], { timeout: 4000 });
      const out = (stdout || stderr)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      return out ?? null;
    } catch {
      return null;
    }
  }
}
