import { z } from 'zod';
import type {
  CdpConsoleEntry,
  CdpNetworkEvent,
  DoctorReport,
  MetroLogEvent,
  MetroStatus,
  ProjectKind,
} from '@icarus/core';

/**
 * The IPC contract shared by main, preload, and renderer. This is the single trust
 * boundary (ADR-0004): every channel is explicitly listed here with a runtime input
 * schema (Zod), and anything not registered is rejected. Types flow end-to-end (ADR-0003)
 * so both sides speak the same shapes.
 *
 * Walking-skeleton scope (ADR-0009): query + command only. No subscription/streaming yet.
 * Kept in `src/shared/` rather than a package until a second consumer justifies extraction
 * (Review A-3).
 */
export const CHANNELS = {
  /** Query (read, no side effect): run the environment doctor. */
  DOCTOR_CHECK: 'query:doctor.check',
  /** Command (intent): echo a message back — exercises the command + validation path. */
  APP_ECHO: 'command:app.echo',
  /** Command: connect to a running RN app and start streaming its console logs (E-14). */
  CDP_CONNECT: 'command:cdp.connect',
  /** Command: tear down the live CDP session. */
  CDP_DISCONNECT: 'command:cdp.disconnect',
  /** Command: start Metro for the given project directory (E-08). */
  METRO_START: 'command:metro.start',
  /** Command: stop the running Metro process (E-08). */
  METRO_STOP: 'command:metro.stop',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * One-way main → renderer push channels (streamed via webContents.send, not the
 * request/response router). This is the first streaming IPC — justified by a real stream
 * (live logs), per ADR-0009.
 */
export const EVENTS = {
  CDP_LOG: 'event:cdp.log',
  CDP_STATUS: 'event:cdp.status',
  CDP_NETWORK: 'event:cdp.network',
  METRO_LOG: 'event:metro.log',
  METRO_STATUS: 'event:metro.status',
} as const;

export type CdpConnectionStatus =
  'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';

/** Whether the running RN app supports CDP `Network.enable` (RN ≥ 0.76). */
export type CdpNetworkSupport = 'available' | 'unavailable';

export type CdpLogEvent = CdpConsoleEntry;
export type CdpNetworkEventOut = CdpNetworkEvent;
export interface CdpStatusEvent {
  readonly status: CdpConnectionStatus;
  readonly detail?: string;
  readonly networkSupport?: CdpNetworkSupport;
}

// --- query:doctor.check ---
export const doctorCheckInputSchema = z.void();
export type DoctorCheckInput = z.infer<typeof doctorCheckInputSchema>;
export type DoctorCheckOutput = DoctorReport;

// --- command:app.echo ---
export const appEchoInputSchema = z.object({
  message: z.string().min(1).max(500),
});
export type AppEchoInput = z.infer<typeof appEchoInputSchema>;
export interface AppEchoOutput {
  readonly echoed: string;
  readonly at: string;
}

// --- command:cdp.connect / cdp.disconnect ---
export const cdpConnectInputSchema = z.void();
export const cdpDisconnectInputSchema = z.void();
export interface CdpCommandOutput {
  readonly status: CdpConnectionStatus;
}

// --- command:metro.start / metro.stop (E-08) ---
export const metroStartInputSchema = z.object({
  cwd: z.string().min(1),
});
export type MetroStartInput = z.infer<typeof metroStartInputSchema>;
export type { MetroStatus, ProjectKind };
export interface MetroStartOutput {
  readonly status: MetroStatus;
  readonly port: number | null;
  readonly projectName: string | null;
  readonly projectKind: ProjectKind;
}
export const metroStopInputSchema = z.void();

export type MetroLogEventOut = MetroLogEvent;
export interface MetroStatusEvent {
  readonly status: MetroStatus;
  readonly port: number | null;
  readonly projectName: string | null;
  readonly projectKind: ProjectKind;
}
