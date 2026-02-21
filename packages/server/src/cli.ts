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
 *   pi-server serve --host 0.0.0.0 --token mysecret -- --provider anthropic
 */

import { randomUUID } from "node:crypto";
import { PiProcess } from "./pi-process.js";
import { WsServer } from "./ws-server.js";

interface ServeOptions {
  port: number;
  host: string;
  token: string | undefined;
  cwd: string;
  piCliPath?: string;
  extensionUITimeoutMs?: number;
  piArgs: string[];
}

function parseArgs(args: string[]): ServeOptions {
  const options: ServeOptions = {
    port: 3333,
    host: "127.0.0.1",
    token: undefined,
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
      case "-p": {
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --port requires a value`);
          process.exit(1);
        }
        const raw = serverArgs[++i]!;
        const port = parseInt(raw, 10);
        // A-10: validate port is a number in the valid range
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(`Error: --port must be an integer between 1 and 65535 (got: ${raw})`);
          process.exit(1);
        }
        options.port = port;
        break;
      }
      case "--host": {
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --host requires a value`);
          process.exit(1);
        }
        options.host = serverArgs[++i]!;
        break;
      }
      case "--token": {
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --token requires a value`);
          process.exit(1);
        }
        options.token = serverArgs[++i]!;
        break;
      }
      case "--cwd":
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --cwd requires a value`);
          process.exit(1);
        }
        options.cwd = serverArgs[++i]!;
        break;
      case "--pi-cli-path":
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --pi-cli-path requires a value`);
          process.exit(1);
        }
        options.piCliPath = serverArgs[++i]!;
        break;
      case "--ui-timeout": {
        if (i + 1 >= serverArgs.length) {
          console.error(`Error: --ui-timeout requires a value`);
          process.exit(1);
        }
        const raw = serverArgs[++i]!;
        const ms = parseInt(raw, 10);
        // A-10: validate ui-timeout is a positive number
        if (isNaN(ms) || ms <= 0) {
          console.error(`Error: --ui-timeout must be a positive integer in milliseconds (got: ${raw})`);
          process.exit(1);
        }
        options.extensionUITimeoutMs = ms;
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "serve":
        break;
      default:
        // Unknown flags are forwarded to pi (supports pnpm npx which strips --)
        options.piArgs.push(arg);
        // If it looks like a flag with a value, grab the next arg too
        if (arg.startsWith("-") && i + 1 < serverArgs.length && !serverArgs[i + 1]!.startsWith("-")) {
          options.piArgs.push(serverArgs[++i]!);
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
  --host <address>       Bind address (default: 127.0.0.1 — localhost only)
                         Use --host 0.0.0.0 for network exposure (requires --token)
  --token <string>       Authentication token clients must supply.
                         Auto-generated if --host is 0.0.0.0 and --token is not set.
  --cwd <path>           Working directory for pi (default: current dir)
  --pi-cli-path <path>   Path to pi CLI entry point (default: auto-detect)
  --ui-timeout <ms>      Extension UI dialog timeout in ms (default: 60000)
  --help, -h             Show this help

Pi options (after --):
  Everything after -- is passed directly to pi. See pi --help for all options.
  Common: --provider, --model, --no-session, --no-extensions, --no-skills

Security:
  By default, pi-server binds to 127.0.0.1 (localhost only).
  To allow network connections, use --host 0.0.0.0 (requires --token).

Examples:
  pi-server serve -- --provider google --model gemini-2.5-flash
  pi-server serve --port 9090 -- --provider anthropic --model claude-sonnet-4-5
  pi-server serve --host 0.0.0.0 --token mysecret -- --no-extensions
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

  // A-1: Enforce token requirement when binding to non-localhost
  if (options.host !== "127.0.0.1" && options.host !== "localhost") {
    if (!options.token) {
      // Auto-generate a token so the server is never unauthenticated on a network interface
      options.token = randomUUID();
      console.log(`\nSecurity notice: binding to ${options.host} requires authentication.`);
      console.log(`Auto-generated token: ${options.token}`);
      console.log(`Pass this to clients with: --token ${options.token}\n`);
    }
  }

  console.log(`Starting pi-server...`);
  console.log(`  Port: ${options.port}`);
  console.log(`  Host: ${options.host}`);
  if (options.token) {
    console.log(`  Auth: token required`);
  } else {
    console.log(`  Auth: none (localhost-only mode)`);
  }
  console.log(`  CWD:  ${options.cwd}`);
  if (options.piArgs.length > 0) console.log(`  Pi:   ${options.piArgs.join(" ")}`);

  // Start pi process
  const piProcess = new PiProcess({
    cwd: options.cwd,
    piCliPath: options.piCliPath,
    piArgs: options.piArgs.length > 0 ? options.piArgs : undefined,
  });

  // A-7: track graceful shutdown to suppress spurious exit(1)
  let isShuttingDown = false;

  piProcess.onExit((code, signal) => {
    if (isShuttingDown) return; // expected exit during shutdown
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
    host: options.host,
    token: options.token,
    piProcess,
    extensionUITimeoutMs: options.extensionUITimeoutMs,
  });

  try {
    await wsServer.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A-5: surface startup errors clearly
    if (msg.includes("EADDRINUSE")) {
      console.error(`Error: port ${options.port} is already in use. Choose a different port with --port.`);
    } else {
      console.error(`Failed to start WebSocket server: ${msg}`);
    }
    await piProcess.stop();
    process.exit(1);
  }

  console.log(`  WebSocket listening on ws://${options.host}:${options.port}`);
  console.log(`\nReady. Connect with: pi-client connect ws://127.0.0.1:${options.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    isShuttingDown = true;
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
