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

## Conventions

- TypeScript, strict mode, ESM
- npm workspaces for package management
- Tests with vitest
- Conventional commits

## Skills

### `manual-test`
Load with `/skill:manual-test` or read `.pi/skills/manual-test/SKILL.md` before any manual testing.
Covers: launching server+client via holdpty, raw WebSocket probes, event inspection, reconnect testing, reading Ink TUI output from detached terminals. **Load this skill whenever testing the TUI or debugging the WebSocket relay.**
