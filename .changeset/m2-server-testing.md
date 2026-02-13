---
"@marcfargas/pi-server": minor
---

IPiTransport interface and relay test infrastructure.

- **IPiTransport interface**: extracted from PiProcess — WsServer now accepts any transport implementation, enabling testing without a real pi process.
- **Tool execution relay**: full event lifecycle (start → update → end) properly forwarded over WebSocket.
- **Thinking relay**: thinking_delta events forwarded to clients.
