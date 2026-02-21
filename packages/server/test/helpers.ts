/**
 * Shared test helpers for server tests.
 *
 * Provides MockPiTransport, connectAndHandshake, and collectMessages
 * used by both relay.test.ts and error-paths.test.ts.
 */

import WebSocket from "ws";
import type { IPiTransport, PiMessageHandler } from "../src/pi-process.js";
import { PROTOCOL_VERSION } from "@marcfargas/pi-server-protocol";

// =============================================================================
// Mock Pi Transport
// =============================================================================

export class MockPiTransport implements IPiTransport {
  private handler: PiMessageHandler | null = null;
  private promptScript: Record<string, unknown>[] = [];
  /** All messages sent to this transport (for assertions) */
  sent: Record<string, unknown>[] = [];

  onMessage(handler: PiMessageHandler): void {
    this.handler = handler;
  }

  send(message: Record<string, unknown>): void {
    this.sent.push(message);
    const type = message.type as string;

    if (type === "get_state") {
      this.emit({
        type: "response",
        id: message.id,
        success: true,
        data: { model: { name: "test-model", id: "test/model" } },
      });
      return;
    }

    if (type === "get_messages") {
      this.emit({
        type: "response",
        id: message.id,
        success: true,
        data: { messages: [] },
      });
      return;
    }

    if (type === "get_commands") {
      this.emit({
        type: "response",
        id: message.id,
        command: "get_commands",
        success: true,
        data: {
          commands: [
            { name: "todos", description: "List todos", source: "extension" },
            { name: "plan", description: "Toggle plan mode", source: "extension" },
            { name: "skill:web-search", description: "Web search", source: "skill" },
          ],
        },
      });
      return;
    }

    if (type === "cycle_model") {
      this.emit({
        type: "response",
        id: message.id,
        command: "cycle_model",
        success: true,
        data: { model: { id: "next-model", name: "Next Model", provider: "test" }, thinkingLevel: "off" },
      });
      return;
    }

    if (type === "set_thinking_level") {
      this.emit({
        type: "response",
        id: message.id,
        command: "set_thinking_level",
        success: true,
      });
      return;
    }

    if (type === "get_session_stats") {
      this.emit({
        type: "response",
        id: message.id,
        command: "get_session_stats",
        success: true,
        data: { totalMessages: 0, tokens: { total: 0 }, cost: 0 },
      });
      return;
    }

    if (type === "prompt") {
      setTimeout(() => {
        for (const event of this.promptScript) {
          this.emit(event);
        }
        this.emit({ type: "response", id: message.id, success: true });
      }, 10);
      return;
    }
  }

  /** Emit a message as if pi wrote it to stdout */
  emit(message: Record<string, unknown>): void {
    this.handler?.(message);
  }

  /** Set the events that will fire on next prompt */
  scriptPrompt(events: Record<string, unknown>[]): void {
    this.promptScript = events;
  }
}

// =============================================================================
// Test helpers
// =============================================================================

export function connectAndHandshake(port: number): Promise<{ ws: WebSocket; welcome: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: "test-client",
        mode: "rw",
      }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === "welcome") {
        resolve({ ws, welcome: msg });
      } else if (msg.type === "error") {
        reject(new Error(`Handshake error: ${JSON.stringify(msg)}`));
      }
    });

    ws.on("error", reject);
  });
}

export function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout: received ${messages.length}/${count} messages`));
    }, timeoutMs);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      messages.push(msg);
      if (messages.length >= count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
  });
}
