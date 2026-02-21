# Code Quality Review (_code-reviewer)

## Code Review Summary

**Scope**: Full audit of requested files in `C:/dev/pi-server`  
- `packages/protocol/src/*.ts`  
- `packages/commands/src/*.ts`, `packages/commands/test/*.ts`  
- `packages/server/src/*.ts`, `packages/server/test/*.ts`  
- `packages/tui-client/src/*.tsx`, `packages/tui-client/src/*.ts`, `packages/tui-client/test/*.ts`  
- root + package `package.json` files

**Commands run**:
- `ls packages/*/package.json` ✅
- `npm test` ✅ (all passing)
- `npm run build` ✅ (all passing)

**Verdict**: 🟡 Issues found (several are release-risk / blocker-level)

---

## Test Coverage

**Current test run**: 54 tests passed / 0 failed (5 test files)

| File | Has Tests | Tests Pass | Coverage Gap |
|---|---|---:|---|
| `packages/protocol/src/errors.ts` | ❌ | — | No protocol utility tests |
| `packages/protocol/src/index.ts` | ❌ | — | Export surface untested |
| `packages/protocol/src/types.ts` | ❌ | — | Type guards are untested (important) |
| `packages/protocol/src/version.ts` | ❌ | — | Version contract untested |
| `packages/commands/src/catalog.ts` | ⚠️ indirect | ✅ | Edge cases in `toRpc()` not fully tested |
| `packages/commands/src/discovery.ts` | ✅ | ✅ | Invalid/unknown `source` values untested |
| `packages/commands/src/router.ts` | ✅ | ✅ | malformed slash input edge cases untested |
| `packages/commands/src/index.ts` | ❌ | — | Barrel exports untested |
| `packages/commands/src/types.ts` | ❌ | — | Type-only, fine |
| `packages/server/src/ws-server.ts` | ✅ (integration) | ✅ | Error paths/races mostly untested |
| `packages/server/src/pi-process.ts` | ❌ | — | Startup failure, path resolution, stop semantics untested |
| `packages/server/src/ui-bridge.ts` | ❌ | — | Timeout/cancel logic untested |
| `packages/server/src/cli.ts` | ❌ | — | Arg parsing + shutdown behavior untested |
| `packages/server/src/index.ts` | ❌ | — | Barrel untested |
| `packages/tui-client/src/state.ts` | ✅ | ✅ | Good reducer coverage |
| `packages/tui-client/src/connection.ts` | ❌ | — | Reconnect/ordering races untested |
| `packages/tui-client/src/app.tsx` | ❌ | — | Event plumbing + extension dialogs untested |
| `packages/tui-client/src/editor.tsx` | ❌ | — | Input/history cursor logic untested |
| `packages/tui-client/src/cli.ts` | ❌ | — | CLI arg parsing untested |
| `packages/tui-client/src/index.ts` | ❌ | — | Barrel untested |

**Riskiest untested paths**:
1. `packages/server/src/ws-server.ts` handshake/error/race paths  
2. `packages/tui-client/src/connection.ts` reconnect ordering  
3. `packages/server/src/pi-process.ts` startup/exit process control  
4. `packages/server/src/ui-bridge.ts` timeout/cancel defaults

---

## Findings

### 🔴 Blockers (must fix)

1) **Single-client enforcement race in server handshake**  
`packages/server/src/ws-server.ts:98-105, 138-141, 160-162`

```ts
if (this.client) { ... return; } // checked only on TCP connect
...
this.client = ws; // set later during hello
...
this.handleClientMessage(parsed as ClientMessage);
```

If two sockets connect before either sends hello, both pass the initial check. Later, whichever handshakes second overwrites `this.client`; first socket may still send commands but receive no responses (or responses route to wrong client).  
**Fix**: reserve client slot earlier (or track pending handshakes), and validate `this.client === ws` before processing post-handshake messages.

---

2) **Client reconnect race due mutable `this.ws` in callbacks**  
`packages/tui-client/src/connection.ts:59-71, 84-90`

```ts
this.ws = new WebSocket(this.url);
this.ws.on("open", () => { this.ws!.send(JSON.stringify(hello)); });
this.ws.on("close", () => {
  this.ws = null;
  this.scheduleReconnect();
});
```

Callbacks capture mutable `this.ws`, not the specific socket instance. A stale socket's `close` can null out a newer active connection and trigger bogus reconnects.  
**Fix**: capture `const ws = new WebSocket(...)`; in every handler guard with `if (this.ws !== ws) return`.

---

3) **`WsServer.start()` has no bind-error handling (can crash/hang startup)**  
`packages/server/src/ws-server.ts:64-71`

```ts
return new Promise((resolve) => {
  this.wss = new WebSocketServer({ port: this.port }, () => resolve());
  this.wss.on("connection", ...);
});
```

No `error` listener/reject path (e.g., `EADDRINUSE`). Startup may throw asynchronously or never resolve.  
**Fix**: add `once("error", reject)` and cleanup.

---

4) **Unhandled exceptions when relaying to dead pi process**  
`packages/server/src/ws-server.ts:186-187, 235-238`

```ts
this.piProcess.send(message.payload); // no try/catch
...
this.uiBridge.registerRequest(...).then((response) => {
  this.piProcess.send(response); // no catch
});
```

`PiProcess.send()` throws if stdin not writable. These paths can produce uncaught exceptions/unhandled rejections under process failure.  
**Fix**: wrap sends in try/catch and emit `PI_PROCESS_ERROR` to client; add `.catch(...)` on promise chain.

---

### 🟡 Issues (should fix)

5) **Graceful shutdown likely exits with error code 1**  
`packages/server/src/cli.ts:128-133, 155-160`

```ts
piProcess.onExit(() => { ... process.exit(1); });
...
const shutdown = async () => {
  await wsServer.stop();
  await piProcess.stop();
  process.exit(0);
};
```

Expected shutdown triggers `onExit`, which unconditionally calls `process.exit(1)`.  
**Fix**: track `isShuttingDown` and suppress error-exit during intentional stop.

---

6) **Extension select dialog can crash on empty options + stale local state across requests**  
`packages/tui-client/src/app.tsx:391-393, 448`

```ts
const [selectedIndex, setSelectedIndex] = useState(0);
...
onRespond({ value: options[selectedIndex]!.value });
```

If `options` is empty, non-null assertion crashes. Also `inputValue/selectedIndex` are initialized once and may leak between different dialog requests.  
**Fix**: guard empty arrays; reset local state on `request.id` changes (`useEffect` or keyed component).

---

7) **Unsafe casting without runtime validation in protocol/transport boundaries**  
Examples:
- `packages/protocol/src/types.ts:192-197` (`isHelloMessage` only checks `type`)
- `packages/server/src/ws-server.ts:128,161`
- `packages/tui-client/src/connection.ts:152,171`

```ts
const hello = parsed as HelloMessage;
this.handleClientMessage(parsed as ClientMessage);
this.events.onWelcome?.(message as unknown as WelcomeMessage);
```

With malformed network payloads this can silently mis-handle data and create hard-to-debug states.  
**Fix**: strengthen guards (at least required fields/types), ideally schema-validate wire messages.

---

8) **Pending command lifecycle cleanup is incomplete**  
`packages/server/src/ws-server.ts:49-50, 77-92, 295-303`

`pendingPiCommands` callbacks/timeouts are not explicitly drained on `stop()`. Timeout cleanup relies on timer expiry only.  
**Fix**: store timeout handles in map entries, clear/reject all on stop.

---

9) **Package metadata inconsistencies**
- Engine mismatch:
  - root `package.json:21-23` => `>=24`
  - package README says `Node.js ≥ 22` (`README.md:117-120`)
  - server/client package engines are `>=22` (`packages/server/package.json:48-50`, `packages/tui-client/package.json:49-50`)
- `files` entries include `README.md` and `LICENSE` in each package (`packages/*/package.json:14-22`), but those files are absent in package dirs.

This can confuse consumers and release automation.  
**Fix**: align engine constraints and ensure packaged files actually exist (or adjust `files`).

---

## Requested Topic Breakdown

### 1) Test Coverage Gaps
- Strong coverage: command routing/discovery and reducer behavior.
- Weak/no coverage: protocol package, `PiProcess`, `UIBridge`, server CLI, connection manager, editor/app UI.
- Highest risk: connection + handshake + process-failure paths.

### 2) Error Handling
- Missing catches in relay paths (pi send failures).
- Startup bind errors not handled in `WsServer.start`.
- Intentional shutdown currently treated like fatal crash.

### 3) TypeScript Strictness
- Strict mode is enabled globally ✅.
- But many trust-casts at network boundaries (`as HelloMessage`, `as ClientMessage`, etc.) reduce safety.
- Add runtime shape checks for wire inputs.

### 4) Memory/Resource Leaks
- `pendingPiCommands` cleanup incomplete on stop.
- Potential stale socket callbacks in client connection (also race condition).
- `PiProcess` lifecycle mostly okay, but no explicit teardown API for message handler subscription design.

### 5) Race Conditions
- Server handshake race (multi-client overlap).
- Client websocket instance race (`this.ws` mutation across callbacks).

### 6) Code Quality
- `WsServer.clientId` appears unused (`packages/server/src/ws-server.ts:42,140,155,167`).
- Reducer uses module-level mutable `messageCounter` (`packages/tui-client/src/state.ts:108`), making reducer impure/difficult to reason about.

### 7) Dependency Audit
- Runtime deps are lean and appropriate overall.
- Suggest explicitly adding `@types/node` in packages using Node APIs (currently likely transitively available).
- External-network E2E test (`packages/server/test/e2e.test.ts`) is good for smoke but should be marked/isolated in CI.

### 8) Build/Package Config
- Build passes across workspaces.
- Metadata inconsistencies (engines + missing packaged docs/licenses) should be fixed pre-1.0.

---

## Regression Risk

**Highest risk areas for 1.0**:
1. WebSocket connection lifecycle (races in both server and client)  
2. pi process failure paths (uncaught exceptions)  
3. Startup/shutdown reliability (port bind errors, exit codes)

These are operational stability issues, not style nits.

---

## TDD Assessment

Mixed. There are solid tests around core happy-path behavior, but many critical lifecycle/error modules have no tests (`pi-process`, `ui-bridge`, `connection`, CLI parsers). This does **not** look fully TDD for failure modes and concurrency paths.
