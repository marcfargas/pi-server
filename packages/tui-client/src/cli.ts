#!/usr/bin/env node
/**
 * pi-client CLI — Terminal TUI client for pi-server
 *
 * Usage:
 *   pi-client connect ws://localhost:3333
 */

import { Connection } from "./connection.js";
import type { WelcomeMessage, ServerError } from "@pi-server/protocol";

function parseArgs(args: string[]): { url: string } {
  let url = "ws://localhost:3333";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "connect") {
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        url = args[++i];
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && (arg.startsWith("ws://") || arg.startsWith("wss://"))) {
      url = arg;
    }
  }

  return { url };
}

function printHelp(): void {
  console.log(`pi-client — Terminal TUI client for pi-server

Usage:
  pi-client connect [url]

Arguments:
  url    WebSocket URL (default: ws://localhost:3333)

Options:
  --help, -h    Show this help

Examples:
  pi-client connect
  pi-client connect ws://localhost:3333
  pi-client connect wss://remote.server.com:9090
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const { url } = parseArgs(args);

  console.log(`Connecting to ${url}...`);

  // TODO: Replace with Ink TUI app once components are built.
  // For now, minimal stdio-based client for testing the protocol.

  const connection = new Connection(url, {
    onStateChange: (state) => {
      switch (state) {
        case "connecting":
          process.stderr.write("⟳ Connecting...\n");
          break;
        case "handshaking":
          process.stderr.write("⟳ Handshaking...\n");
          break;
        case "connected":
          process.stderr.write("✓ Connected\n");
          break;
        case "disconnected":
          process.stderr.write("✗ Disconnected — reconnecting...\n");
          break;
      }
    },

    onWelcome: (welcome: WelcomeMessage) => {
      process.stderr.write(`✓ Session state: ${welcome.messages.length} messages\n`);
      process.stderr.write(`  Protocol: v${welcome.protocolVersion}\n`);
      process.stderr.write(`  Server: ${welcome.serverId}\n`);
      process.stderr.write(`\nReady. Type a message and press Enter.\n\n`);
    },

    onEvent: (payload) => {
      const type = payload.type as string;

      // Display agent text deltas
      if (type === "message_update") {
        const evt = payload.assistantMessageEvent as Record<string, unknown> | undefined;
        if (evt?.type === "text_delta") {
          process.stdout.write(evt.delta as string);
        }
      }

      // Show when agent starts/stops
      if (type === "agent_start") {
        process.stderr.write("\n🤖 Agent thinking...\n");
      }
      if (type === "agent_end") {
        process.stderr.write("\n\n");
      }

      // Show tool execution
      if (type === "tool_execution_start") {
        process.stderr.write(`  → ${payload.toolName}(${JSON.stringify(payload.args).slice(0, 80)})\n`);
      }

      // Show RPC responses
      if (type === "response") {
        if (!(payload as Record<string, unknown>).success) {
          process.stderr.write(`⚠ Error: ${(payload as Record<string, unknown>).error}\n`);
        }
      }
    },

    onExtensionUI: (request) => {
      const method = request.method as string;
      const id = request.id as string;

      // For now, auto-cancel all dialog requests (TUI will handle these later)
      if (method === "select" || method === "confirm" || method === "input" || method === "editor") {
        process.stderr.write(`  [Extension UI: ${method} "${request.title}"] — auto-cancelling\n`);
        connection.sendExtensionUIResponse(id, { cancelled: true });
      }
      // Fire-and-forget: just display
      if (method === "notify") {
        process.stderr.write(`  ℹ ${request.message}\n`);
      }
      if (method === "setStatus") {
        process.stderr.write(`  [${request.statusKey}] ${request.statusText ?? "(cleared)"}\n`);
      }
    },

    onError: (error: ServerError) => {
      process.stderr.write(`⚠ Protocol error: [${error.code}] ${error.message}\n`);
    },
  });

  connection.connect();

  // Simple stdin input loop
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;

    if (text === "/quit" || text === "/exit") {
      connection.disconnect();
      process.exit(0);
    }

    // Send as prompt command
    connection.sendCommand({
      type: "prompt",
      message: text,
    });
  });

  rl.prompt();

  // Keep alive
  process.on("SIGINT", () => {
    connection.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
