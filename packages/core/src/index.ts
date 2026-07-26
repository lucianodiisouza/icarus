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
export type { ProcessManagerOptions } from './process/process-manager.js';
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

// Cross-launch orphan reaper (TR-2, TD-11)
export { FileOrphanRegistry, reapOrphans } from './process/orphan-registry.js';
export type {
  OrphanRecord,
  OrphanRegistry,
  OrphanSpawn,
  ProcessIdentityProbe,
  KillGroup,
  RegistryStore,
  ReapReport,
} from './process/orphan-registry.js';
export {
  psIdentityProbe,
  killProcessGroup,
  fileRegistryStore,
} from './process/os-process-probe.js';

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

// Unified-log disk persistence (TD-19, OQ-9): bounded, local-only, crash-recoverable.
export { UnifiedLogPersistence } from './unified-log/log-persistence.js';
export type { UnifiedLogPersistenceOptions } from './unified-log/log-persistence.js';
export { fileStore } from './persistence/file-store.js';
export type { FileStore } from './persistence/file-store.js';

// AI data-boundary (E-12): the redaction pass — scrubs secrets/PII before anything can be sent.
export { redact } from './ai/redaction/redact.js';
export type { RedactionCategory, RedactionHit, RedactionResult } from './ai/redaction/redact.js';
export { aggregateHits } from './ai/boundary/report.js';
export type { RedactionReport } from './ai/boundary/report.js';
export { buildContextBundle } from './ai/boundary/context-bundle.js';
export type {
  ContextBundle,
  ContextBundleInput,
  ContextBundleOptions,
} from './ai/boundary/context-bundle.js';
export { buildAiSendPayload, serializeContext } from './ai/boundary/send-payload.js';
export type { SendPayload } from './ai/boundary/send-payload.js';

// AI provider seam (E-13, ADR-0011) + the grounded-assistant orchestrator.
export type { AIProvider, AiRequest, AiChunk } from './ai/provider.js';
export { askAssistant, collectAnswer, DEFAULT_SYSTEM_PROMPT } from './ai/assistant.js';
export type { AskAssistantDeps, AssistantExchange } from './ai/assistant.js';

// Secure BYOK key storage (E-13, T-13.3): OS-encrypted, never plaintext, never transmitted.
export { EncryptedKeyStore } from './ai/key-store.js';
export type { KeyStore, Encryptor } from './ai/key-store.js';

// Streaming primitive (E-03s, ADR-0006): snapshot + batched deltas with backpressure.
export { StreamBatcher } from './streaming/stream-batcher.js';
export type { StreamBatcherOptions } from './streaming/stream-batcher.js';
export { RingBuffer } from './streaming/ring-buffer.js';
export { UnifiedLogStream } from './streaming/unified-log-stream.js';
export type {
  UnifiedLogDelta,
  LogEntrySource,
  UnifiedLogStreamOptions,
} from './streaming/unified-log-stream.js';

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
export type {
  MetroModule,
  MetroModuleEvents,
  MetroStatusSnapshot,
} from './feature-module/metro-module.js';
export { createUnifiedLogModule } from './feature-module/unified-log-module.js';
export type {
  UnifiedLogModule,
  UnifiedLogModuleEvents,
} from './feature-module/unified-log-module.js';
export { createDevicesModule } from './feature-module/devices-module.js';
export type { DevicesModule, DevicesModuleEvents } from './feature-module/devices-module.js';
