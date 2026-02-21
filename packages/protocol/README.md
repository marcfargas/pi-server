# @marcfargas/pi-server-protocol

Wire protocol types for pi-server — detachable agent sessions over WebSocket.

Defines the messages exchanged between `pi-server` and its clients. Includes TypeScript types, type guards, error factories, and the protocol version constant.

## Install

```bash
npm install @marcfargas/pi-server-protocol
```

## Usage

```ts
import {
  PROTOCOL_VERSION,
  isHelloMessage,
  isClientMessage,
  createError,
  createIncompatibleProtocolError,
} from "@marcfargas/pi-server-protocol";
```

## License

MIT
