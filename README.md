# pi-server

Detachable agent sessions over a wire protocol.

Wraps [pi](https://github.com/nicepkg/pi) `--mode rpc` as a headless daemon, serves the
JSON-line protocol over WebSocket. Terminal TUI client connects and renders the full
interactive experience — remotely, detachably, reconnectably.

## Packages

| Package | Description |
|---------|-------------|
| `@pi-server/protocol` | Wire protocol types and versioning |
| `@pi-server/server` | Headless server (wraps pi child process, WebSocket) |
| `@pi-server/tui-client` | Terminal TUI client (Ink) |

## Quick Start

```bash
# Start server
npx @pi-server/server serve --port 3333 --cwd /path/to/project

# Connect from terminal
npx @pi-server/tui-client connect ws://localhost:3333
```

## Architecture

```
┌──────────────┐        ┌──────────────┐        ┌─────────────┐
│  TUI Client  │◄══WS══►│  pi-server   │◄═stdio═►│  pi --mode  │
│  (Ink)       │        │  (relay)     │        │  rpc        │
└──────────────┘        └──────────────┘        └─────────────┘
```

The server relays JSON messages between WebSocket clients and pi's RPC protocol.
Extension UI requests (select, confirm, input) are routed to the connected client.
On reconnect, the server provides a full state snapshot.

## Protocol Version

Current: **v1** (see `packages/protocol/`)

## Status

🚧 Under development — Milestone 1 (connect and chat)

## License

MIT
