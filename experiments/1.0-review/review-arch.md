# Architecture Review (_arch-reviewer)

Now I have a full picture of the codebase. Here's the review.

---

## Summary Verdict

This is a well-structured, readable codebase with a clean layering story — but it is **not 1.0 ready**. The three critical problems are: (1) zero security — no auth, no TLS, open to anyone on the network; (2) several protocol commitments that are already wrong and will require breaking changes if shipped; and (3) a fundamental unresolved design conflict between the vision.md and the implemented architecture that will confuse every future contributor. The core relay works and the testing discipline is good, but shipping this as 1.0 would mean committing to a protocol with meaningful design mistakes baked in.

---

## Strengths

**Clean protocol layering.** The `@marcfargas/pi-server-protocol` package as the single source of truth for wire types is the right call. Type guards (`isHelloMessage`, `isClientMessage`) at the boundary are good practice.

**IPiTransport abstraction.** Injecting `IPiTransport` into `WsServer` and having a `MockPiTransport` for tests is the correct design. The relay tests described in AGENTS.md can fully cover the server path without spawning real pi. This is exactly right.

**UIBridge isolation.** Pulling extension UI dialog management into its own class with timeout/cancel semantics is a clean separation. The fire-and-forget vs. dialog distinction is clear and explicit.

**commands package intent.** Codifying builtin commands as data (`BUILTIN_COMMANDS`) rather than scattered switch statements, and having `toRpc()` as the single mapping function, is the right direction regardless of where the routing ultimately lives.

**State reducer design.** The flux-style reducer in `state.ts` is testable, predictable, and handles the reconnect-and-replay story cleanly (LOAD_HISTORY replaces all state).

---

## Critical Issues

### 1. Zero security shipped in a "1.0" — not a roadmap item, a blocker

**What's wrong:** The `auth` field in `HelloMessage` is explicitly marked "Server ignores in protocol v1." There's no TLS, no origin checking on WebSocket connections, no rate limiting. Anyone who can reach the port (including any local process, any network peer if the port is exposed) can connect and send arbitrary RPC commands to the agent — including `abort`, `new_session`, or worst, `prompt` with malicious content.

**Why it matters:** This isn't hardening, it's basic viability. A server running as a daemon on a dev machine will typically bind to `0.0.0.0:3333`. On any shared machine or exposed network, this is a remote code execution surface — the agent can run bash commands.

**What to do instead:**
- Ship a `--token` flag. Server generates or reads a token. Client sends it in `HelloMessage.auth`. Server rejects without it. Four hours of work max.
- Document that `wss://` is the user's responsibility to proxy (nginx/caddy in front). Don't ship native TLS, but document the setup.
- Add `--bind 127.0.0.1` default so the server doesn't listen on all interfaces unless explicitly asked.

### 2. `lastSeq` is a protocol lie

**What's wrong:** `HelloMessage` includes `lastSeq?: number` with the comment "Reserved for future reconnect." `Connection.ts` actually sends it (`lastSeq: this.lastSeq > 0 ? this.lastSeq : undefined`). The server (`ws-server.ts`) never reads it and has no replay capability. The `clientId` in connection.ts is `randomUUID()` called in the constructor — meaning it resets on every process restart, so cross-restart gap recovery is impossible by design.

**Why it matters:** Shipping v1 with `lastSeq` in the protocol sends a contract to all clients: "we will use this for recovery." Building delta replay later requires server-side event log persistence, which is a major architectural addition. If we're not doing it in v1, the field should not be in the protocol. If it ships in v1, we're committed to semantic behavior we haven't defined.

**What to do instead:** Remove `lastSeq` from `HelloMessage` for v1. The current reconnect story is: client reconnects → server sends full state via `WelcomeMessage` → client re-renders from scratch. That works. Document it. `lastSeq` can be added in v2 when you have actual replay.

### 3. The architecture has an unresolved identity crisis: client-side vs. server-side command routing

**What's wrong:** `AGENTS.md` says: *"Builtin command knowledge lives in packages/commands, a shared client library — NOT in the server. Each client imports this library."* The `vision.md` says the opposite: *"A Unified Command Layer in pi-server that normalizes all commands into a single interface for clients. Clients send `/model gemini-2.5-flash` and get back a consistent response."*

The currently implemented code follows the AGENTS.md path: `packages/commands` is a client library that the TUI imports and uses to route commands before sending to the server. This means:
- A future web client must re-implement `routeInput()` and `BUILTIN_COMMANDS` in its own language
- Any bug in routing is per-client, not fixed in one place
- The server is a pure relay, so it can never enforce routing semantics or add server-side command validation

But the `vision.md` is the better design for a multi-client system.

**Why it matters:** This decision shapes the protocol permanently. If server-side routing is the goal, then `ClientCommandMessage.payload` should include slash commands as a new message type (e.g., `{ type: "slash_command", command: "/model", args: "..." }`). If client-side routing is the goal, `vision.md` is wrong and should be deleted or archived. You cannot ship 1.0 with an unresolved contradiction in your design documents that directly affects the protocol.

**What to do instead:** Make a decision now. My recommendation: keep client-side routing for v1 (it's already implemented, it works, and the commands package is usable by TypeScript/JS clients). Archive `vision.md` as "v2 consideration." The vision is more powerful but adds protocol complexity (server must parse commands it currently relays). If you go server-side, you need a new message type in v1 before locking the protocol.

### 4. Pi process crash is silent to clients, fatal to server

**What's wrong:** In `cli.ts`, the `piProcess.onExit` handler logs and calls `process.exit(1)`. In `ws-server.ts`, there's no exit handler at all — when pi dies, messages just stop arriving. The connected client gets no notification; it just stops receiving events. Eventually the user sees a hung terminal.

**Why it matters:** Process crashes are not rare — API key issues, pi bugs, OOM. The current behavior makes it impossible to distinguish "agent is thinking" from "agent is dead." For a daemon meant to run headlessly, this is a reliability failure.

**What to do instead:**
- `WsServer` should accept an exit callback or emit an event when the transport signals process death
- On pi exit, the server should send `{ type: "error", code: "PI_PROCESS_ERROR", message: "..." }` to the connected client before closing
- The client should render this clearly instead of hanging in a connecting loop

### 5. PiProcess.send() unhandled throw in steady state

**What's wrong:** `PiProcess.send()` throws `Error("Pi process not running or stdin not writable")` if the process has died. `WsServer.handleClientMessage()` calls `this.piProcess.send(message.payload)` with no try/catch. This is an unhandled exception at the top-level WebSocket message handler — it will crash the server process entirely in production.

```ts
// ws-server.ts, handleClientMessage → case "command":
this.piProcess.send(message.payload);  // no catch
```

**What to do instead:** Wrap in try/catch. Send `{ type: "error", code: "PI_PROCESS_ERROR" }` to the client. This is a 5-line fix.

### 6. serverId is hardcoded and non-persistent

**What's wrong:** `getServerId()` in `ws-server.ts` returns the literal string `"pi-server-1"`. The comment says "In production, derive from config or persist across restarts." Clients display this in the status bar and can theoretically use it to verify they're talking to the same server instance after reconnect.

**Why it matters:** This is a protocol commitment: `WelcomeMessage.serverId` is typed as a field clients receive and can act on. Shipping it as a hardcoded constant means all clients in production will show the same server ID, making it useless for distinguishing servers. If you add multi-server scenarios later, this is already broken.

**What to do instead:** Generate a UUID at server startup and persist it to a state file in CWD (e.g., `.pi-server-id`). Or generate per-process and just document it resets on restart. Either is fine — but decide and implement it before 1.0.

---

## Suggestions

**S1. Remove `auth` from the protocol type until you implement it.** The field existing in `HelloMessage` but being "ignored" creates a false sense of security. A user might set it thinking it protects them. Either implement it (see Critical Issue #1) or remove the field from v1.

**S2. `messageCounter` in state.ts is module-level mutable state.** `let messageCounter = 0` at module scope is a React anti-pattern — it survives hot module reloads and would be shared across multiple component instances in test environments. Move it inside the reducer (store it in `AppState`) or use `Date.now() + Math.random()` for ID generation.

**S3. Reconnect backoff is fixed at 2 seconds, no cap.** In `connection.ts`, `scheduleReconnect()` always uses 2000ms. If the server is down for 10 minutes, the client hammers it every 2 seconds. Standard exponential backoff with jitter (2s, 4s, 8s, ... cap at 30s) is the right approach and 10 lines of code.

**S4. No keepalive timeout on the server side.** The server sends `pong` on `ping` but never sends `ping` itself and never times out a client that stops responding. A zombie TCP connection can hold the single client slot indefinitely. The server should send a `ping` every 30s and close the connection if no pong arrives within 10s. The `ws` library supports this natively via `WebSocket.ping()`.

**S5. `ServerExtensionUIRequest` uses `[key: string]: unknown` spread.** The type is:
```ts
export interface ServerExtensionUIRequest {
  type: "extension_ui_request";
  seq: number;
  id: string;
  method: string;
  [key: string]: unknown;  // ← this
}
```
This means the pi internal message shape bleeds directly through the protocol with no type safety. At minimum, document the known fields (`title`, `message`, `options`, `defaultValue`). Better: define the known fields explicitly and add `[key: string]: unknown` only for forward compatibility.

**S6. `sendPiCommand` timeout is 10s but `buildWelcomeMessage` runs both queries in parallel.** If `get_state` returns in 9.9s and `get_messages` times out, the welcome is rejected. For a reconnecting client, this could mean repeated failed reconnects during heavy load. Consider a combined timeout on the whole `buildWelcomeMessage` call rather than per-query.

**S7. `extensionUITimeoutMs` has no validation.** A `NaN` or negative value passed via `--ui-timeout` would silently break timeout behavior. The CLI parses it with `parseInt` but doesn't validate. Add a sanity check.

**S8. `ServerConfig` in types.ts is never transmitted.** It's documented as "subset exposed to protocol for documentation" but appears nowhere in any sent message. This is dead type that suggests `WelcomeMessage` should include server config but doesn't. Either include config in `WelcomeMessage` or delete `ServerConfig` from the protocol package.

**S9. History parsing in state.ts has no error boundary.** `parseHistoryMessages()` does heavy casting (`m.role as string`, etc.) with no try/catch. A malformed message from pi's get_messages will throw inside the reducer, crashing the Ink app. Wrap it.

**S10. The `//` client-only command prefix is undiscoverable.** Users see `//quit`, `//help`, etc. only if they know to ask. The `//help` command should print its own existence somewhere on connect — even a dim one-liner in the status area.

---

## Questions for the Author

**Q1. What is the intended deployment model for 1.0?** Is this localhost-only (developer runs it on their own machine, connects from same machine), or remote (run on a server, connect over the internet)? This changes the security requirements substantially. If localhost-only, a simple `--bind 127.0.0.1` default with a warning is adequate. If remote, TLS + auth are hard blockers.

**Q2. Will there ever be read-only clients?** The single-client limitation (`if (this.client)` in `ws-server.ts:handleConnection`) is documented as "rw mode only, no ro for MVP." The vision mentions "multi-agent orchestration." If read-only observer clients are in scope for 1.x, the protocol needs a role field in `HelloMessage` before v1 locks. Adding it later is a breaking change.

**Q3. What's the compatibility commitment for protocol v1?** The server rejects with `INCOMPATIBLE_PROTOCOL` on version mismatch — strict equality, no negotiation. That's fine for pre-1.0. For 1.0, you need a policy: is v1 "stable forever," "stable until 2.0," or "best-effort"? This affects whether the issues above (like `lastSeq`) are "fix before release" or "we'll deal with it in v2."

**Q4. Should the commands package be published separately?** It's currently in the monorepo and imported by the TUI client. If the design decision (Critical Issue #3) goes "client-side routing," then `@marcfargas/pi-server-commands` becomes a public contract that third-party clients depend on. That means it needs its own versioning story, documentation, and stability guarantees — separate from the server. Is that the intent?

**Q5. What does "reconnect with full state restoration" mean for long conversations?** `get_messages` returns the full history. For a session with 200 turns and 50+ tool calls, the `WelcomeMessage` could be megabytes. Is there a size concern? Has this been tested with long sessions? If history can be large, the welcome message path needs streaming or pagination before 1.0.
