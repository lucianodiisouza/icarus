/**
 * THROWAWAY live smoke for the M2 AI assistant (E-13). Exercises the real path end-to-end
 * (minus Electron): seed captured context → E-12 boundary → live Anthropic call via
 * `@icarus/ai` → streamed grounded answer. Mirrors exactly what `AssistantBridge.send` does.
 *
 * NOT a unit test. Skips unless `ANTHROPIC_API_KEY` is set, so it's inert in CI / normal
 * runs. This is the live-key validation step called out in the M2 closeout as the residual
 * on exit criterion #1 — the engineering exit criteria are met, what remains is a real run
 * against a live model with a BYOK key.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @icarus/desktop exec tsx scripts/live-assistant-smoke.ts
 * See scripts/README.md for the full recipe.
 */
import { createAnthropicProvider, DEFAULT_MODEL } from '@icarus/ai';
import {
  askWithPayload,
  buildAiSendPayload,
  buildContextBundle,
  collectAnswer,
} from '@icarus/core';

const KEY = process.env['ANTHROPIC_API_KEY'];

// The crash exists ONLY in the "captured" logs — never in the question. A grounded answer must
// name it. A secret sits in the same context; the boundary must strip it before egress.
const CAPTURED_ERROR = 'TypeError: undefined is not an object (evaluating user.profile.name)';
const SECRET = 'authToken=sk-abcdefghijklmnop1234';
const QUESTION = 'why did my app crash?';

async function main(): Promise<void> {
  if (!KEY) {
    console.log('ANTHROPIC_API_KEY not set — skipping live smoke. (This is normal in CI.)');
    return;
  }

  const payload = buildAiSendPayload(
    buildContextBundle({
      question: QUESTION,
      logs: [
        { source: 'cdp', level: 'error', text: CAPTURED_ERROR, timestampMs: 1 },
        { source: 'cdp', level: 'info', text: SECRET, timestampMs: 2 },
      ],
    }),
  );

  console.log('\n── Redacted payload (exactly what leaves the machine) ──\n' + payload.text);
  console.log(`\napproxTokens: ${payload.approxTokens} · redacted: ${payload.report.total}`);

  // The boundary must hold before we ever hit the network.
  if (payload.text.includes('sk-abcdefghijklmnop1234')) {
    throw new Error('M2 canary failed: planted secret crossed the boundary. Aborting.');
  }

  const provider = createAnthropicProvider({ apiKey: KEY });
  const t0 = Date.now();
  const answer = await collectAnswer(askWithPayload(payload, { provider }));
  console.log(`\n── Claude (${DEFAULT_MODEL}) answered in ${Date.now() - t0}ms ──\n${answer}\n`);

  const grounded = /profile\.name|TypeError/i.test(answer);
  console.log(grounded ? '✓ grounded on the captured error' : '⚠ answer did not obviously cite it');

  // A live model won't be word-for-word deterministic, so assert the smoke essentials:
  // a non-empty answer came back and the secret never left the machine.
  if (answer.trim().length === 0) {
    throw new Error('Model returned an empty answer — investigate before trusting the live path.');
  }
}

main().catch((err) => {
  console.error('Live smoke failed:', err);
  process.exit(1);
});
