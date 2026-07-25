import type {
  AppEchoInput,
  AppEchoOutput,
  CdpCommandOutput,
  CdpLogEvent,
  CdpStatusEvent,
  DoctorCheckOutput,
} from './contracts.js';

export type Unsubscribe = () => void;

/**
 * The narrow, typed surface the preload bridge exposes to the renderer as `window.icarus`
 * (ADR-0004). The renderer never touches raw `ipcRenderer`; it calls these methods only.
 */
export interface IcarusApi {
  /** Run the environment doctor and return its report. */
  doctorCheck(): Promise<DoctorCheckOutput>;
  /** Echo a message (demonstrates the validated command path). */
  appEcho(input: AppEchoInput): Promise<AppEchoOutput>;

  /** Connect to a running RN app and start streaming its console logs (E-14). */
  cdpConnect(): Promise<CdpCommandOutput>;
  /** Tear down the live CDP session. */
  cdpDisconnect(): Promise<CdpCommandOutput>;
  /** Subscribe to live console log entries. Returns an unsubscribe function. */
  onCdpLog(handler: (entry: CdpLogEvent) => void): Unsubscribe;
  /** Subscribe to CDP connection-status changes. Returns an unsubscribe function. */
  onCdpStatus(handler: (status: CdpStatusEvent) => void): Unsubscribe;
}

declare global {
  interface Window {
    readonly icarus: IcarusApi;
  }
}
