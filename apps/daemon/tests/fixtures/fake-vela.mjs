#!/usr/bin/env node
/**
 * Fake `vela agent run --runtime opencode` ACP stdio runtime.
 *
 * Used by the AMR ACP integration test. Speaks just enough of the ACP
 * JSON-RPC protocol to drive Open Design's `detectAcpModels` and
 * `attachAcpSession` through a complete turn:
 *
 *   initialize           → { protocolVersion, agentCapabilities, models }
 *   session/new          → { sessionId, models: { currentModelId, availableModels } }
 *   session/set_model    → {}
 *   session/prompt       → emits session/update notifications, then
 *                          { stopReason: 'end_turn', usage }
 *
 * Behaviour can be tweaked through env vars set by the test:
 *   FAKE_VELA_SESSION_ID    – session id returned by session/new
 *   FAKE_VELA_TEXT          – assistant text streamed back to the host
 *   FAKE_VELA_THOUGHT       – optional thought chunk streamed before text
 */

import { stdin, stdout, stderr, env } from 'node:process';

const SESSION_ID = env.FAKE_VELA_SESSION_ID || 'fake-vela-session-1';
const ASSISTANT_TEXT = env.FAKE_VELA_TEXT || 'Hello from fake vela.';
const THOUGHT_TEXT = env.FAKE_VELA_THOUGHT || '';
const AVAILABLE_MODELS = [
  { modelId: 'openai/gpt-5.4-mini', name: 'gpt-5.4-mini' },
  { modelId: 'anthropic/claude-3.7-sonnet', name: 'claude-3.7-sonnet' },
];

let currentModelId = 'openai/gpt-5.4-mini';

function writeMessage(obj) {
  stdout.write(`${JSON.stringify(obj)}\n`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function writeNotification(method, params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function logDiag(line) {
  stderr.write(`[fake-vela] ${line}\n`);
}

function emitSessionUpdates(sessionId) {
  if (THOUGHT_TEXT) {
    writeNotification('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: THOUGHT_TEXT },
      },
    });
  }
  const chunks = ASSISTANT_TEXT.match(/.{1,16}/gs) || [ASSISTANT_TEXT];
  for (const chunk of chunks) {
    writeNotification('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: chunk },
      },
    });
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      writeResult(id, {
        protocolVersion: 1,
        agentCapabilities: { promptCapabilities: { embeddedContext: false } },
        models: {
          currentModelId,
          availableModels: AVAILABLE_MODELS,
        },
      });
      return;
    case 'session/new':
      writeResult(id, {
        sessionId: SESSION_ID,
        models: {
          currentModelId,
          availableModels: AVAILABLE_MODELS,
        },
      });
      return;
    case 'session/set_model': {
      const next = typeof params?.modelId === 'string' ? params.modelId.trim() : '';
      if (next) currentModelId = next;
      writeResult(id, {});
      return;
    }
    case 'session/set_config_option':
      writeResult(id, {});
      return;
    case 'session/prompt': {
      const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : SESSION_ID;
      emitSessionUpdates(sessionId);
      writeResult(id, {
        stopReason: 'end_turn',
        usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      });
      return;
    }
    case 'session/cancel':
      logDiag('session/cancel received');
      return;
    default:
      if (typeof id !== 'undefined') {
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `unknown method: ${method}` },
        });
      }
      return;
  }
}

let buffer = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      logDiag(`bad json on stdin: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    handleMessage(parsed);
  }
});

stdin.on('end', () => {
  stdout.end();
  // Mirror real ACP runtimes that exit on EOF so the host's child.on('close')
  // fires promptly and the chat run can finalize.
  process.exit(0);
});
