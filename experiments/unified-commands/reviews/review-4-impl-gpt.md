# Implementation Review — GPT-5.3-codex

## Summary Verdict
This is buildable as described, but the design underestimates integration complexity in `C:/dev/pi-server/packages/server/src/ws-server.ts`, which is currently a thin relay with only three client message types (`command`, `extension_ui_response`, `ping`). The hardest part is not routing `/model` vs `/todos`; it's defining a clean additive wire contract and reliably correlating async responses/events without desyncing client state.

## Hard Problems
1. **Protocol evolution without breaking v1 clients**  
   - **What's hard:** Current protocol is relay-oriented. There's no native `slash_command`, `get_all_commands`, or `command_result` message type.  
   - **Why:** If you overload existing `command.payload`, you blur server-only vs pi RPC semantics.  
   - **Approach:** Add new top-level client/server message types (additive), and advertise support via capabilities in `welcome` (or version bump if preferred).

2. **Response correlation under concurrency**  
   - **What's hard:** `WsServer` already uses `pendingPiCommands` for internal requests (`get_state`, `get_messages`). Slash commands will add more pending flows while client commands still stream.  
   - **Why:** Mixed internal/client IDs can cause swallowed/misrouted responses.  
   - **Approach:** Use server-reserved ID namespace, separate pending maps per flow, and always include a client-facing request ID in `command_result`.

3. **Reliable `stateChanges` computation**  
   - **What's hard:** Builtin RPC responses are heterogeneous; some won't provide enough data to emit precise diffs.  
   - **Why:** Incorrect diffs will desync UI faster than no diffs.  
   - **Approach:** For mutating builtins, do post-command `get_state` and compute diff against cached state; for non-mutating commands, return `stateChanges: null`.

4. **Extension command normalization semantics**  
   - **What's hard:** Extension commands are often "accepted now, complete later via events/UI requests."  
   - **Why:** A single `success: true` can be interpreted as completion by clients.  
   - **Approach:** Distinguish `accepted` vs `completed` in envelope semantics (or document that extension command result is only dispatch acknowledgement).

5. **Argument parsing edge cases**  
   - **What's hard:** `/name`, `/compact`, `/model` args with spaces/aliases/invalid values.  
   - **Why:** UX bugs here will look like server bugs.  
   - **Approach:** Keep args raw where possible; strict per-command validators; return structured validation errors.

## What Will Break First
- **State desync from bad `stateChanges`** (most likely production incident).
- **Catalog drift** when pi adds/changes builtins and mapping becomes stale.
- **ID collision/correlation bugs** causing "missing response" behavior.
- **Async command confusion** (`/compact`-style commands returning success before actual completion).

## Scope Reality Check
No explicit timeline is stated, but realistically:
- **Phase 1** is moderate, not trivial (protocol + router + tests): ~4–6 engineering days.
- **Phase 2**: ~2–3 days.
- **Phase 3**: ~3–5 days due to state diff correctness and async behavior.

For MVP, cut/limit:
- Generic `picker` complexity (`/fork`) and broad completion framework.
- Full diff sophistication—start with a small set of mutating builtins using post-`get_state`.

## Implementation Sequence
1. **Define wire contract first** (new message types + compatibility strategy).  
2. **Extract builtin catalog module** (data + dispatch + validators).  
3. **Implement server router in `ws-server.ts`** for new unified command messages.  
4. **Add `get_all_commands`** (merge builtins + `get_commands`).  
5. **Add command execution path** (builtin typed RPC vs extension `prompt`).  
6. **Add normalized response envelope** (`command_result` + request correlation).  
7. **Add `stateChanges` (post-`get_state` diff for mutating builtins)**.  
8. **Testing pass** (unit + integration with mocked and real pi transport).

## Missing from the Design
- Exact wire schemas for new request/response messages.
- Correlation model (`requestId`) and message ordering guarantees.
- Whether normalized responses are top-level messages or wrapped in existing `event`.
- Precise `stateChanges` contract (field names, partial vs full, nullability).
- Error mapping rules (validation errors vs pi RPC errors vs timeout).
- Timeout/retry behavior for `get_all_commands` and slash execution.
- Compatibility mechanism (capabilities vs protocol version increment).
- Operational rule for keeping builtin catalog in sync with upstream pi.
