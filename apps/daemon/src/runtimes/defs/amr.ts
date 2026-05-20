import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

// AMR is the vela CLI's ACP stdio mode. `vela agent run --runtime opencode`
// starts a private OpenCode server and forwards stream-json over ACP JSON-RPC.
// Required env (set on the daemon process or via Settings → CLI env):
//   VELA_RUNTIME_KEY  — OpenRouter (or compatible) API key
//   VELA_LINK_URL     — OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1
//   VELA_OPENCODE_BIN — optional; absolute path to opencode when not on PATH
// See docs/new-agent-runtime-acp.md and the vela
// `specs/current/runtime/manual-agent-run-openrouter.md`.
export const amrAgentDef = {
  id: 'amr',
  name: 'AMR (vela)',
  bin: 'vela',
  versionArgs: ['--version'],
  fetchModels: async (resolvedBin, env) =>
    detectAcpModels({
      bin: resolvedBin,
      args: ['agent', 'run', '--runtime', 'opencode'],
      env,
      timeoutMs: 20_000,
      defaultModelOption: DEFAULT_MODEL_OPTION,
    }),
  // OpenRouter-backed defaults. vela's e2e baseline uses gpt-5.4-mini; the
  // other entries are common OpenRouter ids that work via the same
  // OpenAI-compatible endpoint.
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'openai/gpt-5.4-mini', label: 'gpt-5.4-mini (openrouter · default)' },
    { id: 'openai/gpt-5.4', label: 'gpt-5.4 (openrouter)' },
    { id: 'anthropic/claude-3.7-sonnet', label: 'claude-3.7-sonnet (openrouter)' },
    { id: 'google/gemini-2.5-pro', label: 'gemini-2.5-pro (openrouter)' },
  ],
  buildArgs: () => ['agent', 'run', '--runtime', 'opencode'],
  streamFormat: 'acp-json-rpc',
} satisfies RuntimeAgentDef;
