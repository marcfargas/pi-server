/**
 * WebSocket Connection Manager
 *
 * Handles connecting to a pi-server instance, sending the hello handshake,
 * receiving the welcome state, and reconnecting on disconnect.
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type HelloMessage,
  type WelcomeMessage,
  type ServerMessage,
  type ServerError,
  type ClientCommandMessage,
  type ClientExtensionUIResponse,
} from "@marcfargas/pi-server-protocol";

export type ConnectionState = "disconnected" | "connecting" | "handshaking" | "connected";

export interface ConnectionOptions {
  /** Authentication token (must match server's --token) */
  token?: string;
}

export interface ConnectionEvents {
  /** Called when connection state changes */
  onStateChange?: (state: ConnectionState) => void;
  /** Called when welcome message received (initial state) */
  onWelcome?: (welcome: WelcomeMessage) => void;
  /** Called for each server event message */
  onEvent?: (payload: Record<string, unknown>, seq: number) => void;
  /** Called for extension UI requests */
  onExtensionUI?: (request: Record<string, unknown>) => void;
  /** Called on protocol errors */
  onError?: (error: ServerError) => void;
}

/** Max reconnect delay (30s) */
const MAX_RECONNECT_DELAY = 30_000;
/** Base reconnect delay (2s) */
const BASE_RECONNECT_DELAY = 2_000;

export class Connection {
  private ws: WebSocket | null = null;
  private clientId: string;
  private url: string;
  private token?: string;
  private events: ConnectionEvents;
  private state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalDisconnect = false;

  constructor(url: string, events: ConnectionEvents, options?: ConnectionOptions) {
    this.url = url;
    this.clientId = randomUUID();
    this.events = events;
    this.token = options?.token;
  }

  /**
   * Connect to the server.
   * Captures socket instance locally to prevent reconnect races
   * (stale socket callbacks can't affect newer connections).
   */
  connect(): void {
    if (this.ws) return;

    this.intentionalDisconnect = false;
    this.setState("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws) return; // stale socket guard
      this.setState("handshaking");
      const hello: HelloMessage = {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: this.clientId,
        token: this.token,
      };
      ws.send(JSON.stringify(hello));
    });

    ws.on("message", (data) => {
      if (this.ws !== ws) return; // stale socket guard
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }

      this.handleMessage(parsed);
    });

    ws.on("close", () => {
      if (this.ws !== ws) return; // stale socket guard
      this.ws = null;
      this.setState("disconnected");
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", () => {
      // Error will be followed by close
    });
  }

  /**
   * Disconnect without reconnecting.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /**
   * Send a pi RPC command to the server.
   */
  sendCommand(payload: Record<string, unknown>): void {
    const msg: ClientCommandMessage = { type: "command", payload };
    this.send(msg);
  }

  /**
   * Send an extension UI response.
   */
  sendExtensionUIResponse(id: string, response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): void {
    const msg: ClientExtensionUIResponse = {
      type: "extension_ui_response",
      id,
      ...response,
    };
    this.send(msg);
  }

  /** Current connection state */
  get connectionState(): ConnectionState {
    return this.state;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type as string;

    switch (type) {
      case "welcome":
        this.reconnectAttempt = 0; // reset backoff on successful connect
        this.setState("connected");
        this.events.onWelcome?.(message as unknown as WelcomeMessage);
        break;

      case "event": {
        const seq = message.seq as number;
        this.events.onEvent?.(message.payload as Record<string, unknown>, seq);
        break;
      }

      case "extension_ui_request":
        this.events.onExtensionUI?.(message);
        break;

      case "pong":
        // Keepalive response — nothing to do
        break;

      case "error":
        this.events.onError?.(message as unknown as ServerError);
        break;
    }
  }

  private send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // Exponential backoff with jitter: 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY,
    );
    const jitter = delay * 0.2 * Math.random(); // ±20% jitter
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay + jitter);
  }
}
