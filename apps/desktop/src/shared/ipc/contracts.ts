import { z } from 'zod';
import type { CdpConsoleEntry, DoctorReport } from '@icarus/core';

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
} as const;

export type CdpConnectionStatus =
  'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';

export type CdpLogEvent = CdpConsoleEntry;
export interface CdpStatusEvent {
  readonly status: CdpConnectionStatus;
  readonly detail?: string;
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
