/**
 * WebSocket Server + Message Relay
 *
 * Manages WebSocket connections and relays messages between
 * the connected client and the pi child process.
 *
 * Connection lifecycle:
 * 1. Client connects via WebSocket
 * 2. Client sends HelloMessage
 * 3. Server validates protocol version
 * 4. Server queries pi for state (get_state + get_messages)
 * 5. Server sends WelcomeMessage with full state
 * 6. Steady-state: relay messages bidirectionally
 * 7. On disconnect: cancel pending UI requests, accept new client
 */

import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  isHelloMessage,
  createIncompatibleProtocolError,
  createError,
  type HelloMessage,
  type WelcomeMessage,
  type ServerEventMessage,
  type ServerExtensionUIRequest,
  type ClientMessage,
} from "@marcfargas/pi-server-protocol";
import { type PiProcess } from "./pi-process.js";
import { UIBridge } from "./ui-bridge.js";

export interface WsServerOptions {
  port: number;
  piProcess: PiProcess;
  extensionUITimeoutMs?: number;
}

export class WsServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private clientId: string | null = null;
  private seq = 0;
  private uiBridge: UIBridge;
  private piProcess: PiProcess;
  private port: number;

  /** Pending pi commands waiting for response (id → resolve) */
  private pendingPiCommands = new Map<string, (data: Record<string, unknown>) => void>();
  private piCommandId = 0;

  constructor(options: WsServerOptions) {
    this.port = options.port;
    this.piProcess = options.piProcess;
    this.uiBridge = new UIBridge(options.extensionUITimeoutMs);

    // Handle messages from pi's stdout
    this.piProcess.onMessage((message) => this.handlePiMessage(message));
  }

  /**
   * Start the WebSocket server.
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        resolve();
      });

      this.wss.on("connection", (ws) => this.handleConnection(ws));
    });
  }

  /**
   * Stop the server and close all connections.
   */
  async stop(): Promise<void> {
    this.uiBridge.cancelAll();

    if (this.client) {
      this.client.close(1001, "Server shutting down");
      this.client = null;
    }

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ===========================================================================
  // WebSocket connection handling
  // ===========================================================================

  private handleConnection(ws: WebSocket): void {
    // Only one client at a time (rw mode only, no ro for MVP)
    if (this.client) {
      const error = createError("INTERNAL_ERROR", "Another client is already connected");
      ws.send(JSON.stringify(error));
      ws.close(1008, "Another client is already connected");
      return;
    }

    let handshakeComplete = false;

    ws.on("message", async (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        const error = createError("INTERNAL_ERROR", "Invalid JSON");
        ws.send(JSON.stringify(error));
        return;
      }

      if (!handshakeComplete) {
        // Expect HelloMessage
        if (!isHelloMessage(parsed)) {
          const error = createError("INVALID_HELLO", "First message must be a HelloMessage");
          ws.send(JSON.stringify(error));
          ws.close(1002, "Invalid handshake");
          return;
        }

        const hello = parsed as HelloMessage;

        // Validate protocol version
        if (hello.protocolVersion !== PROTOCOL_VERSION) {
          const error = createIncompatibleProtocolError(hello.protocolVersion, PROTOCOL_VERSION);
          ws.send(JSON.stringify(error));
          ws.close(1002, "Incompatible protocol version");
          return;
        }

        // Handshake OK — register client
        this.client = ws;
        this.clientId = hello.clientId;
        handshakeComplete = true;

        // Send welcome with full state
        try {
          const welcome = await this.buildWelcomeMessage();
          ws.send(JSON.stringify(welcome));
        } catch (err) {
          const error = createError(
            "PI_PROCESS_ERROR",
            `Failed to get session state: ${err instanceof Error ? err.message : "unknown"}`
          );
          ws.send(JSON.stringify(error));
          ws.close(1011, "Failed to sync state");
          this.client = null;
          this.clientId = null;
        }
        return;
      }

      // Steady-state: handle client messages
      this.handleClientMessage(parsed as ClientMessage);
    });

    ws.on("close", () => {
      if (this.client === ws) {
        this.client = null;
        this.clientId = null;
        // Cancel pending UI requests so pi doesn't hang
        this.uiBridge.cancelAll();
      }
    });

    ws.on("error", () => {
      // Error handling — connection will close after this
    });
  }

  // ===========================================================================
  // Client → Pi relay
  // ===========================================================================

  private handleClientMessage(message: ClientMessage): void {
    switch (message.type) {
      case "command":
        // Relay the pi RPC command to pi's stdin
        this.piProcess.send(message.payload);
        break;

      case "extension_ui_response":
        // Route to UI bridge which resolves the pending request
        this.uiBridge.handleResponse(message.id, {
          type: "extension_ui_response",
          id: message.id,
          value: message.value,
          confirmed: message.confirmed,
          cancelled: message.cancelled,
        });
        break;

      case "ping":
        this.sendToClient({ type: "pong" });
        break;
    }
  }

  // ===========================================================================
  // Pi → Client relay
  // ===========================================================================

  private handlePiMessage(message: Record<string, unknown>): void {
    // Check if this is a response to a pending command we sent
    if (message.type === "response" && typeof message.id === "string") {
      const pending = this.pendingPiCommands.get(message.id);
      if (pending) {
        this.pendingPiCommands.delete(message.id);
        pending(message);
        return;
      }
    }

    // Check if this is an extension UI request
    if (this.uiBridge.isExtensionUIRequest(message)) {
      if (this.uiBridge.isFireAndForget(message)) {
        // Fire-and-forget: just forward to client
        this.sendToClient({
          type: "extension_ui_request",
          seq: this.nextSeq(),
          ...message,
        } as ServerExtensionUIRequest);
      } else {
        // Dialog: register with UI bridge, forward to client, await response
        const id = message.id as string;

        this.uiBridge.registerRequest(id, message.method as string).then((response) => {
          // Send the response back to pi's stdin
          this.piProcess.send(response);
        });

        // Forward the request to the client
        if (this.client) {
          this.sendToClient({
            type: "extension_ui_request",
            seq: this.nextSeq(),
            ...message,
          } as ServerExtensionUIRequest);
        }
        // If no client: timeout will fire and send default response
      }
      return;
    }

    // Regular event/response: wrap with seq and forward
    const serverMsg: ServerEventMessage = {
      type: "event",
      seq: this.nextSeq(),
      payload: message,
    };
    this.sendToClient(serverMsg);
  }

  // ===========================================================================
  // State sync
  // ===========================================================================

  /**
   * Build a WelcomeMessage by querying pi for current state and messages.
   */
  private async buildWelcomeMessage(): Promise<WelcomeMessage> {
    const [stateResponse, messagesResponse] = await Promise.all([
      this.sendPiCommand({ type: "get_state" }),
      this.sendPiCommand({ type: "get_messages" }),
    ]);

    const state = (stateResponse as Record<string, unknown>).data as Record<string, unknown> ?? {};
    const messagesData = (messagesResponse as Record<string, unknown>).data as Record<string, unknown> ?? {};
    const messages = (messagesData.messages as unknown[]) ?? [];

    return {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverId: this.getServerId(),
      sessionState: state,
      messages,
      currentSeq: this.seq,
    };
  }

  /**
   * Send a command to pi and wait for the response.
   */
  private sendPiCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = `srv_${++this.piCommandId}`;
      const timeout = setTimeout(() => {
        this.pendingPiCommands.delete(id);
        reject(new Error(`Timeout waiting for pi response to ${command.type}`));
      }, 10_000);

      this.pendingPiCommands.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.piProcess.send({ ...command, id });
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private sendToClient(message: object): void {
    if (this.client && this.client.readyState === 1 /* OPEN */) {
      this.client.send(JSON.stringify(message));
    }
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  private getServerId(): string {
    // Stable ID for this server instance — for now, just use a fixed string.
    // In production, derive from config or persist across restarts.
    return "pi-server-1";
  }
}
