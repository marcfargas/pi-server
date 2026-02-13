#!/usr/bin/env node
/**
 * pi-server CLI
 *
 * Usage:
 *   pi-server serve [options] [-- pi-options...]
 *
 * Everything before -- is for pi-server. Everything after -- is passed to pi.
 *
 * Examples:
 *   pi-server serve --port 3333 -- --provider google --model gemini-2.5-flash
 *   pi-server serve -- --provider anthropic --model claude-sonnet-4-5 --no-session
 */

import { PiProcess } from "./pi-process.js";
import { WsServer } from "./ws-server.js";

interface ServeOptions {
  port: number;
  cwd: string;
  piCliPath?: string;
  extensionUITimeoutMs?: number;
  piArgs: string[];
}

function parseArgs(args: string[]): ServeOptions {
  const options: ServeOptions = {
    port: 3333,
    cwd: process.cwd(),
    piArgs: [],
  };

  // Split on -- separator
  const ddIndex = args.indexOf("--");
  const serverArgs = ddIndex >= 0 ? args.slice(0, ddIndex) : args;
  const piArgs = ddIndex >= 0 ? args.slice(ddIndex + 1) : [];
  options.piArgs = piArgs;

  for (let i = 0; i < serverArgs.length; i++) {
    const arg = serverArgs[i]!;
    switch (arg) {
      case "--port":
      case "-p":
        options.port = parseInt(serverArgs[++i]!, 10);
        if (isNaN(options.port)) {
          console.error("Invalid port number");
          process.exit(1);
        }
        break;
      case "--cwd":
        options.cwd = serverArgs[++i]!;
        break;
      case "--pi-cli-path":
        options.piCliPath = serverArgs[++i]!;
        break;
      case "--ui-timeout":
        options.extensionUITimeoutMs = parseInt(serverArgs[++i]!, 10);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "serve":
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}\nUse -- to pass options to pi: pi-server serve -- ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`pi-server — Detachable agent sessions over WebSocket

Usage:
  pi-server serve [options] [-- pi-options...]

Server options (before --):
  --port, -p <number>    WebSocket port (default: 3333)
  --cwd <path>           Working directory for pi (default: current dir)
  --pi-cli-path <path>   Path to pi CLI entry point (default: auto-detect)
  --ui-timeout <ms>      Extension UI dialog timeout in ms (default: 60000)
  --help, -h             Show this help

Pi options (after --):
  Everything after -- is passed directly to pi. See pi --help for all options.
  Common: --provider, --model, --no-session, --no-extensions, --no-skills

Examples:
  pi-server serve -- --provider google --model gemini-2.5-flash
  pi-server serve --port 9090 -- --provider anthropic --model claude-sonnet-4-5
  pi-server serve --cwd /path/to/project -- --no-extensions --no-skills
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
  if (options.piArgs.length > 0) console.log(`  Pi:   ${options.piArgs.join(" ")}`);

  // Start pi process
  const piProcess = new PiProcess({
    cwd: options.cwd,
    piCliPath: options.piCliPath,
    piArgs: options.piArgs.length > 0 ? options.piArgs : undefined,
  });

  piProcess.onExit((code, signal) => {
    console.error(`Pi process exited (code=${code}, signal=${signal})`);
    const stderr = piProcess.getStderr();
    if (stderr) console.error(`Stderr: ${stderr}`);
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
  console.log(`  WebSocket listening on ws://localhost:${options.port}`);
  console.log(`\nReady. Connect with: pi-client connect ws://localhost:${options.port}`);

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
