## Code Review Summary

**Scope**: Full codebase — all packages (protocol, commands, server, tui-client)
**Verdict**: 🟡 NEEDS_WORK — not MAJOR_RETHINK, but there are real issues that should be fixed before v1.0 ships.

---

## Test Results

**All 156 tests pass. Build is clean.**

| Package | Test Files | Tests |
|---------|-----------|-------|
| protocol | 2 | 42 ✅ |
| commands | 2 | 26 ✅ |
| server | 4 | 55 ✅ (including live E2E against Gemini) |
| tui-client | 1 | 33 ✅ |

---

## Test Coverage

| File | Has Tests | Tests Pass | Coverage Gap |
|------|-----------|------------|--------------|
| `protocol/src/types.ts` | ✅ | ✅ | None — well covered |
| `protocol/src/errors.ts` | ✅ | ✅ | None |
| `protocol/src/version.ts` | ✅ | ✅ | None |
| `commands/src/catalog.ts` | Indirect only | ✅ | `getBuiltin()` / `toRpc()` only via router tests. No direct test per-command |
| `commands/src/router.ts` | ✅ | ✅ | Good coverage |
| `commands/src/discovery.ts` | ✅ | ✅ | Good coverage |
| `server/src/ws-server.ts` | ✅ | ✅ | **Missing**: extension UI relay round-trip (pi → server → client → response → pi) |
| `server/src/ui-bridge.ts` | ✅ | ✅ | Excellent — all paths including fake timers |
| `server/src/pi-process.ts` | ❌ (E2E only) | ✅ | `findPiCli()` Windows/Unix path parsing has **zero unit tests** |
| `server/src/cli.ts` | ❌ | — | Arg parsing edge cases untested |
| `tui-client/src/state.ts` | ✅ | ✅ | Excellent — exhaustive reducer coverage |
| `tui-client/src/connection.ts` | ❌ | — | Reconnect backoff, stale socket guard, `handleMessage` dispatch — untested |
| `tui-client/src/editor.tsx` | ❌ | — | Complex cursor/history logic — **zero unit tests** |
| `tui-client/src/app.tsx` | ❌ | — | Event dispatch, routing, extension UI dispatch — untested |

---

## Findings

### 🔴 Blockers (must fix)

**1. Stale `slash-commands` artifacts in published dist — `packages/server/dist/`**

```
dist/slash-commands.d.ts        ← declares routeSlashCommand(), getBuiltinCommands()
dist/slash-commands.js          ← old implementation with hardcoded command table
dist/slash-commands.js.map
dist/slash-commands.d.ts.map
```

`slash-commands.ts` was removed from `src/` in a previous refactor but `dist/` was never cleaned. Since `package.json` publishes the full `dist/` folder:

```json
"files": ["dist", "README.md", "LICENSE"]
```

These stale files will ship in the npm package. The `exports` field blocks clean access but `@marcfargas/pi-server/dist/slash-commands.js` is still resolvable with a direct path import. More importantly, the published package has a function `getBuiltinCommands()` in dist that returns a different, outdated command list — conflicting with the correct one in the `commands` package.

**Fix**: Run `npm run clean && npm run build` in `packages/server` before publishing, or add a `predist` step.

---

### 🟡 Issues (should fix)

**2. Post-handshake messages bypass validation — `ws-server.ts:236`**

During handshake, the server correctly validates:
```typescript
if (!isHelloMessage(parsed)) { ... }
```

But for all post-handshake messages, it blindly casts:
```typescript
this.handleClientMessage(parsed as ClientMessage);  // no isClientMessage() check
```

`isClientMessage()` is exported from the protocol package for exactly this purpose but is never called by the server. A malformed post-handshake message (e.g., `{ type: "command" }` with no `payload`) reaches `handleClientMessage` where `message.payload` is accessed — which is `undefined`, then passed to `this.piProcess.send(undefined)`. The `send()` method does `JSON.stringify(undefined)` which returns `undefined` (not a string), and `stdin.write(undefined)` would throw. The try/catch in `handleClientMessage` would catch this, but the code path is fragile.

**Fix** (`ws-server.ts:234`):
```typescript
// Replace:
this.handleClientMessage(parsed as ClientMessage);

// With:
if (!isClientMessage(parsed)) {
  this.sendErrorToClient("INTERNAL_ERROR", "Invalid message format");
  return;
}
this.handleClientMessage(parsed);
```

Add `isClientMessage` to the imports from protocol.

---

**3. CLI arg parsing: missing bounds check when a flag is the last argument — `cli.ts`**

```typescript
case "--host": {
  options.host = serverArgs[++i]!;  // undefined if --host is last arg
  break;
}
```

When `--host` has no value (e.g., `pi-server serve --host`), `serverArgs[++i]` is `undefined`. The `!` assertion suppresses TypeScript but doesn't prevent runtime corruption. The resulting `undefined` host triggers the network-token guard (`undefined !== "127.0.0.1"` → true), auto-generates a token, then passes `host: undefined` to `WebSocketServer`, which binds to all interfaces unpredictably.

Same pattern affects: `--token`, `--cwd`, `--pi-cli-path`, `--ui-timeout`.

**Fix**: Add bounds check before `++i`:
```typescript
case "--host": {
  if (i + 1 >= serverArgs.length || serverArgs[i + 1]!.startsWith("-")) {
    console.error(`Error: --host requires a value`);
    process.exit(1);
  }
  options.host = serverArgs[++i]!;
  break;
}
```

---

**4. `SESSION_NOT_FOUND` and `EXTENSION_UI_TIMEOUT` error codes defined but never emitted — `protocol/src/types.ts:161,163`**

```typescript
export type ErrorCode =
  | "SESSION_NOT_FOUND"       // pi process not running — ❌ never sent
  | "EXTENSION_UI_TIMEOUT"    // no response to UI request — ❌ never sent
```

`SESSION_NOT_FOUND` is never emitted (the equivalent is `PI_PROCESS_ERROR`). `EXTENSION_UI_TIMEOUT` is never emitted — the UIBridge resolves timeouts silently with a default response, never sending an error code to the client.

Client code that does `if (error.code === "EXTENSION_UI_TIMEOUT")` will never fire. These are dead protocol surface that future implementors (or AI agents reading this type) will wrongly rely on.

**Fix**: Either emit them (add the `SESSION_NOT_FOUND` case when pi isn't running, add `EXTENSION_UI_TIMEOUT` for dialog timeouts) or remove them and add a comment explaining why they were removed.

---

**5. `_connection` unused parameter in `handleExtensionUI` — `app.tsx:657`**

```typescript
function handleExtensionUI(
  request: Record<string, unknown>,
  dispatch: React.Dispatch<...>,
  _connection: Connection,   // ← passed but never used
): void {
```

The `_connection` parameter was likely intended for future use (e.g., sending cancellation signals), but it's never used. It pollutes the function signature and makes callers think it matters.

**Fix**: Remove the parameter (callers pass `conn` which can be accessed via closure if ever needed).

---

**6. `tsconfig.json` missing `noUnusedLocals` and `noUnusedParameters` — root `tsconfig.json`**

The root config has `"strict": true` but does not enable:
```json
"noUnusedLocals": true,
"noUnusedParameters": true
```

This allowed the `_connection` issue above to go undetected at compile time, and will allow future unused code to slip in silently.

---

### 🟢 Observations

**7. Extension UI relay round-trip not integration-tested**

`ui-bridge.test.ts` tests `UIBridge` in isolation. `relay.test.ts` tests message relay. But the full round-trip — pi sends `extension_ui_request` → server routes to UIBridge + forwards to client → client sends `extension_ui_response` → UIBridge resolves → server sends to pi — has no end-to-end test. The `MockPiTransport.send()` doesn't handle `extension_ui_request` injection either.

**8. `pi-process.ts` `findPiCli()` — Windows/Unix shim parsing, zero unit tests**

The most platform-sensitive code in the repo (Windows `where pi` vs Unix `which pi`, shim path extraction with regex, `npm root -g` fallback) has no unit tests. It's only exercised by the E2E test. A regex change or Windows path separator bug would silently break production.

**9. `editor.tsx` — zero tests for complex cursor/multiline logic**

The multi-line editor with cursor positioning, paste handling, Shift+Enter newline, and history navigation is ~200 lines of non-trivial stateful logic. The paste-multiline path has a `splice(cursor.line + parts.length, 1)` that appears to be a no-op (it removes an index that was already overwritten) — harmless, but indicates this code hasn't been exercised by tests.

**10. `connection.ts` — reconnect backoff and stale socket guard untested**

The exponential backoff, jitter calculation, and the stale-socket guard (`if (this.ws !== ws) return`) are correctness-critical for reconnect behavior and have no unit tests.

**11. `ws.on("error", () => {})` in Connection — completely silent**

`connection.ts:104`:
```typescript
ws.on("error", () => {
  // Error will be followed by close
});
```

The comment is correct (ws errors always precede close), but swallowing the error with no logging makes debugging connection failures much harder. Even a `stderr` log at debug level would help.

**12. Unsafe cast `cmd.source as UnifiedCommand["source"]` — `discovery.ts:29`**

```typescript
source: cmd.source as UnifiedCommand["source"],
```

If pi sends `source: "unknown_future_type"`, this silently casts through. Low risk, but a runtime check or `satisfies` would be more defensible.

---

## Regression Risk

**Highest risk**: The stale `slash-commands.js` in dist. If a user does `import { getBuiltinCommands } from '@marcfargas/pi-server/dist/slash-commands.js'` they get the old hardcoded table with `compact`, `model`, `thinking`, `abort`, `new`, `stats`, `name`, `fork` — but NOT `export`. That's a silent discrepancy with the actual protocol.

**Second highest**: The post-handshake `parsed as ClientMessage` cast without validation. A `{ type: "command" }` message with no `payload` could cause `piProcess.send(undefined)` to throw, and while the `catch` absorbs it, the client gets `PI_PROCESS_ERROR` for what is actually a client bug.

**Third**: The `--host` at end-of-args binding to all interfaces unexpectedly. Not likely to be hit in practice, but would be a security surprise if it happened.

---

## TDD Assessment

The tests are **behavior-specifying**, not implementation-mirroring. The UIBridge tests cover multiple cancel/resolve orderings. The relay tests use scripted mock sequences, not mocks of internal methods. The state reducer tests check observable behavior at the boundary.

However, TDD compliance is **partial**: `editor.tsx`, `connection.ts`, `cli.ts`, and `pi-process.ts` have either no tests or only indirect E2E coverage. Given the complexity of the editor and reconnect logic, these feel like they were shipped without a test-first discipline.

The E2E test is a genuine asset — it makes a real LLM call and verifies the full pipeline. Running it requires `GOOGLE_API_KEY`, which is reasonable.

---

## Verdict: 🟡 NEEDS_WORK

**Ship-blockers**: Issue #1 (stale dist artifact) must be fixed before any `npm publish`. This is a single `npm run clean && npm run build` away.

**Before v1.0**: Issues #2–#6 are real correctness gaps that should be fixed. Issue #4 (dead error codes) is a protocol contract promise to external clients that will never be fulfilled.

**Not blockers**: The coverage gaps in `editor.tsx`, `connection.ts`, and `pi-process.ts` are technical debt, not release-blockers — but they're the most likely source of bugs post-release.
