/**
 * Integration coverage for the AMR (vela) ACP runtime def.
 *
 * Spawns the fake vela stub at tests/fixtures/fake-vela.mjs (which speaks
 * just enough ACP JSON-RPC to drive one turn) and verifies the daemon's
 * `attachAcpSession` + `detectAcpModels` can walk through initialize →
 * session/new → session/set_model → session/prompt without hand-stubbing
 * the child stream.
 *
 * The runtime def itself (apps/daemon/src/runtimes/defs/amr.ts) is a pure
 * data record, so this test also pins the contract the def declares:
 *   - id, bin, streamFormat are stable for downstream consumers
 *   - buildArgs() emits the vela invocation shape the docs describe
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { attachAcpSession, detectAcpModels } from '../src/acp.js';
import { amrAgentDef } from '../src/runtimes/defs/amr.js';
import { getAgentDef } from '../src/runtimes/registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_VELA = path.join(HERE, 'fixtures', 'fake-vela.mjs');

function spawnFakeVela(env: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(process.execPath, [FAKE_VELA], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.once('exit', () => resolve());
  });
}

describe('AMR runtime def', () => {
  it('is registered with the expected ACP wiring', () => {
    const def = getAgentDef('amr');
    expect(def).toBeTruthy();
    expect(def?.id).toBe('amr');
    expect(def?.bin).toBe('vela');
    expect(def?.streamFormat).toBe('acp-json-rpc');
  });

  it('builds the documented `vela agent run --runtime opencode` argv', () => {
    expect(amrAgentDef.buildArgs('', [])).toEqual([
      'agent',
      'run',
      '--runtime',
      'opencode',
    ]);
  });

  it('declares OpenRouter-flavored fallback models including the vela baseline', () => {
    const ids = amrAgentDef.fallbackModels.map((m) => m.id);
    expect(ids).toContain('default');
    expect(ids).toContain('openai/gpt-5.4-mini');
  });
});

describe('AMR ACP transport — end-to-end against fake vela stub', () => {
  it('drives a complete turn: initialize → session/new → session/prompt', async () => {
    const child = spawnFakeVela({
      FAKE_VELA_TEXT: 'Hello from AMR.',
      FAKE_VELA_THOUGHT: 'thinking-chunk',
    });
    const events: Array<{ event: string; payload: unknown }> = [];
    try {
      const session = attachAcpSession({
        child: child as never,
        prompt: 'Say hello',
        cwd: process.cwd(),
        model: null,
        mcpServers: [],
        send: (event, payload) => {
          events.push({ event, payload });
        },
      });

      // attachAcpSession owns the stdin lifecycle: it sends initialize on
      // construction and ends stdin after session/prompt completes. We just
      // wait for the child to exit on its own.
      await waitForExit(child);
      expect(session.hasFatalError()).toBe(false);
      expect(session.completedSuccessfully()).toBe(true);
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
    }

    const textDeltas = events
      .filter((e) => {
        const payload = e.payload as { type?: unknown };
        return e.event === 'agent' && payload.type === 'text_delta';
      })
      .map((e) => (e.payload as { delta?: unknown }).delta);

    expect(textDeltas.join('')).toBe('Hello from AMR.');

    const thinkingDeltas = events
      .filter((e) => {
        const payload = e.payload as { type?: unknown };
        return e.event === 'agent' && payload.type === 'thinking_delta';
      })
      .map((e) => (e.payload as { delta?: unknown }).delta);
    expect(thinkingDeltas.join('')).toBe('thinking-chunk');
  });

  it('detectAcpModels surfaces availableModels from the vela ACP session/new response', async () => {
    const result = await detectAcpModels({
      bin: process.execPath,
      args: [FAKE_VELA],
      env: process.env,
      timeoutMs: 10_000,
      defaultModelOption: { id: 'default', label: 'Default (CLI config)' },
    });
    const ids = (result || []).map((m) => m.id);
    expect(ids).toContain('default');
    expect(ids).toContain('openai/gpt-5.4-mini');
    expect(ids).toContain('anthropic/claude-3.7-sonnet');
  });
});
