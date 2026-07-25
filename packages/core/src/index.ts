/**
 * Public API of @icarus/core — the shell-agnostic heart of Icarus.
 * MUST stay Electron-free (ADR-0002; enforced by the boundary lint rule).
 */

// Event bus
export { EventBus } from './event-bus/event-bus.js';
export type { EventMap, Unsubscribe } from './event-bus/event-bus.js';

// Logger
export { Logger, consoleSink } from './logger/logger.js';
export type { LogLevel, LogRecord, LogSink, LoggerOptions } from './logger/logger.js';

// Debug context store (the shared model — G-3)
export { DebugContextStore } from './context-store/debug-context-store.js';

// Environment doctor (TR-4)
export { runDoctor, parseVersion } from './doctor/doctor.js';
export { NodeToolRunner } from './doctor/tool-runner.js';
export type { RunDoctorOptions } from './doctor/doctor.js';
export type {
  CheckSeverity,
  CheckStatus,
  DoctorCheck,
  DoctorReport,
  OverallStatus,
  ToolProbeResult,
  ToolRunner,
} from './doctor/types.js';
