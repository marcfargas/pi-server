# Briefing: Final v1.0 Fixes (from review)

## Your working root
`C:/dev/pi-server-wt-final/` — a git worktree. All edits go there. Commit when done.

## Context
Read these files first:
- `experiments/1.0-review/final-synthesis.md` — the review findings
- `experiments/1.0-review/decisions.md` — architecture decisions already made
- `packages/server/src/ws-server.ts` — main relay server
- `packages/server/src/cli.ts` — server CLI
- `packages/tui-client/src/app.tsx` — TUI app
- `packages/protocol/src/types.ts` — protocol types

## Decisions (already made, just implement)
- Browser clients: **No** for v1. Reject `Origin` headers.
- Tokenless localhost: **Keep**, but add Origin rejection for CSWSH.
- `serverId`: **Ephemeral** (process-lifetime UUID). Fix docs to match.
- Protocol validation: **Strict now.**
- Dead error codes: **Remove** `SESSION_NOT_FOUND` and `EXTENSION_UI_TIMEOUT`.

## Tasks (all 6 blockers + SHOULD-FIX items)

### 1. Remove stale dist artifacts + prevent recurrence
- Delete `packages/server/dist/slash-commands*` files if they exist (stale from old refactor).
- The `prebuild` script in `packages/server/package.json` already does `rm -rf dist` before `tsc`. Verify it's there; add if missing.
- Run `npm run clean && npm run build` to verify clean dist output.

### 2. Post-handshake message validation
File: `packages/server/src/ws-server.ts`
- Import `isClientMessage` from `@marcfargas/pi-server-protocol`
- Find the line `this.handleClientMessage(parsed as ClientMessage)` in the steady-state message handler
- Replace with:
  ```ts
  if (!isClientMessage(parsed)) {
    this.sendErrorToClient("INTERNAL_ERROR", "Invalid message format");
    return;
  }
  this.handleClientMessage(parsed);
  ```

### 3. CSWSH defense — reject browser Origin headers
File: `packages/server/src/ws-server.ts`
- The `handleConnection` method receives `(ws: WebSocket)`. Change to `(ws: WebSocket, req: import("node:http").IncomingMessage)`.
- Update the `.on("connection", ...)` call to pass both args.
- At the very top of `handleConnection`, before the client slot check:
  ```ts
  const origin = req.headers.origin;
  if (origin) {
    ws.close(1008, "Browser Origin rejected");
    return;
  }
  ```
- Add a test for this in the error-paths test file.

### 4. Extension UI input/editor cancel handler
File: `packages/tui-client/src/app.tsx`
- The `input`/`editor` dialog section uses `TextInput` but has no Escape handler.
- Extract it into a separate `ExtensionUIInput` component (like `ExtensionUISelect` and `ExtensionUIConfirm`).
- Add `useInput` hook that catches `key.escape` and calls `onRespond({ cancelled: true })`.
- This ensures users can cancel input dialogs with Escape.

### 5. CLI arg parsing bounds checks
File: `packages/server/src/cli.ts`
- For every flag that consumes a value (`--host`, `--token`, `--cwd`, `--pi-cli-path`, `--ui-timeout`, `--port`):
  - Check `i + 1 < serverArgs.length` before `++i`
  - If missing, print error and `process.exit(1)`
- Do the same in `packages/tui-client/src/cli.ts` for `--token`.

### 6. Protocol semantics cleanup
File: `packages/protocol/src/types.ts`
- Remove `SESSION_NOT_FOUND` and `EXTENSION_UI_TIMEOUT` from the `ErrorCode` union (dead codes, never emitted).
- Fix the `WelcomeMessage.serverId` JSDoc: change "Stable server identifier (persists across restarts)" to "Server process identifier (ephemeral — changes on restart)".

### 7. Handshake race window (SHOULD-FIX)
File: `packages/server/src/ws-server.ts`
- Currently `handshakeComplete` is set to `true` BEFORE `buildWelcomeMessage()` resolves.
- Move `handshakeComplete = true` to AFTER the welcome is sent successfully.
- Queue or ignore any client messages that arrive during the handshake window.

### 8. Remove unused `_connection` parameter
File: `packages/tui-client/src/app.tsx`
- The `handleExtensionUI` function takes `_connection: Connection` but never uses it.
- Remove the parameter and update the call site.

### 9. Add missing test for post-handshake validation
File: `packages/server/test/error-paths.test.ts` (append)
- Test: client sends `{ type: "command" }` with no `payload` → gets error response, connection stays open.
- Test: client sends `{ type: "nonsense" }` → gets error response.

### 10. Add test for Origin rejection
File: `packages/server/test/error-paths.test.ts` (append)
- Test: WebSocket connect with `Origin: http://evil.com` header → connection rejected.
- Use `new WebSocket(url, { headers: { Origin: "http://evil.com" } })`.

## Acceptance Criteria
- All existing tests pass + new tests pass
- Build succeeds (`npm run build`)
- `dist/` in server package has no `slash-commands*` files
- `isClientMessage()` called on every post-handshake message
- Browser Origin connections rejected
- Extension UI input dialogs can be cancelled with Escape
- CLI `--host` with no value prints error (doesn't bind to undefined)
- No dead error codes in protocol
- `serverId` docs say "ephemeral"

## When done
- `git add -A && git commit -m "fix: v1.0 review fixes — validation, CSWSH, UI cancel, CLI safety, protocol cleanup"`
- Leave the worktree — orchestrator will merge
