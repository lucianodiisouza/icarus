import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, EVENTS, type AppEchoInput } from '../shared/ipc/contracts.js';
import type { CdpLogEvent, CdpStatusEvent } from '../shared/ipc/contracts.js';
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
  onCdpStatus: (handler: (status: CdpStatusEvent) => void) => subscribe(EVENTS.CDP_STATUS, handler),
};

contextBridge.exposeInMainWorld('icarus', api);
