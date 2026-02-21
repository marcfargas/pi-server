# Briefing: Test Coverage for v1.0

## Your working root
`C:/dev/pi-server-wt-tests/` — a git worktree. All edits go here. Commit when done.

## Context
Read these files first:
- `experiments/1.0-review/synthesis.md` — full review with test gaps section
- `packages/protocol/src/types.ts` — type guards to test
- `packages/protocol/src/errors.ts` — error factory functions
- `packages/protocol/src/version.ts` — version constant
- `packages/server/src/ui-bridge.ts` — extension UI bridge (untested)
- `packages/server/src/pi-process.ts` — pi process manager (untested)
- `packages/server/test/relay.test.ts` — existing relay tests (reference for style)
- `packages/tui-client/test/state.test.ts` — existing state tests (reference for style)

All tests use vitest. Follow the existing test style and patterns.

## Tasks (in priority order)

### 1. Protocol type guard tests (D-1, C-4)
File: `packages/protocol/test/type-guards.test.ts` (NEW)

Test `isHelloMessage` and `isClientMessage` with:
- Valid messages (all required fields present, correct types) → true
- Missing required fields → false
- Wrong field types (e.g., protocolVersion as string) → false
- Extra fields (should still pass) → true
- null, undefined, arrays, primitives → false
- Empty object → false

Also test `createError` and `createIncompatibleProtocolError` from errors.ts.

### 2. Protocol version tests
File: `packages/protocol/test/version.test.ts` (NEW)

- PROTOCOL_VERSION is a positive integer
- PROTOCOL_VERSION is exported

### 3. UIBridge tests
File: `packages/server/test/ui-bridge.test.ts` (NEW)

Test:
- `isExtensionUIRequest()` — true for `{type: "extension_ui_request"}`, false for others
- `isFireAndForget()` — true for notify/setStatus/setWidget/setTitle/set_editor_text, false for select/confirm/input/editor
- `registerRequest()` + `handleResponse()` — response resolves the promise
- `registerRequest()` timeout — resolves with default cancel response after timeout
- `cancelAll()` — resolves all pending with defaults, clears pending map
- `hasPendingRequests()` — true when pending, false after resolve/cancel
- Concurrent requests — multiple pending, each resolved independently
- Default responses per method: select→cancelled, confirm→false, input→cancelled

### 4. Server error path tests
File: `packages/server/test/error-paths.test.ts` (NEW)

Using MockPiTransport (import from relay.test.ts or extract to shared fixture):
- Client sends invalid JSON → gets error response
- Client sends non-hello first message → gets INVALID_HELLO, connection closed
- Client sends wrong protocol version → gets INCOMPATIBLE_PROTOCOL, connection closed
- Two clients connect simultaneously → second gets rejection
- Server stop() → client connection closed cleanly

### 5. State reducer edge case tests
File: `packages/tui-client/test/state.test.ts` (APPEND to existing)

Add tests for:
- `LOAD_HISTORY` with malformed messages (empty array, missing fields) → no crash
- `TOOL_UPDATE` for non-existent tool ID → state unchanged
- `TOOL_END` for non-existent tool ID → state unchanged
- `AGENT_END` with no streaming content → no empty message added
- `EXTENSION_UI_REQUEST` followed by `EXTENSION_UI_DISMISS` → extensionUI null

### 6. Package metadata fixes (D-1, D-2)
- Align all `engines.node` to `">=22"` in root + all package.json files
- Remove `README.md` and `LICENSE` from `files` arrays if those files don't exist in package dirs, OR create a simple README.md in each package dir

## Test Style Reference
Follow existing patterns:
```ts
import { describe, it, expect } from "vitest";
// For async: afterEach cleanup
// For server tests: use MockPiTransport, connectAndHandshake helpers from relay.test.ts
```

## Acceptance Criteria
- All new tests pass
- All existing tests still pass
- No test file is empty or has only skipped tests
- `npm test` runs clean across all workspaces
- Build succeeds

## When done
- `git add -A && git commit -m "test: comprehensive test coverage for v1.0 — protocol, UIBridge, error paths"`
- Leave the worktree — orchestrator will merge
