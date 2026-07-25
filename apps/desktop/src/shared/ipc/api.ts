import type { AppEchoInput, AppEchoOutput, DoctorCheckOutput } from './contracts.js';

/**
 * The narrow, typed surface the preload bridge exposes to the renderer as `window.icarus`
 * (ADR-0004). The renderer never touches raw `ipcRenderer`; it calls these methods only.
 */
export interface IcarusApi {
  /** Run the environment doctor and return its report. */
  doctorCheck(): Promise<DoctorCheckOutput>;
  /** Echo a message (demonstrates the validated command path). */
  appEcho(input: AppEchoInput): Promise<AppEchoOutput>;
}

declare global {
  interface Window {
    readonly icarus: IcarusApi;
  }
}
