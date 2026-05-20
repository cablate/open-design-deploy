import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createJsonIpcServer } from "@open-design/sidecar";
import { SIDECAR_EVENTS, SIDECAR_MESSAGES } from "@open-design/sidecar-proto";

import type { ToolDevConfig } from "../src/config.js";
import { inspect } from "../src/runtime/inspect.js";

async function makeTempConfig(): Promise<ToolDevConfig> {
  const root = await mkdtemp(path.join(tmpdir(), "od-tools-dev-inspect-"));
  const dataRoot = path.join(root, "data");
  return {
    apps: {
      daemon: {
        app: "daemon",
        ipcPath: path.join(root, "daemon.sock"),
        latestLogPath: path.join(root, "logs", "daemon", "latest.log"),
        logDir: path.join(root, "logs", "daemon"),
        sidecarEntryPath: path.join(root, "daemon-sidecar.ts"),
      },
      desktop: {
        app: "desktop",
        ipcPath: path.join(root, "desktop.sock"),
        latestLogPath: path.join(root, "logs", "desktop", "latest.log"),
        logDir: path.join(root, "logs", "desktop"),
        sidecarEntryPath: path.join(root, "desktop-dev-launcher.ts"),
      },
      web: {
        app: "web",
        ipcPath: path.join(root, "web.sock"),
        latestLogPath: path.join(root, "logs", "web", "latest.log"),
        logDir: path.join(root, "logs", "web"),
        nextDistDir: path.join(root, "runtime", "web", "next"),
        nextTsconfigPath: path.join(root, "runtime", "web", "tsconfig.json"),
        sidecarEntryPath: path.join(root, "workspace", "apps", "web", "sidecar", "index.ts"),
      },
    },
    bundlePath: null,
    dataRoot,
    namespace: "inspect-test",
    namespaceRoot: root,
    toolsDevRoot: root,
    tsxCliPath: "tsx",
    workspaceRoot: path.join(root, "workspace"),
  };
}

describe("tools-dev inspect events", () => {
  it("sends status through the generic sidecar event channel", async () => {
    const config = await makeTempConfig();
    let received: unknown = null;
    const server = await createJsonIpcServer({
      socketPath: config.apps.web.ipcPath,
      handler: async (message) => {
        received = message;
        return { state: "running", url: "http://127.0.0.1:1" };
      },
    });
    try {
      const result = await inspect(config, "web", "status", undefined, {});

      assert.deepEqual(received, {
        key: SIDECAR_EVENTS.INSPECT_STATUS,
        type: SIDECAR_MESSAGES.EVENT,
      });
      assert.deepEqual(result, { state: "running", url: "http://127.0.0.1:1" });
    } finally {
      await server.close();
    }
  });

  it("accepts JSON payloads for generic inspect events", async () => {
    const config = await makeTempConfig();
    let received: unknown = null;
    const server = await createJsonIpcServer({
      socketPath: config.apps.desktop.ipcPath,
      handler: async (message) => {
        received = message;
        return { path: "/tmp/shot.png" };
      },
    });
    try {
      const result = await inspect(config, "desktop", "inspect.screenshot", "{\"path\":\"/tmp/shot.png\"}", {});

      assert.deepEqual(received, {
        key: SIDECAR_EVENTS.INSPECT_SCREENSHOT,
        payload: { path: "/tmp/shot.png" },
        type: SIDECAR_MESSAGES.EVENT,
      });
      assert.deepEqual(result, { path: "/tmp/shot.png" });
    } finally {
      await server.close();
    }
  });

  it("quick-fails when the target sidecar IPC is not reachable", async () => {
    const config = await makeTempConfig();

    await assert.rejects(inspect(config, "web", "status", undefined, { timeout: "0.1" }), /web sidecar is not running/);
  });
});
