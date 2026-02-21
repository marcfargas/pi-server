## Summary Verdict
**NEEDS_WORK.** The architecture is sound and much better than an alpha relay, but there are still **v1-embarrassing blockers** in security and client reliability. I would not lock protocol/API as "v1 stable" until those are fixed, tested, and documented.

## Strengths
- **Clear package boundaries** are mostly right:  
  - Protocol contract in `packages/protocol/src/*`  
  - Routing logic in `packages/commands/src/*`  
  - Relay in `packages/server/src/ws-server.ts`  
  - UI state separation in `packages/tui-client/src/state.ts`
- **Server relay tests are substantial** (`packages/server/test/relay.test.ts`, `error-paths.test.ts`) and cover real handshake/error flows, not just pure units.
- **Hardening work is visible**: startup error handling, single-client slot reservation, auth checks, pending-command timeouts, graceful stop paths.
- **Protocol has explicit versioning** (`packages/protocol/src/version.ts`) and additive intent documented.

## Critical Issues
1. **Localhost mode is vulnerable to browser-based WebSocket hijacking (CSWSH)**
   - **What's wrong:** In `packages/server/src/ws-server.ts`, localhost/no-token mode accepts any WebSocket client. Browsers can connect to `ws://127.0.0.1:3333` from malicious pages unless you enforce origin/token policy.
   - **Why it matters:** This is a real remote-to-local attack path; "localhost only" is not equivalent to "trusted client only."
   - **What to do instead:**  
     - Minimum: reject browser `Origin` headers by default (or allowlist explicitly).  
     - Better: require auth token always (including localhost), optionally auto-generate and print.

2. **Extension `input` / `editor` dialogs can trap the TUI in a blocked state**
   - **What's wrong:** In `packages/tui-client/src/app.tsx`, `ExtensionUIDialog` for `input/editor` has submit but no escape/cancel handler. `canInput` is disabled while `extensionUI` is active, so users can get stuck.
   - **Why it matters:** A stuck UI during extension flow is a release-quality failure.
   - **What to do instead:** Add explicit cancel handling (`Esc` => `{ cancelled: true }` + dismiss), and add a local fail-safe timeout to dismiss stale dialogs.

3. **Post-handshake client messages are not validated**
   - **What's wrong:** `ws-server.ts` casts parsed JSON to `ClientMessage` without `isClientMessage` validation.
   - **Why it matters:** Malformed payloads can be forwarded to pi (`null`, wrong shapes), causing undefined relay behavior and avoidable crash/error paths.
   - **What to do instead:** Validate every post-handshake message; reject/close on invalid protocol frames.

4. **Handshake race window can interfere with welcome sync**
   - **What's wrong:** In `ws-server.ts`, `handshakeComplete` is set **before** `buildWelcomeMessage()` finishes. Client can send commands during this window.
   - **Why it matters:** Can contaminate startup state sync and internal pending command handling.
   - **What to do instead:** Treat handshake as complete only after welcome is sent; ignore/queue client messages before that.

5. **Protocol/API semantics are not final-consistent yet**
   - **What's wrong:** `WelcomeMessage.serverId` comment in `packages/protocol/src/types.ts` says "persists across restarts," but implementation in `packages/server/src/ws-server.ts` is process-lifetime UUID.  
   - **Why it matters:** You're about to lock v1 compatibility; semantic ambiguity now becomes long-term debt.
   - **What to do instead:** Align type docs + README + behavior now (either truly persistent, or explicitly ephemeral).

## Suggestions
- Add tests for currently untested high-risk areas:
  - `packages/tui-client/src/connection.ts` reconnect/fatal-error behavior
  - `packages/tui-client/src/editor.tsx` multiline paste/cursor edge cases
  - CLI argument parsing/security behavior (`packages/server/src/cli.ts`, `packages/tui-client/src/cli.ts`)
  - Keepalive timeout behavior in server
- `packages/tui-client/src/state.ts`: `LOAD_HISTORY` should likely reset streaming/busy state on reconnect to avoid stale UI artifacts.
- `packages/tui-client/src/app.tsx`: documented support for extension UI methods is stronger than actual behavior (`set_editor_text` ignored).
- README is mostly solid, but security section should explicitly describe localhost threat model and recommended token usage even locally.

## Questions for the Author
1. Are browser/Web clients in scope for v1, or should browser origins be rejected outright?
2. Do you want tokenless localhost to remain supported, given CSWSH risk?
3. Is `serverId` intended to be process-ephemeral or stable across restarts? (Need one canonical answer before protocol freeze.)
4. For extension `editor` flows: is multi-line editing/cancel semantics required for parity with pi TUI?
5. Do you consider protocol-level strict validation of client frames mandatory for v1, or acceptable in v1.1?
