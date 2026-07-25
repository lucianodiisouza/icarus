import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  EVENTS,
  type AppEchoInput,
  type AutoAttachSetInput,
} from '../shared/ipc/contracts.js';
import type {
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpStatusEvent,
  MetroLogEventOut,
  MetroStartInput,
  MetroStatusEvent,
  UnifiedLogEntryOut,
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
  onMetroLog: (handler: (event: MetroLogEventOut) => void) => subscribe(EVENTS.METRO_LOG, handler),
  onMetroStatus: (handler: (status: MetroStatusEvent) => void) =>
    subscribe(EVENTS.METRO_STATUS, handler),
  devicesList: () => ipcRenderer.invoke(CHANNELS.DEVICES_LIST),
  devicesBoot: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_BOOT, input),
  devicesInstall: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_INSTALL, input),
  devicesLaunch: (input) => ipcRenderer.invoke(CHANNELS.DEVICES_LAUNCH, input),
  onUnifiedLog: (handler: (entry: UnifiedLogEntryOut) => void) =>
    subscribe(EVENTS.UNIFIED_LOG, handler),
  onModuleEvent: <T = unknown>(
    moduleId: string,
    eventName: string,
    handler: (envelope: { timestampMs: number; payload: T }) => void,
  ) => subscribe(`module.${moduleId}.event.${eventName}`, handler),
  autoAttachGet: () => ipcRenderer.invoke(CHANNELS.AUTO_ATTACH_GET),
  autoAttachSet: (input: AutoAttachSetInput) => ipcRenderer.invoke(CHANNELS.AUTO_ATTACH_SET, input),
};

contextBridge.exposeInMainWorld('icarus', api);
