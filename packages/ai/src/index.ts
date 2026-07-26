/**
 * Public API of @icarus/ai — AI provider implementations behind `@icarus/core`'s
 * swappable `AIProvider` interface (E-13, ADR-0011). Electron-free; this package is the
 * only place the Anthropic SDK and network egress live.
 */
export { createAnthropicProvider, DEFAULT_MODEL } from './anthropic-provider.js';
export type { AnthropicProviderOptions, AnthropicLike } from './anthropic-provider.js';
