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

// Process manager (G-2, TR-2)
export { ProcessManager } from './process/process-manager.js';
export { ManagedProcess } from './process/managed-process.js';
export { LineStream } from './process/line-stream.js';
export type {
  ExitInfo,
  LineEvent,
  ProcessSpec,
  ProcessState,
  ShutdownPolicy,
  StopOptions,
  StreamName,
} from './process/types.js';

// CDP transport (E-14, ADR-0008)
export { CdpClient, CdpError, httpOriginFromWsUrl } from './protocol/cdp/cdp-client.js';
export {
  discoverProxies,
  queryProxy,
  DEFAULT_METRO_PORTS,
  DEFAULT_HOST,
} from './protocol/cdp/discovery.js';
export { selectMainTarget, selectableTargets } from './protocol/cdp/target-selection.js';
export { CdpMultiplexer } from './protocol/cdp/multiplexer.js';
export type { SendFrame } from './protocol/cdp/multiplexer.js';
export { formatConsoleEvent, previewRemoteObject } from './protocol/cdp/console.js';
export type { CdpConsoleEntry } from './protocol/cdp/console.js';
export type {
  CdpTarget,
  ProxyDiscovery,
  CdpSocket,
  CdpSocketFactory,
  CdpClientOptions,
  FetchLike,
} from './protocol/cdp/types.js';
export type { DiscoverOptions } from './protocol/cdp/discovery.js';

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
