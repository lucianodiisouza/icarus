import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  EVENTS,
  SUBSCRIPTIONS,
  type AppEchoInput,
  type AutoAttachSetInput,
} from '../shared/ipc/contracts.js';
import type {
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpStatusEvent,
  MetroStartInput,
  UnifiedLogDeltaOut,
  AiKeySetInput,
  AiReviewInput,
  AiChunkEvent,
  AiErrorEvent,
  LogExportInput,
  LogExportOutput,
} from '../shared/ipc/contracts.js';
import type { IcarusApi, Unsubscribe } from '../shared/ipc/api.js';

/**
 * Preload bridge (ADR-0004). Exposes a narrow, typed `window.icarus` API — NOT raw
 * `ipcRenderer`. The renderer can only call these specific, allowlisted channels and
 * subscribe to specific push events; it has no general IPC or Node access.
 */
function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: IcarusApi = {
  doctorCheck: () => ipcRenderer.invoke(CHANNELS.DOCTOR_CHECK),
  appEcho: (input: AppEchoInput) => ipcRenderer.invoke(CHANNELS.APP_ECHO, input),
  cdpConnect: () => ipcRenderer.invoke(CHANNELS.CDP_CONNECT),
  cdpDisconnect: () => ipcRenderer.invoke(CHANNELS.CDP_DISCONNECT),
  onCdpLog: (handler: (entry: CdpLogEvent) => void) => subscribe(EVENTS.CDP_LOG, handler),
  onCdpNetwork: (handler: (event: CdpNetworkEventOut) => void) =>
    subscribe(EVENTS.CDP_NETWORK, handler),
  onCdpStatus: (handler: (status: CdpStatusEvent) => void) => subscribe(EVENTS.CDP_STATUS, handler),
  metroStart: (input: MetroStartInput) => ipcRenderer.invoke(CHANNELS.METRO_START, input),
  metroStop: () => ipcRenderer.invoke(CHANNELS.METRO_STOP),
  devicesList: () => ipcRenderer.invoke(CHANNELS.DEVICES_LIST),
  devicesBoot: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_BOOT, input),
  devicesInstall: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_INSTALL, input),
  devicesLaunch: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_LAUNCH, input),
  onModuleEvent: <T = unknown>(
    moduleId: string,
    eventName: string,
    handler: (envelope: { timestampMs: number; payload: T }) => void,
  ) => subscribe(`module.${moduleId}.event.${eventName}`, handler),
  unifiedLogSubscribe: () => ipcRenderer.invoke(SUBSCRIPTIONS.UNIFIED_LOG),
  unifiedLogUnsubscribe: () => ipcRenderer.invoke(SUBSCRIPTIONS.UNIFIED_LOG_STOP),
  onUnifiedLogDelta: (handler: (delta: UnifiedLogDeltaOut) => void) =>
    subscribe(EVENTS.UNIFIED_LOG_DELTA, handler),
  autoAttachGet: () => ipcRenderer.invoke(CHANNELS.AUTO_ATTACH_GET),
  autoAttachSet: (input: AutoAttachSetInput) => ipcRenderer.invoke(CHANNELS.AUTO_ATTACH_SET, input),
  aiKeyStatus: () => ipcRenderer.invoke(CHANNELS.AI_KEY_STATUS),
  aiKeySet: (input: AiKeySetInput) => ipcRenderer.invoke(CHANNELS.AI_KEY_SET, input),
  aiKeyClear: () => ipcRenderer.invoke(CHANNELS.AI_KEY_CLEAR),
  aiReview: (input: AiReviewInput) => ipcRenderer.invoke(SUBSCRIPTIONS.AI_REVIEW, input),
  aiSend: () => ipcRenderer.invoke(SUBSCRIPTIONS.AI_SEND),
  onAiChunk: (handler: (chunk: AiChunkEvent) => void) => subscribe(EVENTS.AI_CHUNK, handler),
  onAiDone: (handler: () => void) => subscribe(EVENTS.AI_DONE, () => handler()),
  onAiError: (handler: (error: AiErrorEvent) => void) => subscribe(EVENTS.AI_ERROR, handler),
  /**
   * Write the captured unified log to a user-chosen file (E-15, M3 first slice).
   * Opt-in: the user clicks the Export button → Save dialog → file written. Resolves with the
   * path + the redaction report. Rejects (with `ExportCancelledError`) if the user cancels
   * the dialog — the renderer treats that as a silent no-op.
   */
  logExport: (input: LogExportInput) =>
    ipcRenderer.invoke(CHANNELS.LOG_EXPORT, input) as Promise<LogExportOutput>,
};

contextBridge.exposeInMainWorld('icarus', api);
