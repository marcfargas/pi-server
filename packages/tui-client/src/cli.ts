#!/usr/bin/env node
/**
 * pi-client CLI — Terminal TUI client for pi-server
 *
 * Usage:
 *   pi-client connect ws://localhost:3333
 *   pi-client ws://localhost:3333
 */

import React from "react";
import { render } from "ink";
import App from "./app.js";

function parseArgs(args: string[]): { url: string } {
  let url = "ws://localhost:3333";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "connect") {
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        url = args[++i]!;
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (
      !arg.startsWith("-") &&
      (arg.startsWith("ws://") || arg.startsWith("wss://"))
    ) {
      url = arg;
    }
  }

  return { url };
}

function printHelp(): void {
  console.log(`pi-client — Terminal TUI client for pi-server

Usage:
  pi-client connect [url]
  pi-client [url]

Arguments:
  url    WebSocket URL (default: ws://localhost:3333)

Options:
  --help, -h    Show this help

Commands:
  /quit, /exit  Disconnect and exit

Examples:
  pi-client connect
  pi-client connect ws://localhost:3333
  pi-client wss://remote.server.com:9090
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const { url } = parseArgs(args);

  const { waitUntilExit } = render(React.createElement(App, { url }));
  await waitUntilExit();
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
