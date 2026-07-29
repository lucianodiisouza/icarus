# Icarus — developer scripts

Throwaway / out-of-band scripts a developer runs by hand. **Not part of the test suite.**
Each one is a recipe — copy/edit/run, then throw it away.

## `live-assistant-smoke.ts`

**THROWAWAY** live smoke for the M2 AI assistant (E-13). Exercises the real path
end-to-end (minus Electron): seed captured context → E-12 boundary → live
Anthropic call via `@icarus/ai` → streamed grounded answer. Mirrors exactly
what `AssistantBridge.send` does.

**Skips unless `ANTHROPIC_API_KEY` is set**, so it's inert in CI / normal runs.
You need a real Anthropic API key and a willingness to spend a few cents.

```bash
# From the repo root:
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @icarus/desktop exec tsx scripts/live-assistant-smoke.ts
```

What it prints:

1. The exact redacted bytes that would be sent (the M3 canary equivalent for AI).
2. The model's streamed answer.
3. A grounded-or-not verdict.

This is the live-key validation step called out in the [M2 closeout][m2] as the
residual on exit criterion #1 ("the engineering exit criteria are met; what
remains is validation — a real run against a live model with a BYOK key").

[m2]: ../docs/engineering/reports/m2-closeout.md
