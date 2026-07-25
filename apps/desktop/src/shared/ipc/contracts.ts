import { z } from 'zod';
import type { DoctorReport } from '@icarus/core';

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
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

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
