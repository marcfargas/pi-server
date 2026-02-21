# 1.0 Release Readiness — Synthesis

**Date**: 2026-02-21  
**Reviewers**: _arch-reviewer (architecture), _code-reviewer (code quality)  
**Verdict**: 🔴 **Not ready for 1.0** — critical protocol, security, and reliability issues must be resolved first

---

## Executive Summary

Both reviewers agree the codebase has **strong foundational design** (clean protocol layering, IPiTransport abstraction, good reducer pattern, solid happy-path testing). However, **three critical blockers** prevent 1.0 release:

1. **Zero security** — no auth, binds to 0.0.0.0 by default, anyone on network can control agent
2. **Protocol contains unimplemented commitments** — `lastSeq` field shipped but unused, creating false contract
3. **Unresolved architectural contradiction** — vision.md and AGENTS.md disagree on command routing design, affecting protocol shape

Additionally, **4 reliability bugs** (handshake race, reconnect race, startup error handling, unhandled pi death) make the server unsuitable for even localhost daemon use.

**Recommended path**: Resolve protocol architecture decision first (client-side vs server-side routing), then implement auth, fix reliability bugs, and close test gaps. Estimated total effort: **3-4 weeks** with parallel streams.

---

## Unanimous Verdicts

### What ALL reviewers agree on

**Critical issues blocking 1.0:**
- **No authentication or authorization** — anyone who can reach the port can send arbitrary commands to the agent (Arch #1)
- **`lastSeq` is a protocol lie** — field exists in HelloMessage but server never reads it; shipping creates unimplementable contract (Arch #2)
- **Single-client handshake race** — two simultaneous connections can both pass initial check, second overwrites first (Code #1)
- **Client reconnect race** — mutable `this.ws` in callbacks causes stale socket close events to kill active connections (Code #2)
- **Pi process death is silent** — when pi crashes, client sees infinite hang instead of error (Arch #4, Code #4)
- **Server startup can hang/crash** — no error handling for port-in-use or bind failures (Code #3)

**Strengths to preserve:**
- Clean protocol layering with `@marcfargas/pi-server-protocol` as single source of truth
- IPiTransport abstraction enabling full relay testing without spawning real pi
- UIBridge isolation with clear timeout/cancel semantics
- Flux-style state reducer with clean reconnect story
- Codified builtin commands as data (`BUILTIN_COMMANDS`)

**Test coverage gaps** (both reviewers):
- Protocol package type guards completely untested (critical for wire safety)
- PiProcess, UIBridge, Connection lifecycle untested
- Error paths and race conditions largely untested
- CLI argument parsing untested

---

## Key Divergences

### Severity of serverId issue (Arch #6 vs Code review)

**Architecture reviewer**: serverId hardcoded to `"pi-server-1"` is a **protocol commitment** that will break multi-server scenarios; must fix before 1.0.

**Code reviewer**: Did not flag this as blocker, focused on operational reliability.

**Resolution needed**: Human decision — is multi-server support in scope for v1? If yes, this is MUST. If no, can defer to v2.

### Test coverage prioritization

**Architecture reviewer**: Emphasized protocol/semantic correctness, long-session WelcomeMessage size concerns (Q5).

**Code reviewer**: Emphasized operational paths (handshake races, pi-process lifecycle, startup/shutdown).

**Consensus**: Both are right — need both semantic tests (protocol guards, version contracts) and operational tests (races, failures).

---

## Critical Issues (Must Address)

Ordered by severity and blocking impact.

### Protocol Design (Stream C)

| ID | Issue | Blocker? | Effort |
|----|-------|----------|--------|
| **C-1** | **Architecture decision required: client-side vs server-side command routing** (Arch #3) | 🔴 YES | **L** |
| | vision.md says server routes commands, AGENTS.md+code say client routes. Cannot ship with this contradiction. Decision affects protocol message types. | | |
| | **Action**: Make decision (recommend: keep client-side for v1, archive vision.md), update docs, confirm protocol message types are correct. | | |
| **C-2** | **Remove `lastSeq` from HelloMessage** (Arch #2) | 🔴 YES | **S** |
| | Field is sent by client, ignored by server, implies replay capability that doesn't exist. | | |
| | **Action**: Delete field from protocol types, remove from Connection.ts send logic, document v1 reconnect as "full state reload." | | |
| **C-3** | **Remove `auth` field OR implement it** (Arch #1, S1) | 🔴 YES | **S** |
| | Field marked "ignored in v1" creates false security. Either implement (see A-1) or remove entirely. | | |
| | **Action**: If implementing auth (A-1), keep field. Otherwise delete from HelloMessage type. | | |
| **C-4** | **Strengthen protocol type guards** (Code #7) | 🔴 YES | **M** |
| | `isHelloMessage` only checks `type`, unsafe casts at boundaries (`as HelloMessage`). Malformed wire data causes silent bugs. | | |
| | **Action**: Add required field checks to all type guards (`isHelloMessage`, `isClientMessage`, etc.), ideally schema validation (zod). | | |

### Server Reliability (Stream A)

| ID | Issue | Blocker? | Effort |
|----|-------|----------|--------|
| **A-1** | **Implement token-based auth** (Arch #1) | 🔴 YES | **M** |
| | Server binds to 0.0.0.0 by default, no auth. Anyone on network can send commands to agent. | | |
| | **Action**: Add `--token <string>` flag (or auto-generate UUID). Server validates HelloMessage.auth, rejects on mismatch. Document in README. | | |
| **A-2** | **Bind to 127.0.0.1 by default** (Arch #1) | 🔴 YES | **S** |
| | Localhost-only reduces attack surface until auth is solid. | | |
| | **Action**: Change default `--host` to `127.0.0.1`, document `--host 0.0.0.0` for intentional network exposure. | | |
| **A-3** | **Send error to client when pi process dies** (Arch #4, Code #4) | 🔴 YES | **M** |
| | Currently clients see infinite hang. No way to distinguish "agent thinking" from "agent dead." | | |
| | **Action**: WsServer accepts exit callback from PiProcess. On exit, send `{type:"error", code:"PI_PROCESS_ERROR"}` to client, then close socket. Client renders error clearly. | | |
| **A-4** | **Wrap pi relay sends in try/catch** (Arch #5, Code #4) | 🔴 YES | **S** |
| | `PiProcess.send()` throws if stdin not writable. Uncaught at top-level message handler = server crash. | | |
| | **Action**: Wrap `this.piProcess.send(...)` calls in try/catch, send `PI_PROCESS_ERROR` to client on failure. Add `.catch()` to UIBridge promise chain. | | |
| **A-5** | **Handle WebSocketServer startup errors** (Code #3) | 🔴 YES | **S** |
| | No `error` listener on `new WebSocketServer()`. EADDRINUSE or permission errors hang or crash. | | |
| | **Action**: Add `wss.once('error', reject)` in `WsServer.start()`, cleanup on failure. | | |
| **A-6** | **Fix single-client handshake race** (Code #1) | 🔴 YES | **M** |
| | Two connections before hello both pass initial `if (this.client)` check. Second overwrites first. | | |
| | **Action**: Reserve slot on TCP connect (set `this.client = ws` immediately with "pending" flag), or track pending handshakes map. Validate `this.client === ws` in message handlers. | | |
| **A-7** | **Fix graceful shutdown exit code** (Code #5) | 🟡 Should | **S** |
| | Intentional shutdown triggers `piProcess.onExit` which calls `process.exit(1)`. | | |
| | **Action**: Track `isShuttingDown` flag, suppress error exit in `onExit` handler when true. | | |
| **A-8** | **Clean up pending commands on stop** (Code #8) | 🟡 Should | **S** |
| | `pendingPiCommands` timeouts not explicitly cleared on `WsServer.stop()`. | | |
| | **Action**: Store timeout handles in map entries, clear all and reject promises on stop. | | |

### Client Reliability (Stream B)

| ID | Issue | Blocker? | Effort |
|----|-------|----------|--------|
| **B-1** | **Fix client reconnect race** (Code #2) | 🔴 YES | **M** |
| | Callbacks capture mutable `this.ws`. Stale socket close can null out active connection. | | |
| | **Action**: Capture `const ws = new WebSocket()` in local scope, guard all handlers with `if (this.ws !== ws) return`. | | |
| **B-2** | **Guard extension dialog empty options** (Code #6) | 🔴 YES | **S** |
| | `options[selectedIndex]!.value` crashes if options array is empty. | | |
| | **Action**: Check `options.length > 0` before rendering select, disable submit or show error if empty. | | |
| **B-3** | **Fix extension dialog state leak** (Code #6) | 🟡 Should | **S** |
| | `inputValue/selectedIndex` state initialized once, leaks between different requests. | | |
| | **Action**: Reset state via `useEffect` when `request.id` changes, or use keyed component. | | |
| **B-4** | **Implement exponential backoff for reconnect** (Arch S3) | 🟡 Should | **S** |
| | Fixed 2s retry interval hammers server during long outages. | | |
| | **Action**: Implement standard exponential backoff with jitter: 2s, 4s, 8s, 16s, cap at 30s. | | |
| **B-5** | **Move messageCounter into reducer state** (Arch S2) | 🟡 Should | **S** |
| | Module-level mutable state is anti-pattern, survives HMR. | | |
| | **Action**: Store counter in `AppState` or use `Date.now() + Math.random()` for IDs. | | |
| **B-6** | **Add error boundary for history parsing** (Arch S9) | 🟡 Should | **S** |
| | `parseHistoryMessages()` does unsafe casts, malformed pi output crashes Ink app. | | |
| | **Action**: Wrap in try/catch, log error, return empty array on failure. | | |
| **B-7** | **Make //help discoverable** (Arch S10) | 🟢 Could | **S** |
| | Users don't know about client commands unless told. | | |
| | **Action**: Print dim one-liner on connect: "Type //help for client commands". | | |

---

## Suggestions (Should Address)

These improve quality but aren't release blockers.

### Protocol Polish (Stream C)

| ID | Issue | Effort |
|----|-------|--------|
| **C-5** | **Document ServerExtensionUIRequest known fields** (Arch S5) | **S** |
| | `[key: string]: unknown` spreads pi internal message shape with no docs. | |
| | **Action**: Document known fields (title, message, options, defaultValue) in type comments or README. |
| **C-6** | **Delete ServerConfig dead type** (Arch S8) | **S** |
| | Type appears in protocol package but is never transmitted. | |
| | **Action**: Remove from `packages/protocol/src/types.ts` or include in WelcomeMessage if intended. |
| **C-7** | **Unified timeout for buildWelcomeMessage** (Arch S6) | **S** |
| | Parallel queries with per-query timeout can fail reconnect if one times out late. | |
| | **Action**: Use `Promise.race()` with combined timeout on whole buildWelcomeMessage call. |

### Server Hardening (Stream A)

| ID | Issue | Effort |
|----|-------|--------|
| **A-9** | **Implement server-side keepalive** (Arch S4) | **M** |
| | No ping from server, zombie connections hold client slot indefinitely. | |
| | **Action**: Send ping every 30s, close connection if no pong within 10s (use `ws` library built-in). |
| **A-10** | **Validate CLI args** (Arch S7) | **S** |
| | `--ui-timeout` parsed with `parseInt`, no validation. NaN or negative breaks timeouts. | |
| | **Action**: Check `isNaN()` and `> 0`, exit with error if invalid. |
| **A-11** | **Document TLS proxy setup** (Arch #1) | **S** |
| | Don't implement native TLS, but document nginx/caddy wss:// proxy pattern. | |
| | **Action**: Add "Deployment" section to server README with reverse proxy example. |
| **A-12** | **Remove unused WsServer.clientId field** (Code review) | **S** |
| | Field set but never read. | |
| | **Action**: Delete from `ws-server.ts` if confirmed unused. |

### Client Polish (Stream B)

| ID | Issue | Effort |
|----|-------|--------|
| **B-8** | **Implement/document serverId persistence** (Arch #6) | **M** |
| | Hardcoded `"pi-server-1"` means all servers look identical. | |
| | **Action**: Generate UUID at startup, persist to `.pi-server-id` file, or document it's ephemeral per-process. |

---

## Open Questions

These require human decisions before work can proceed.

### Q1. Deployment model for 1.0? (Arch Q1)

Is pi-server intended for:
- **Localhost-only** (dev runs on own machine, connects locally)?  
  → `--bind 127.0.0.1` default + token auth is adequate
- **Remote** (run on server, connect over internet)?  
  → TLS + strong auth are hard requirements

**Impacts**: A-1 (auth complexity), A-2 (bind default), A-11 (TLS docs)

### Q2. Read-only clients in v1 scope? (Arch Q2)

Will there ever be observer clients (read-only, no command sending)?  
- If **yes**: Need role field in HelloMessage NOW (adding later = breaking change)
- If **no**: Single-client `this.client` slot is fine for v1

**Impacts**: C-1 (protocol message types)

### Q3. Protocol v1 compatibility commitment? (Arch Q3)

What's the stability promise for protocol v1?
- **"Stable forever"** → must fix all issues now (lastSeq, auth field, etc.)
- **"Stable until v2"** → can defer some protocol cleanup
- **"Best-effort"** → can break in patches

**Impacts**: Prioritization of C-2, C-3, C-4

### Q4. Should commands package be published separately? (Arch Q4)

If client-side routing is chosen (C-1), third-party clients will depend on `@marcfargas/pi-server-commands`.  
- If **yes**: Needs own versioning, docs, stability guarantees
- If **no**: Can keep as internal monorepo package

**Impacts**: Documentation, release process, semver policy

### Q5. Large WelcomeMessage size concern? (Arch Q5)

`get_messages` returns full history. For 200-turn sessions, WelcomeMessage could be megabytes.  
- Has this been tested with long sessions?
- Is streaming/pagination needed before v1?

**Impacts**: Protocol design, performance testing requirements

### Q6. Multi-server support in v1? (Synthesis divergence)

Architecture reviewer flagged hardcoded serverId as protocol commitment. Code reviewer didn't.  
- Is distinguishing between multiple server instances a v1 requirement?  
- If **yes**: B-8 becomes MUST  
- If **no**: Can defer to v2

**Impacts**: B-8 priority

---

## Test Coverage Gaps (Stream D)

### MUST add tests

| Module | What to test | Effort |
|--------|-------------|--------|
| **packages/protocol/src/types.ts** | All type guards (`isHelloMessage`, etc.) with valid/invalid/malformed inputs | **M** |
| **packages/protocol/src/version.ts** | Version comparison, compatibility checks | **S** |
| **packages/server/src/pi-process.ts** | Startup failure (bad path, spawn error), stop semantics, exit handling | **M** |
| **packages/tui-client/src/connection.ts** | Reconnect ordering, race with close/open, message buffering | **M** |

### SHOULD add tests

| Module | What to test | Effort |
|--------|-------------|--------|
| **packages/server/src/ui-bridge.ts** | Timeout behavior, cancel before response, concurrent requests | **M** |
| **packages/server/src/ws-server.ts** | Handshake error paths, concurrent connections, pi death during request | **M** |
| **packages/server/src/cli.ts** | Arg parsing (valid/invalid), shutdown signal handling | **S** |
| **packages/tui-client/src/app.tsx** | Extension dialog rendering, event handlers, keyboard nav | **M** |
| **packages/tui-client/src/editor.tsx** | Input history navigation, cursor positioning | **M** |

### COULD add tests

| Module | What to test | Effort |
|--------|-------------|--------|
| **packages/commands/src/catalog.ts** | `toRpc()` edge cases (malformed commands, unknown types) | **S** |
| **packages/commands/src/discovery.ts** | Invalid source values, missing metadata | **S** |
| **packages/commands/src/router.ts** | Malformed slash inputs, empty strings, unicode | **S** |

---

## Package Metadata (Stream D)

| ID | Issue | Effort |
|----|-------|--------|
| **D-1** | **Align Node.js engine constraints** (Code #9) | **S** |
| | Root says `>=24`, packages say `>=22`, README says `≥22`. Pick one. | |
| | **Action**: Decide minimum version (recommend `>=22` for broader compatibility), update all package.json + README. |
| **D-2** | **Fix package files entries** (Code #9) | **S** |
| | `files` includes `README.md` and `LICENSE` but they don't exist in package dirs. | |
| | **Action**: Copy root LICENSE/README to each package, or remove from `files` array. |

---

## Work Stream Organization

### Dependency Graph

```
C-1 (architecture decision) ← MUST BE FIRST
  ├─> C-2, C-3, C-4 (protocol cleanup)
  ├─> A-1, A-2 (auth depends on C-1 answer)
  └─> Q4 (commands package publication)

A-1, A-2, A-3, A-4, A-5, A-6 ← Can run in parallel after C-1
B-1, B-2 ← Can run in parallel anytime
D (tests) ← Can start anytime, but testing fixes requires A+B fixes
```

### Stream A: Server Hardening (auth, security, reliability)

**Dependencies**: Must resolve C-1 (architecture decision) first. A-1 depends on C-3 (auth field).

**Estimated effort**: 2 weeks (1 dev)

**MoSCoW breakdown**:
- **MUST** (13 days): A-1, A-2, A-3, A-4, A-5, A-6
- **SHOULD** (3 days): A-7, A-8, A-9, A-10, A-11
- **COULD**: A-12 (1 day)

**Parallel subtasks** (can run simultaneously):
1. Auth + bind (A-1, A-2) — 4 days
2. Process failure handling (A-3, A-4) — 3 days
3. Startup/handshake (A-5, A-6) — 4 days
4. Shutdown/cleanup (A-7, A-8) — 2 days

### Stream B: TUI Client Polish

**Dependencies**: None (can run in parallel with A)

**Estimated effort**: 1 week (1 dev)

**MoSCoW breakdown**:
- **MUST** (4 days): B-1, B-2
- **SHOULD** (3 days): B-3, B-4, B-5, B-6
- **COULD** (1 day): B-7, B-8

**Parallel subtasks**:
1. Connection fixes (B-1) — 2 days
2. Dialog fixes (B-2, B-3) — 2 days
3. Polish (B-4, B-5, B-6, B-7) — 3 days

### Stream C: Protocol Finalization

**Dependencies**: NONE — this must go FIRST

**Estimated effort**: 1 week (1 dev, includes Q&A with stakeholders)

**MoSCoW breakdown**:
- **MUST** (5 days): C-1, C-2, C-3, C-4
- **SHOULD** (2 days): C-5, C-6, C-7
- **COULD**: (none)

**Critical path**:
1. **Day 1**: Answer Q1-Q6 (stakeholder decisions)
2. **Day 2-3**: C-1 (architecture decision, update vision.md or AGENTS.md)
3. **Day 4**: C-2, C-3 (protocol field cleanup)
4. **Day 5**: C-4 (type guards)
5. **Day 6-7**: C-5, C-6, C-7 (polish)

### Stream D: Test Coverage + Docs

**Dependencies**: Can start immediately, but testing fixes requires A+B implementations

**Estimated effort**: 1.5 weeks (1 dev)

**MoSCoW breakdown**:
- **MUST** (7 days): Protocol tests, PiProcess tests, Connection tests, D-1, D-2
- **SHOULD** (4 days): UIBridge tests, WsServer error tests, CLI tests, App/Editor tests
- **COULD** (2 days): Commands edge case tests

**Parallel subtasks**:
1. Protocol + version tests — 3 days
2. Server lifecycle tests — 3 days
3. Client lifecycle tests — 2 days
4. Metadata cleanup — 1 day

---

## Concrete Task List

### PHASE 0: Protocol Architecture Decision (BLOCKING — do first)

#### Task C-1.1: Resolve command routing architecture
**Owner**: Lead developer  
**Effort**: L (3 days including stakeholder discussion)  
**Files**:
- `vision.md`
- `.pi/AGENTS.md`
- `packages/protocol/src/types.ts`

**What to do**:
1. Answer Arch Q1-Q6 (see Open Questions section) — requires stakeholder input
2. Make decision: client-side routing (current) vs server-side routing (vision.md)
3. If **client-side** (recommended for v1):
   - Archive `vision.md` to `docs/future/server-side-routing.md`
   - Confirm AGENTS.md accurately describes current design
   - Verify protocol message types don't need slash_command type
4. If **server-side**:
   - Add new message type to protocol: `SlashCommandMessage`
   - Plan migration path for server to parse commands
   - Update AGENTS.md to match vision.md

**Acceptance**:
- [ ] Q1-Q6 answered in writing (save to `experiments/1.0-review/decisions.md`)
- [ ] vision.md and AGENTS.md no longer contradict each other
- [ ] Protocol message types finalized for v1
- [ ] Document decision in `experiments/1.0-review/decisions.md`

**Dependencies**: None — blocks everything else

---

### PHASE 1: Protocol Cleanup (after C-1)

#### Task C-2.1: Remove lastSeq from protocol
**Owner**: Any dev  
**Effort**: S (2 hours)  
**Files**:
- `packages/protocol/src/types.ts` (HelloMessage interface)
- `packages/tui-client/src/connection.ts` (remove lastSeq from hello construction)
- `README.md` or `docs/protocol.md` (document reconnect behavior)

**What to do**:
1. Delete `lastSeq?: number` from `HelloMessage` interface
2. Remove `lastSeq: this.lastSeq > 0 ? this.lastSeq : undefined` from Connection.ts
3. Add comment to HelloMessage: "v1 reconnect provides full state via WelcomeMessage"
4. Document in README: "Reconnect behavior: client receives full history on each connect"

**Acceptance**:
- [ ] `lastSeq` field removed from types
- [ ] Client no longer sends lastSeq
- [ ] Reconnect behavior documented
- [ ] Tests pass (no changes needed, field was unused)

**Dependencies**: None

---

#### Task C-3.1: Handle auth field (remove or implement)
**Owner**: Same dev as A-1 (auth implementation)  
**Effort**: S (1 hour if removing, M if implementing — see A-1)  
**Files**:
- `packages/protocol/src/types.ts`

**What to do**:
- **Option A** (if A-1 NOT implemented): Delete `auth?: string` from HelloMessage
- **Option B** (if A-1 IS implemented): Keep field, update comment to reflect v1 usage

**Acceptance**:
- [ ] Auth field status matches implementation reality
- [ ] No false security implications from "ignored" comment

**Dependencies**: Decide based on A-1 implementation

---

#### Task C-4.1: Strengthen protocol type guards
**Owner**: Any dev with TS experience  
**Effort**: M (1 day)  
**Files**:
- `packages/protocol/src/types.ts` (all `is*` functions)
- `packages/protocol/test/type-guards.test.ts` (NEW)

**What to do**:
1. For each type guard (`isHelloMessage`, `isClientMessage`, `isServerMessage`, etc.):
   - Check all required fields exist (not just `type`)
   - Check field types match expected (string, number, etc.)
   - Example for HelloMessage:
     ```ts
     export function isHelloMessage(msg: unknown): msg is HelloMessage {
       return (
         typeof msg === "object" &&
         msg !== null &&
         (msg as any).type === "hello" &&
         typeof (msg as any).clientId === "string" &&
         typeof (msg as any).protocolVersion === "number"
         // check auth if present
       );
     }
     ```
2. Add test file covering:
   - Valid messages of each type
   - Missing required fields
   - Wrong field types
   - Extra fields (should still pass)

**Acceptance**:
- [ ] All type guards check required fields
- [ ] Test coverage >90% for type guards
- [ ] Malformed wire messages rejected at boundary

**Dependencies**: None

---

### PHASE 2: Server Reliability (can run in parallel after C-1)

#### Task A-1.1: Implement token authentication
**Owner**: Senior dev  
**Effort**: M (2 days)  
**Files**:
- `packages/server/src/cli.ts` (add --token flag)
- `packages/server/src/ws-server.ts` (validate token in handleConnection)
- `packages/server/src/types.ts` (add token to WsServerConfig)
- `packages/tui-client/src/cli.ts` (add --token flag)
- `packages/tui-client/src/connection.ts` (send token in HelloMessage.auth)
- `README.md` (document token usage)

**What to do**:
1. **Server**:
   - Add CLI arg: `--token <string>` (optional, auto-generate if not provided)
   - On startup, generate UUID token if `--token` not provided, print to console: "Server token: abc123..."
   - Store token in `WsServerConfig`
   - In `handleConnection()`, after receiving HelloMessage, check:
     ```ts
     if (hello.auth !== this.config.token) {
       ws.send(JSON.stringify({
         type: "error",
         code: "UNAUTHORIZED",
         message: "Invalid token"
       }));
       ws.close();
       return;
     }
     ```
2. **Client**:
   - Add CLI arg: `--token <string>` (required)
   - Pass token in `HelloMessage.auth`
   - If connection rejected with UNAUTHORIZED, show clear error: "Authentication failed. Check token."
3. **Docs**:
   - README section: "Authentication"
   - Explain: server generates token on start, client must provide via `--token`
   - Example: `pi-server --token mysecret` / `pi-client --token mysecret`

**Acceptance**:
- [ ] Server generates/accepts token
- [ ] Client sends token in auth field
- [ ] Server rejects mismatched tokens with UNAUTHORIZED
- [ ] Clear error shown to user on auth failure
- [ ] README documents token workflow
- [ ] Tests added for auth success/failure paths

**Dependencies**: C-1 (architecture decision), C-3 (auth field)

---

#### Task A-2.1: Bind to localhost by default
**Owner**: Same as A-1  
**Effort**: S (1 hour)  
**Files**:
- `packages/server/src/cli.ts` (change default --host)
- `README.md` (document security implications)

**What to do**:
1. Change default `--host` from `0.0.0.0` to `127.0.0.1`
2. Add README warning:
   ```md
   ## Security
   By default, pi-server binds to 127.0.0.1 (localhost only). To allow network
   connections, use `--host 0.0.0.0` (requires --token for security).
   ```

**Acceptance**:
- [ ] Default bind is 127.0.0.1
- [ ] `--host 0.0.0.0` works for network exposure
- [ ] Security warning in README

**Dependencies**: None

---

#### Task A-3.1: Send error to client on pi process death
**Owner**: Mid-level dev  
**Effort**: M (1 day)  
**Files**:
- `packages/server/src/pi-process.ts` (emit exit event)
- `packages/server/src/ws-server.ts` (listen for exit, notify client)
- `packages/server/src/cli.ts` (connect exit handler)

**What to do**:
1. **PiProcess**:
   - Add exit callback to constructor: `onExit?: (code: number | null) => void`
   - In process exit handler, call `this.onExit?.(code)`
2. **WsServer**:
   - Accept `piProcess.onExit` callback in constructor or `start()`
   - On exit callback, send to client:
     ```ts
     if (this.client) {
       this.client.send(JSON.stringify({
         type: "error",
         code: "PI_PROCESS_ERROR",
         message: `Pi process exited with code ${code}`
       }));
       this.client.close();
     }
     ```
3. **Client** (bonus):
   - Render "Pi process crashed" error instead of infinite "Connecting..."

**Acceptance**:
- [ ] Server detects pi exit
- [ ] Client receives PI_PROCESS_ERROR message
- [ ] Client shows clear error (not hang)
- [ ] Test: kill pi process during session, verify client error

**Dependencies**: None

---

#### Task A-4.1: Wrap pi relay sends in try/catch
**Owner**: Any dev  
**Effort**: S (2 hours)  
**Files**:
- `packages/server/src/ws-server.ts` (all `piProcess.send()` calls)

**What to do**:
1. Find all calls to `this.piProcess.send(...)` in ws-server.ts (2 locations)
2. Wrap in try/catch:
   ```ts
   try {
     this.piProcess.send(message.payload);
   } catch (err) {
     this.logger.error("Failed to send to pi:", err);
     if (this.client) {
       this.client.send(JSON.stringify({
         type: "error",
         code: "PI_PROCESS_ERROR",
         message: "Pi process is not responsive"
       }));
     }
   }
   ```
3. For UIBridge promise chain, add `.catch()`:
   ```ts
   this.uiBridge.registerRequest(...).then((response) => {
     try {
       this.piProcess.send(response);
     } catch (err) {
       this.logger.error("Failed to send UI response:", err);
     }
   });
   ```

**Acceptance**:
- [ ] All `piProcess.send()` calls wrapped
- [ ] Server doesn't crash when pi stdin closes
- [ ] Client receives error message on failure
- [ ] Test: close pi stdin, verify graceful error

**Dependencies**: None

---

#### Task A-5.1: Handle WebSocketServer startup errors
**Owner**: Any dev  
**Effort**: S (1 hour)  
**Files**:
- `packages/server/src/ws-server.ts` (start method)

**What to do**:
1. Add error listener in `start()`:
   ```ts
   return new Promise((resolve, reject) => {
     this.wss = new WebSocketServer({ port: this.port, host: this.host });
     
     const onError = (err: Error) => {
       this.wss?.close();
       reject(err);
     };
     
     this.wss.once("error", onError);
     this.wss.once("listening", () => {
       this.wss!.removeListener("error", onError);
       resolve();
     });
     
     this.wss.on("connection", ...);
   });
   ```

**Acceptance**:
- [ ] EADDRINUSE rejected with clear error
- [ ] Permission errors don't hang
- [ ] Test: start two servers on same port, second fails gracefully

**Dependencies**: None

---

#### Task A-6.1: Fix single-client handshake race
**Owner**: Mid-level dev  
**Effort**: M (1 day)  
**Files**:
- `packages/server/src/ws-server.ts` (handleConnection, handleClientMessage)

**What to do**:
1. **Option A** (simpler): Reserve slot immediately on TCP connect:
   ```ts
   private handleConnection(ws: WebSocket): void {
     if (this.client) {
       this.logger.warn("Client slot occupied, rejecting new connection");
       ws.close();
       return;
     }
     
     this.client = ws; // reserve immediately
     // existing handshake logic...
   }
   ```
2. **Option B** (cleaner): Track pending handshakes:
   ```ts
   private pendingHandshakes = new Set<WebSocket>();
   
   private handleConnection(ws: WebSocket): void {
     if (this.client || this.pendingHandshakes.size > 0) {
       ws.close();
       return;
     }
     this.pendingHandshakes.add(ws);
     // on successful hello:
     this.pendingHandshakes.delete(ws);
     this.client = ws;
   }
   ```
3. Add validation in message handlers:
   ```ts
   if (this.client !== ws) {
     this.logger.warn("Message from non-active client, ignoring");
     return;
   }
   ```

**Acceptance**:
- [ ] Two simultaneous connects → first wins, second rejected
- [ ] No message routing to wrong client
- [ ] Test: connect two clients in rapid succession, verify second fails

**Dependencies**: None

---

### PHASE 3: Client Reliability (can run in parallel with Phase 2)

#### Task B-1.1: Fix client reconnect race
**Owner**: Any dev  
**Effort**: M (1 day)  
**Files**:
- `packages/tui-client/src/connection.ts`

**What to do**:
1. Capture socket instance in local variable:
   ```ts
   connect(): void {
     const ws = new WebSocket(this.url);
     this.ws = ws;
     
     ws.on("open", () => {
       if (this.ws !== ws) return; // guard
       // existing open logic...
     });
     
     ws.on("close", () => {
       if (this.ws !== ws) return; // guard
       this.ws = null;
       this.scheduleReconnect();
     });
     
     // same for message, error handlers
   }
   ```

**Acceptance**:
- [ ] Stale socket events don't affect new connections
- [ ] No spurious reconnects from old sockets
- [ ] Test: disconnect during reconnect, verify no double-reconnect

**Dependencies**: None

---

#### Task B-2.1: Guard extension dialog empty options
**Owner**: Any dev  
**Effort**: S (1 hour)  
**Files**:
- `packages/tui-client/src/app.tsx` (renderExtensionDialog)

**What to do**:
1. Check options length before rendering:
   ```tsx
   if (request.method === "select") {
     if (!options || options.length === 0) {
       return (
         <Box>
           <Text color="red">Error: No options provided</Text>
         </Box>
       );
     }
     // existing select rendering...
   }
   ```
2. Clamp selectedIndex: `const safeIndex = Math.min(selectedIndex, options.length - 1)`

**Acceptance**:
- [ ] Empty options don't crash
- [ ] Error shown to user if no options
- [ ] Test: send extension_ui_request with `options: []`

**Dependencies**: None

---

#### Task B-3.1: Fix extension dialog state leak
**Owner**: Any dev  
**Effort**: S (2 hours)  
**Files**:
- `packages/tui-client/src/app.tsx`

**What to do**:
1. Add useEffect to reset state on request change:
   ```tsx
   useEffect(() => {
     setInputValue("");
     setSelectedIndex(0);
   }, [extensionRequest?.id]);
   ```

**Acceptance**:
- [ ] New dialog requests start with clean state
- [ ] Test: send two dialogs in sequence, verify second doesn't show first's input

**Dependencies**: None

---

### PHASE 4: Test Coverage (can start immediately)

#### Task D-1.1: Protocol type guard tests
**Owner**: Any dev  
**Effort**: M (1 day)  
**Files**:
- `packages/protocol/test/type-guards.test.ts` (NEW)

**What to do**:
1. Create test file covering all type guards from types.ts
2. For each guard, test:
   - Valid message (should pass)
   - Missing required field (should fail)
   - Wrong type for field (should fail)
   - Extra fields (should pass)
3. Example structure:
   ```ts
   describe("isHelloMessage", () => {
     it("accepts valid HelloMessage", () => {
       const msg = { type: "hello", clientId: "123", protocolVersion: 1 };
       expect(isHelloMessage(msg)).toBe(true);
     });
     
     it("rejects missing clientId", () => {
       const msg = { type: "hello", protocolVersion: 1 };
       expect(isHelloMessage(msg)).toBe(false);
     });
     
     // etc.
   });
   ```

**Acceptance**:
- [ ] All type guards have test coverage
- [ ] Coverage >90% for packages/protocol/src/types.ts
- [ ] Tests pass

**Dependencies**: C-4 (guards must be strengthened first)

---

#### Task D-2.1: PiProcess lifecycle tests
**Owner**: Mid-level dev  
**Effort**: M (1 day)  
**Files**:
- `packages/server/test/pi-process.test.ts` (NEW)

**What to do**:
1. Test startup success (mock spawn)
2. Test startup failure (bad path, spawn error)
3. Test stop() behavior
4. Test exit handling (normal exit, crash)
5. Test send() when process not running (should throw)

**Acceptance**:
- [ ] Coverage >80% for packages/server/src/pi-process.ts
- [ ] All lifecycle transitions tested
- [ ] Tests pass

**Dependencies**: None (can use mocks)

---

#### Task D-3.1: Connection reconnect tests
**Owner**: Any dev  
**Effort**: M (1 day)  
**Files**:
- `packages/tui-client/test/connection.test.ts` (NEW)

**What to do**:
1. Mock WebSocket
2. Test successful connect
3. Test reconnect on close
4. Test message ordering during reconnect
5. Test disconnect() stops reconnect

**Acceptance**:
- [ ] Coverage >80% for packages/tui-client/src/connection.ts
- [ ] Reconnect logic verified
- [ ] Tests pass

**Dependencies**: B-1 (reconnect race fix)

---

## Estimated Timeline

**With 2 developers working in parallel:**

| Week | Stream C | Stream A + B | Stream D |
|------|----------|-------------|----------|
| **Week 1** | Protocol arch decision (C-1) + cleanup (C-2, C-3, C-4) | — | Start protocol tests (D-1) |
| **Week 2** | Polish (C-5, C-6, C-7) | Auth + bind (A-1, A-2) + Client fixes (B-1, B-2, B-3) | Server tests (D-2) |
| **Week 3** | — | Process handling (A-3, A-4) + Handshake (A-5, A-6) | Client tests (D-3) + metadata (D-1, D-2) |
| **Week 4** | — | Polish (A-7, A-8, A-9, B-4, B-5, B-6) | Final test coverage + docs |

**Total: 4 weeks to 1.0-ready state**

**Critical path**: C-1 (architecture decision) must complete Week 1 for A+B to proceed.

---

## Concrete Next Actions

### Immediate (this week)

1. **[ ] Stakeholder meeting** — answer Q1-Q6 (deployment model, read-only clients, compatibility, commands package, WelcomeMessage size, multi-server)
2. **[ ] C-1: Make architecture decision** (client vs server routing)
3. **[ ] Create `experiments/1.0-review/decisions.md`** documenting answers and decision
4. **[ ] C-2: Remove lastSeq field** (quick win, unblocks protocol)
5. **[ ] C-4: Strengthen type guards** (highest protocol risk)

### Week 1 targets

- [ ] All protocol cleanup (C-2, C-3, C-4) complete
- [ ] Protocol tests (D-1) in progress
- [ ] A-1 (auth) in progress

### Week 2 targets

- [ ] Auth + bind (A-1, A-2) complete
- [ ] All MUST-level client fixes (B-1, B-2) complete
- [ ] PiProcess tests (D-2) complete

### Week 3 targets

- [ ] All MUST-level server fixes (A-3, A-4, A-5, A-6) complete
- [ ] Connection tests (D-3) complete
- [ ] Package metadata (D-1, D-2) fixed

### Week 4 targets

- [ ] All SHOULD-level improvements complete
- [ ] Test coverage >80% on critical modules
- [ ] Documentation updated
- [ ] Ready for 1.0 release

---

## Risk Mitigation

### If timeline slips

**Drop order** (COULD → SHOULD → MUST):
1. Drop Stream A/B COULD items (A-12, B-7, B-8)
2. Drop Stream C/D SHOULD items (C-5, C-6, C-7, extra tests)
3. Drop Stream A SHOULD items (A-9, A-10, A-11)
4. **Never drop MUST items** — these are release blockers

### If resources change

**Single developer** — extend timeline to 6 weeks:
- Week 1-2: Stream C (protocol)
- Week 3-4: Stream A (server)
- Week 5: Stream B (client)
- Week 6: Stream D (tests) + polish

**Three developers** — compress to 3 weeks:
- Dev 1: Stream C → Stream A
- Dev 2: Stream B → Stream D
- Dev 3: Stream D (full-time testing)

---

## Success Metrics

### Definition of Done for 1.0

- [ ] All MUST items complete (18 tasks)
- [ ] All Open Questions answered in writing
- [ ] Protocol version locked (no more breaking changes)
- [ ] Auth implemented and documented
- [ ] Test coverage >80% on server, protocol, connection modules
- [ ] No known crash bugs (races, unhandled exceptions)
- [ ] README documents deployment, security, token usage
- [ ] CI passes (build + test + lint)
- [ ] Package metadata consistent
- [ ] Manual smoke test: run server + client for 1 hour, reconnect 10 times, no crashes

### Post-1.0 Roadmap (deferred)

Items explicitly deferred to v1.1 or v2.0:
- Server-side command routing (if client-side chosen for v1)
- Multi-server support (if Q6 answered "no")
- Read-only clients (if Q2 answered "no")
- Delta replay with lastSeq (Arch #2 — removed for v1)
- WelcomeMessage streaming/pagination (if Q5 answered "not urgent")
- TLS native support (proxy-only for v1)
- Multi-client concurrent connections
