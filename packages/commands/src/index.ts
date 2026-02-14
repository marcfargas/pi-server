// Types
export type {
  ArgSchema,
  ArgNone,
  ArgFreeText,
  ArgEnum,
  ArgModelSelector,
  ArgPicker,
  UnifiedCommand,
  RpcPayload,
} from "./types.js";

// Catalog
export { BUILTIN_COMMANDS, getBuiltin, getBuiltinCommands } from "./catalog.js";
export type { BuiltinDef } from "./catalog.js";

// Router
export { routeInput } from "./router.js";
export type { RouteResult } from "./router.js";

// Discovery
export { mergeCommands, extractCommandNames } from "./discovery.js";
export type { PiCommand } from "./discovery.js";
