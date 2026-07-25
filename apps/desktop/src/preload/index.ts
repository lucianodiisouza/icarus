import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type AppEchoInput } from '../shared/ipc/contracts.js';
import type { IcarusApi } from '../shared/ipc/api.js';

/**
 * Preload bridge (ADR-0004). Exposes a narrow, typed `window.icarus` API — NOT raw
 * `ipcRenderer`. The renderer can only call these specific, allowlisted channels; it has
 * no general IPC or Node access.
 */
const api: IcarusApi = {
  doctorCheck: () => ipcRenderer.invoke(CHANNELS.DOCTOR_CHECK),
  appEcho: (input: AppEchoInput) => ipcRenderer.invoke(CHANNELS.APP_ECHO, input),
};

contextBridge.exposeInMainWorld('icarus', api);
