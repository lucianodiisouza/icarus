import type {
  AppEchoInput,
  AppEchoOutput,
  CdpCommandOutput,
  CdpLogEvent,
  CdpNetworkEventOut,
  CdpStatusEvent,
  DoctorCheckOutput,
  DevicesLaunchOutput,
  MetroLogEventOut,
  MetroStartInput,
  MetroStartOutput,
  MetroStatusEvent,
} from './contracts.js';
import type {
  DevicesBootInput,
  DevicesInstallInput,
  DevicesLaunchInput,
  DevicesListOutput,
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
  /** Subscribe to live network events (E-14 slice 5). */
  onCdpNetwork(handler: (event: CdpNetworkEventOut) => void): Unsubscribe;
  /** Subscribe to CDP connection-status changes. Returns an unsubscribe function. */
  onCdpStatus(handler: (status: CdpStatusEvent) => void): Unsubscribe;

  /** Start the Metro dev server for a project (E-08). */
  metroStart(input: MetroStartInput): Promise<MetroStartOutput>;
  /** Stop the running Metro dev server. */
  metroStop(): Promise<void>;
  /** Subscribe to live Metro stdout/stderr lines. */
  onMetroLog(handler: (event: MetroLogEventOut) => void): Unsubscribe;
  /** Subscribe to Metro status changes. */
  onMetroStatus(handler: (status: MetroStatusEvent) => void): Unsubscribe;

  /** List the available iOS simulators (E-09). */
  devicesList(): Promise<DevicesListOutput>;
  /** Boot a simulator by UDID. */
  devicesBoot(input: DevicesBootInput): Promise<void>;
  /** Install an .app bundle on a simulator. */
  devicesInstall(input: DevicesInstallInput): Promise<void>;
  /** Launch an installed app on a simulator. */
  devicesLaunch(input: DevicesLaunchInput): Promise<DevicesLaunchOutput>;
}

declare global {
  interface Window {
    readonly icarus: IcarusApi;
  }
}
