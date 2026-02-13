/**
 * Pi Process Manager
 *
 * Spawns `pi --mode rpc` as a child process and provides:
 * - Typed stdin/stdout relay (JSON lines)
 * - Lifecycle management (start, stop, crash detection)
 * - Event callback for stdout messages
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

/**
 * Minimal transport interface used by WsServer.
 * PiProcess implements this via child process. Tests can provide a mock.
 */
export interface IPiTransport {
  onMessage(handler: PiMessageHandler): void;
  send(message: Record<string, unknown>): void;
}

export interface PiProcessOptions {
  /** Working directory for the pi process */
  cwd: string;
  /** Path to pi CLI entry point (default: auto-detect from PATH) */
  piCliPath?: string;
  /** Additional arguments to pass to pi (e.g., --provider, --model) */
  piArgs?: string[];
  /** Environment variables for the pi process */
  env?: Record<string, string>;
}

export type PiMessageHandler = (message: Record<string, unknown>) => void;

export class PiProcess implements IPiTransport {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private messageHandler: PiMessageHandler | null = null;
  private exitHandler: ((code: number | null, signal: string | null) => void) | null = null;
  private stderrChunks: string[] = [];
  private options: PiProcessOptions;

  constructor(options: PiProcessOptions) {
    this.options = options;
  }

  /**
   * Register a handler for messages received from pi's stdout.
   * Each message is a parsed JSON object (one per line).
   */
  onMessage(handler: PiMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register a handler for process exit.
   */
  onExit(handler: (code: number | null, signal: string | null) => void): void {
    this.exitHandler = handler;
  }

  /**
   * Start the pi process.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error("Pi process already running");
    }

    const cliPath = this.options.piCliPath ?? await this.findPiCli();
    const args = ["--mode", "rpc", ...(this.options.piArgs ?? [])];

    this.process = spawn("node", [cliPath, ...args], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Read stdout as JSON lines
    this.readline = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.readline.on("line", (line) => {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        this.messageHandler?.(message);
      } catch {
        // Non-JSON lines from pi (rare, but possible during startup)
      }
    });

    // Collect stderr for diagnostics
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString());
      // Keep only last 100 chunks
      if (this.stderrChunks.length > 100) {
        this.stderrChunks.shift();
      }
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.process = null;
      this.readline = null;
      this.exitHandler?.(code, signal);
    });

    // Wait briefly for startup errors
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 200);
      this.process!.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start pi: ${err.message}`));
      });
      this.process!.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(
            `Pi exited immediately with code ${code}. Stderr: ${this.getStderr()}`
          ));
        }
      });
    });
  }

  /**
   * Send a JSON message to pi's stdin.
   */
  send(message: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("Pi process not running or stdin not writable");
    }
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * Stop the pi process gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    const proc = this.process;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  /**
   * Whether the pi process is running.
   */
  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Get collected stderr output (for diagnostics).
   */
  getStderr(): string {
    return this.stderrChunks.join("");
  }

  /**
   * Find the pi CLI entry point.
   *
   * Uses `where` on Windows and `which` on Unix to locate the pi shim,
   * then parses the shim to extract the actual .js entry point path.
   * On Windows, `which` returns POSIX paths that Node's fs can't read,
   * so we always prefer `where` (returns native Windows paths).
   */
  private async findPiCli(): Promise<string> {
    const { execSync } = await import("node:child_process");
    const { readFileSync, existsSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const isWindows = process.platform === "win32";

    try {
      // Locate shim files — `where` on Windows (native paths), `which` on Unix
      const locateCmd = isWindows ? "where pi" : "which pi";
      const locateResult = execSync(locateCmd, { encoding: "utf8" }).trim();
      const candidates = locateResult.split("\n").map(s => s.trim()).filter(Boolean);

      // Try each candidate (prefer .cmd on Windows since `where` lists both)
      for (const shimPath of candidates) {
        if (!existsSync(shimPath)) continue;

        const content = readFileSync(shimPath, "utf8");

        // Match the node_modules/...cli.js path (handles both / and \ separators)
        const match = content.match(/node_modules[\\/][^\s"]+\.js/);
        if (match) {
          const resolved = resolve(dirname(shimPath), match[0]);
          if (existsSync(resolved)) {
            return resolved;
          }
        }
      }

      // Fallback: check npm global root directly
      try {
        const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
        const globalCliPath = resolve(npmRoot, "@mariozechner", "pi-coding-agent", "dist", "cli.js");
        if (existsSync(globalCliPath)) {
          return globalCliPath;
        }
      } catch {
        // npm root -g failed, continue to error
      }

      throw new Error("Could not resolve pi CLI .js entry point from shim files");
    } catch (err) {
      if (err instanceof Error && err.message.includes("Could not resolve")) {
        throw err;
      }
      throw new Error(
        "Could not find pi CLI. Install it globally or pass --pi-cli-path."
      );
    }
  }
}
