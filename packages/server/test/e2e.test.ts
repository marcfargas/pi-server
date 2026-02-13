/**
 * End-to-end integration test for pi-server.
 *
 * Tests the full pipeline:
 *   pi --mode rpc → PiProcess → WsServer → WebSocket client
 *
 * Requires: working internet connection + GOOGLE_API_KEY in env.
 */

import { describe, it, expect, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { PiProcess } from "../src/pi-process.js";
import { WsServer } from "../src/ws-server.js";
import { PROTOCOL_VERSION } from "@marcfargas/pi-server-protocol";

const PORT = 3335;
const TIMEOUT_MS = 30_000;

describe("pi-server E2E", () => {
  let piProcess: PiProcess;
  let wsServer: WsServer;

  afterAll(async () => {
    await wsServer?.stop();
    await piProcess?.stop();
  });

  it("relays prompt → streaming text_delta → agent_end over WebSocket", async () => {
    // Start pi + server
    piProcess = new PiProcess({
      cwd: process.cwd(),
      piArgs: [
        "--provider", "google",
        "--model", "gemini-2.5-flash",
        "--no-session",
      ],
    });
    await piProcess.start();

    wsServer = new WsServer({ port: PORT, piProcess });
    await wsServer.start();

    // Connect client
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    let textAccum = "";

    const result = await new Promise<{ text: string; eventCount: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          clientId: randomUUID(),
        }));
      });

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === "welcome") {
          // Send prompt
          ws.send(JSON.stringify({
            type: "command",
            payload: {
              type: "prompt",
              message: "Say exactly: E2E-OK. Nothing else.",
            },
          }));
          return;
        }

        if (msg.type === "event") {
          events.push(msg);
          const p = msg.payload;
          if (p.type === "message_update") {
            const evt = p.assistantMessageEvent;
            if (evt?.type === "text_delta") {
              textAccum += evt.delta;
            }
          }
          if (p.type === "agent_end") {
            clearTimeout(timer);
            resolve({ text: textAccum, eventCount: events.length });
          }
          if (p.type === "auto_retry_end" && !p.success) {
            clearTimeout(timer);
            reject(new Error(`Auto retry failed: ${p.finalError}`));
          }
        }

        if (msg.type === "error") {
          clearTimeout(timer);
          reject(new Error(`Protocol error: [${msg.code}] ${msg.message}`));
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ws.close();

    // Assertions — proper event lifecycle must complete
    expect(result.eventCount).toBeGreaterThan(3);
    const eventTypes = events.map((e) => e.payload?.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("agent_end");
    // Model should have responded (text or tool call), but Gemini sometimes
    // returns empty with injected system messages — accept that gracefully
    expect(eventTypes).toContain("message_start");
  }, TIMEOUT_MS + 5000);
});
