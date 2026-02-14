# pi-server — Project Instructions

> Detachable agent sessions: wraps pi's RPC mode over WebSocket.

## Language

English — all code, docs, and commits.

## Architecture

- **Monorepo** with npm workspaces (`packages/*`)
- **protocol** — shared wire protocol types
- **server** — headless daemon wrapping `pi --mode rpc`
- **tui-client** — terminal UI client (Ink/React)

## Key Principles

1. **Zero changes to pi** — we wrap the CLI, never monkey-patch
2. **Protocol is the contract** — all packages import from `@pi-server/protocol`
3. **Version the protocol** — bump `PROTOCOL_VERSION` on breaking changes
4. **Relay, don't interpret** — server passes pi's JSON messages through unchanged
5. **Extension UI bridging** — fire-and-forget → broadcast; dialogs → route to rw client with timeout
6. **Assume nothing about pi — discover dynamically where possible**
   - Use `get_commands` to discover extension/skill/template commands at runtime
   - The server is a pure relay — it does NOT interpret, route, or transform commands
   - Builtin command knowledge (the mapping from `/model` → `cycle_model` RPC) lives in `packages/commands`, a shared client library — NOT in the server
   - Each client imports this library and decides how to use it (completion UI, routing, etc.)
   - Forward unknown events gracefully, don't crash on new ones
   - Long-term: contribute upstream to pi so `get_commands` returns builtins too

## Conventions

- TypeScript, strict mode, ESM
- npm workspaces for package management
- Tests with vitest
- Conventional commits

## Testing — Non-Negotiable

**E2E testing is the baseline, not an afterthought.**

Every feature must be validated end-to-end before committing:
1. Write the code
2. Write unit tests for pure logic (reducer, router, parsing)
3. Write relay integration tests using MockPiTransport (no LLM, fast, CI-safe)
4. **Run a real E2E probe** against a live server — verify the actual wire protocol behavior
5. Only then commit

Use the `manual-test` skill for probe patterns. The relay tests in `packages/server/test/relay.test.ts` are the model: they test the full path (client → WebSocket → server → MockPiTransport → response → client assertions).

Do NOT:
- Commit code validated only by `tsc` and unit tests
- Assume protocol behavior from docs without verifying
- Skip E2E when "the unit tests pass"

## Skills

### `manual-test`
Load with `/skill:manual-test` or read `.pi/skills/manual-test/SKILL.md` before any manual testing.
Covers: launching server+client via holdpty, raw WebSocket probes, event inspection, reconnect testing, reading Ink TUI output from detached terminals. **Load this skill whenever testing the TUI or debugging the WebSocket relay.**
