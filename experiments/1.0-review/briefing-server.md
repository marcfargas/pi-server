# Briefing: Server Hardening for v1.0

## Your working root
`C:/dev/pi-server-wt-server/` — a git worktree. All edits go here. Commit when done.

## Context
Read these files first:
- `experiments/1.0-review/synthesis.md` — full review with issues
- `experiments/1.0-review/decisions.md` — architecture decisions
- `packages/server/src/ws-server.ts` — main relay server
- `packages/server/src/pi-process.ts` — pi process manager
- `packages/server/src/ui-bridge.ts` — extension UI bridge
- `packages/server/src/cli.ts` — CLI entry point

The protocol package has already been updated (on develop, merged into your worktree):
- `HelloMessage.token?: string` field for auth
- `UNAUTHORIZED` error code added
- `lastSeq` removed, `ServerConfig` removed
- Type guards strengthened

## Tasks (in priority order)

### 1. Token authentication (A-1)
- Add `--token <string>` CLI flag to server. If not provided, auto-generate a UUID and print it.
- In `WsServer`, accept a `token` config option.
- In `handleConnection`, after receiving HelloMessage, validate `hello.token === this.token`. If mismatch, send `{type:"error", code:"UNAUTHORIZED", message:"Invalid or missing token"}` and close.
- If `--token` is not set and `--host` is `127.0.0.1`, token is optional (localhost-only mode).
- If `--host 0.0.0.0`, require `--token` (exit with error if missing).

### 2. Bind to localhost by default (A-2)
- Add `--host <address>` CLI flag, default `127.0.0.1`.
- Pass `host` to `WebSocketServer` constructor.
- Update startup log to show bind address.

### 3. Pi process death notification (A-3)
- `PiProcess` already has `onExit` callback.
- In `WsServer` constructor or a new `init()`: wire up pi process exit to send `PI_PROCESS_ERROR` to connected client, then close the socket.
- Don't call `process.exit(1)` from the WsServer — let the CLI handle that.

### 4. Wrap piProcess.send in try/catch (A-4)
- In `handleClientMessage` case "command": wrap `this.piProcess.send(message.payload)` in try/catch, send `PI_PROCESS_ERROR` to client on error.
- In the UIBridge promise `.then()`: wrap `this.piProcess.send(response)` in try/catch.

### 5. Handle WebSocketServer startup errors (A-5)
- In `WsServer.start()`: add `wss.once("error", reject)` before the listening callback.
- Remove the error listener after successful start.

### 6. Fix single-client handshake race (A-6)
- Reserve the client slot on TCP connect (before hello): set `this.client = ws` immediately.
- If hello fails validation, release the slot (`this.client = null`) and close.
- If another connection arrives while handshaking, reject it.

### 7. Fix graceful shutdown exit code (A-7)
- Add `private isShuttingDown = false` flag to server or CLI.
- In shutdown handler, set flag before stopping.
- In `piProcess.onExit`, check flag — don't `process.exit(1)` during intentional shutdown.

### 8. Clean up pending commands on stop (A-8)
- In `WsServer.stop()`, iterate `pendingPiCommands`, clear timeouts, reject promises.

### 9. Server-side keepalive ping (A-9)
- Start a 30s interval sending WebSocket ping to client.
- Use `ws` library's built-in `ws.ping()` / `ws.on('pong')`.
- If no pong within 10s, close the connection (frees client slot).
- Clear interval on client disconnect and server stop.

### 10. Validate CLI args (A-10)
- Check `--ui-timeout` is a positive number (not NaN).
- Check `--port` is in valid range.
- Exit with clear error on invalid args.

### 11. Generate serverId as UUID (A-12/B-8)
- Replace hardcoded `"pi-server-1"` with `randomUUID()` per process start.
- Don't persist — document it's ephemeral.

## Acceptance Criteria
- All existing tests pass (`npm test` in the worktree)
- Build succeeds (`npm run build`)
- Server starts with `--token mysecret`, client without token gets UNAUTHORIZED
- Server binds to 127.0.0.1 by default
- Pi crash sends error to client (not infinite hang)
- EADDRINUSE produces clear error message
- Two simultaneous connections: first wins, second rejected
- Clean shutdown exits with code 0

## When done
- `git add -A && git commit -m "feat: server hardening for v1.0 — auth, reliability, error handling"`
- Leave the worktree — orchestrator will merge
