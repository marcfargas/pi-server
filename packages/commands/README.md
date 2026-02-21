# @marcfargas/pi-server-commands

Command catalog, routing, and completion for pi-server clients — shared library.

Provides command discovery, slash-command routing, and tab-completion support for clients that communicate with `pi-server`. Handles built-in commands (`/model`, `/thinking`, etc.) and dynamically discovered extension commands.

## Install

```bash
npm install @marcfargas/pi-server-commands
```

## Usage

```ts
import { routeInput, extractCommandNames } from "@marcfargas/pi-server-commands";

const route = routeInput("/model", discoveredCommands);
// route.kind === "builtin" → route.rpc is the RPC payload to send
// route.kind === "prompt"  → route.message is the prompt string
```

## License

MIT
