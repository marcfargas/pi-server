#!/usr/bin/env node
/**
 * pi-server CLI
 *
 * Usage:
 *   pi-server serve --port 3333 --cwd /path/to/project
 *   pi-server serve --port 3333 --pi-args "--provider anthropic --model claude-sonnet-4-5"
 */

import { PiProcess } from "./pi-process.js";
import { WsServer } from "./ws-server.js";

interface ServeOptions {
  port: number;
  cwd: string;
  piCliPath?: string;
  piArgs?: string[];
  extensionUITimeoutMs?: number;
}

function parseArgs(args: string[]): ServeOptions {
  const options: ServeOptions = {
    port: 3333,
    cwd: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
      case "-p":
        options.port = parseInt(args[++i], 10);
        if (isNaN(options.port)) {
          console.error("Invalid port number");
          process.exit(1);
        }
        break;
      case "--cwd":
        options.cwd = args[++i];
        break;
      case "--pi-cli-path":
        options.piCliPath = args[++i];
        break;
      case "--pi-args":
        options.piArgs = args[++i]?.split(" ");
        break;
      case "--ui-timeout":
        options.extensionUITimeoutMs = parseInt(args[++i], 10);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "serve":
        // subcommand, skip
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`pi-server — Detachable agent sessions over WebSocket

Usage:
  pi-server serve [options]

Options:
  --port, -p <number>    WebSocket port (default: 3333)
  --cwd <path>           Working directory for pi (default: current dir)
  --pi-cli-path <path>   Path to pi CLI entry point (default: auto-detect)
  --pi-args <args>       Additional arguments for pi (space-separated, quoted)
  --ui-timeout <ms>      Extension UI timeout in ms (default: 60000)
  --help, -h             Show this help
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  if (args[0] !== "serve") {
    console.error(`Unknown command: ${args[0]}. Use "pi-server serve".`);
    process.exit(1);
  }

  const options = parseArgs(args);

  console.log(`Starting pi-server...`);
  console.log(`  Port: ${options.port}`);
  console.log(`  CWD:  ${options.cwd}`);

  // Start pi process
  const piProcess = new PiProcess({
    cwd: options.cwd,
    piCliPath: options.piCliPath,
    piArgs: options.piArgs,
  });

  piProcess.onExit((code, signal) => {
    console.error(`Pi process exited (code=${code}, signal=${signal})`);
    console.error(`Stderr: ${piProcess.getStderr()}`);
    process.exit(1);
  });

  try {
    await piProcess.start();
    console.log(`  Pi process started`);
  } catch (err) {
    console.error(`Failed to start pi: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Start WebSocket server
  const wsServer = new WsServer({
    port: options.port,
    piProcess,
    extensionUITimeoutMs: options.extensionUITimeoutMs,
  });

  await wsServer.start();
  console.log(`  WebSocket server listening on ws://localhost:${options.port}`);
  console.log(`\nReady. Connect with: pi-server connect ws://localhost:${options.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await wsServer.stop();
    await piProcess.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
