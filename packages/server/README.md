# @marcfargas/pi-server

Headless pi agent server — detachable sessions over WebSocket.

Runs `pi --mode rpc` as a managed child process and exposes it over WebSocket so terminal clients can connect, disconnect, and reconnect without interrupting the agent session.

## Install

```bash
npm install -g @marcfargas/pi-server
```

## Usage

```bash
pi-server --port 3000 --cwd /path/to/project
```

See the [root README](../../README.md) for full documentation.

## License

MIT
