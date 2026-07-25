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
export { formatNetworkEvent, NETWORK_EVENTS } from './protocol/cdp/network.js';
export type { CdpNetworkEvent, CdpNetworkEventKind } from './protocol/cdp/network.js';
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

// Project detection (E-08)
export { detectProject, classifyProject } from './detect-project/detect-project.js';
export type {
  DetectedProject,
  DetectOptions,
  ProjectKind,
} from './detect-project/detect-project.js';

// Metro controller (E-08)
export { MetroController, buildMetroCommand, extractMetroPort } from './metro/metro-controller.js';
export type {
  MetroControllerDeps,
  MetroLogEvent,
  MetroProcess,
  MetroStarted,
  MetroStatus,
} from './metro/metro-controller.js';

// Devices / simulators (E-09)
export { parseSimctlListDevices, makeProcessSimctlExecutor } from './devices/ios-simctl.js';
export type { SimDevice, SimctlExecutor } from './devices/ios-simctl.js';
export { DevicesController } from './devices/devices-controller.js';
export type { DevicesControllerDeps } from './devices/devices-controller.js';

// Unified log pipeline (E-10)
export { UnifiedLogController } from './unified-log/unified-log-controller.js';
export { fuseCdp, fuseMetro, fuseNative } from './unified-log/unified-log-fuser.js';
export type {
  UnifiedLogEntry,
  UnifiedLogLevel,
  UnifiedLogSource,
} from './unified-log/unified-log.js';
export type { UnifiedEntryHandler } from './unified-log/unified-log-controller.js';

// iOS syslog (E-10 native source)
export {
  IosSyslogSource,
  InMemoryNativeLogSource,
  parseSyslogLine,
} from './native-logs/ios-syslog.js';
export type { NativeLogSourceLike, NativeLogExecutor } from './native-logs/ios-syslog.js';

// Feature-module contract (E-05) and module wrappers (TD-14/15)
export { defineFeatureModule } from './feature-module/feature-module.js';
export type { FeatureModule, ModuleContext } from './feature-module/feature-module.js';
export { ModuleRegistry } from './feature-module/module-registry.js';
export { createMetroModule } from './feature-module/metro-module.js';
export type { MetroModule, MetroModuleEvents } from './feature-module/metro-module.js';
export { createUnifiedLogModule } from './feature-module/unified-log-module.js';
export type {
  UnifiedLogModule,
  UnifiedLogModuleEvents,
} from './feature-module/unified-log-module.js';
export { createDevicesModule } from './feature-module/devices-module.js';
export type { DevicesModule, DevicesModuleEvents } from './feature-module/devices-module.js';
