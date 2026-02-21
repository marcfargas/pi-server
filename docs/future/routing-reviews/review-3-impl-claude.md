# Implementation Review — Claude Sonnet 4.5

## Summary Verdict

This is buildable as described, but it's riskier than it appears. The vision correctly identifies the problem (split command personalities) and proposes a clean architectural solution (server-side normalization layer). The design is sound for Phase 1 (routing), but Phase 2-3 introduce hidden complexity around state synchronization that could become a maintenance burden. The core risk is **catalog drift** — you're codifying knowledge about pi's builtin commands that lives upstream in `rpc-mode.js`, and when pi changes, your server breaks silently. The 3-phase plan is realistic for a single developer over 2-3 weeks, but Phase 3 (state change extraction) is underspecified and will take longer than expected.

## Hard Problems

### 1. **Builtin command catalog maintenance**
**Why it's hard**: You're extracting 28 builtin commands from pi's `rpc-mode.js` and codifying them as data structures in your server. When pi adds/removes/changes commands, your catalog becomes stale. There's no automated way to detect drift — you'll only notice when users report bugs.

**How to approach it**: 
- Build a test that compares your catalog against pi's actual RPC command set (parse `rpc-mode.js` or introspect pi's available commands)
- Add a "known unknowns" fallback: commands not in your catalog get proxied as raw prompts with a warning
- Document which pi version you're compatible with
- Run the drift test in CI whenever pi is updated

### 2. **State change extraction from heterogeneous RPC responses**
**Why it's hard**: Each builtin RPC command returns a different response shape. `set_model` returns `{success: true, model: {...}}`, `compact` returns `{success: true}`, `cycle_model` returns `{success: true, model: {...}}`. You need to write custom extractors for each command to populate `stateChanges`. This is tedious, error-prone, and creates coupling between your server and pi's response formats.

**How to approach it**:
- Start with a whitelist of commands that support state change extraction (model, thinking, name)
- For commands without extractors, return `stateChanges: null` and let clients poll `get_state` if needed
- Consider just computing diffs by calling `get_state` before and after (adds latency but is generic)
- Accept that some state changes will be missed — document which commands update state in-place

### 3. **Argument parsing for `/model` and `/thinking` cycling**
**Why it's hard**: The dispatch logic for `no args = cycle, arg provided = set to arg` requires parsing the user's input string. What if they type `/model  ` (trailing space)? What if they type `/model google/` (incomplete model ID)? What about `/model gemini` when multiple models match?

**How to approach it**:
- Define explicit parsing rules: trim whitespace, treat empty string as no-arg
- For ambiguous inputs (partial model names), return an error with suggestions (requires fuzzy matching against the model list)
- Consider making the cycle behavior explicit: `/model next` instead of `/model` with no args
- Add integration tests for each edge case

### 4. **Completion data staleness**
**Why it's hard**: The model list from `get_available_models` can change at runtime (provider goes offline, new models deployed). If you cache this for completion, users see stale data. If you fetch fresh every time, you add latency to the completion experience.

**How to approach it**:
- Cache with a short TTL (30 seconds) and background refresh
- Include a timestamp in the completion response so clients can display staleness
- For the TUI, fetch on-demand when the user opens the model picker (acceptable latency for infrequent operation)
- Accept that offline providers will show in completion until cache expires

## What Will Break First

### 1. **pi adds a new builtin command**
When pi ships version X+1 with a new `/export` command, your server doesn't know about it. User types `/export`, your server sends it as a prompt to the LLM instead of routing to the RPC command. Silent failure — the command "works" but does the wrong thing.

**Fix**: Add a test that fails when pi has commands you don't know about. Run it before each pi update.

### 2. **Client disconnects during extension UI dialog**
A client requests `/todos`, pi sends an `extension_ui_request` (picker), your `UIBridge` registers it. Client disconnects. `UIBridge` times out and sends a default response to pi. But what if pi's extension doesn't handle cancellation gracefully? You might end up with a half-completed operation.

**Fix**: Already handled by `UIBridge.cancelAll()` on disconnect. Good. But test it with each extension that uses dialogs.

### 3. **Response envelope assumptions**
You're wrapping all responses in `{ type: "command_result", success: true, data: {...}, stateChanges: {...} }`. But what if a builtin command fails? What does `set_model` return when the model doesn't exist? You need to handle `{success: false, error: "..."}` and map that to your envelope.

**Fix**: Test failure cases for each builtin. Ensure error responses are wrapped consistently.

### 4. **Concurrent command execution**
User sends `/compact`, server forwards to pi, pi starts a compaction run. Before it completes, user sends `/abort`. Does your routing handle this? What if they send another `/compact` while one is running?

**Fix**: Pi's RPC layer should handle this, but verify. Your server shouldn't need to track command lifecycle — just relay. But document the behavior.

## Scope Reality Check

**Phase 1 (Command discovery + routing)** — 1 week for a solo dev. This is the core value. Achievable.

**Phase 2 (Completion data)** — 3-4 days. The `get_completions` endpoint is straightforward, but you'll spend time on caching strategy and handling missing data.

**Phase 3 (Response normalization + state changes)** — 1 week minimum, likely more. The vision says "wrap builtin responses with stateChanges" but doesn't specify:
- How to compute state changes for commands that don't return new state (like `/stats`)
- How to handle partial state updates (user changes model, thinking level stays the same — do you include it in `stateChanges`?)
- How to synchronize state when multiple clients will be supported in the future (you said "one client at a time" but the architecture implies multi-client eventually)

**For MVP**: Cut Phase 3. Ship Phase 1 + Phase 2. Let clients continue to call `get_state` when they need fresh state. The win is still huge — unified command discovery and routing. State change notifications are a nice-to-have that can come later once you have usage data.

## Implementation Sequence

If I were building this, here's the order and why:

### Week 1: Core routing (MVP)
1. **Define builtin command catalog as data** (TypeScript interfaces, not scattered code)
   - Start with just 5 commands: `/model`, `/thinking`, `/abort`, `/new`, `/compact`
   - Data structure: `{ name, description, argSchema, dispatch(args) => RpcCommand }`
2. **Implement slash command interceptor** in `handleClientMessage`
   - If `message.type === "command"` and payload starts with `/`, route through catalog
   - Match command name, call `dispatch(args)`, send to pi
3. **Test each builtin routing** with unit tests (input `/model x` → output `{type: "set_model", ...}`)
4. **Implement `get_all_commands` endpoint** 
   - Merge builtin catalog + pi's `get_commands` response
   - Return unified list with arg schemas
5. **Integration test**: TUI sends `/model gemini`, server routes to `set_model`, model changes

### Week 2: Completion + expand catalog
6. **Add remaining builtins** to catalog (full 28 commands from TODO-bc720a3c)
7. **Implement `get_completions` endpoint** (fetch model list, thinking levels, fork messages)
8. **Add caching layer** for model list (30s TTL)
9. **Client-side TUI completion UI** (show picker when typing `/mod` → suggest `/model`)

### Week 3 (optional): State change extraction
10. **Define state change extractors** for commands that return new state
11. **Wrap responses** with `stateChanges` field
12. **Client-side state management** (update UI from `stateChanges` instead of polling)

## Missing from the Design

### 1. **Failure response format from pi**
What does `set_model` return when the model doesn't exist? What does `compact` return when context is already at minimum? You need to examine pi's actual error responses to know how to normalize them.

### 2. **Argument validation**
Who validates that `/thinking xhigh` is a valid level? The client (before sending)? The server (before dispatching)? Pi (rejects invalid commands)? Right now it's unspecified. I'd recommend: client validates for better UX (immediate feedback), but server also validates because clients are untrusted.

### 3. **Command aliases**
Does `/m` work as shorthand for `/model`? If yes, where is aliasing handled? If no, should it be? The TUI today might support this, but your design doesn't mention it.

### 4. **Versioning strategy**
When you add a new field to the arg schema (e.g., `completionSource`), how do old clients handle it? The design says "protocol v1 compatibility — additive only", but you need to document which fields are required vs. optional in the command schema.

### 5. **State diff vs. full state in `stateChanges`**
The example shows `stateChanges: { model: {...}, thinkingLevel: "off" }`. Is this only the fields that changed? Or the full state after the command? If it's a diff, what about fields that didn't change — are they omitted or set to their current value? This matters for client merge logic.

**Recommendation**: Return only changed fields. Clients maintain their own state object and merge. This is lighter on the wire and explicit about causality.

### 6. **Extension command responses**
The design says "Extension commands return success/error envelope" but extension commands today communicate via `extension_ui_request` events, not via the prompt response. What does success mean for an extension? That it started? That it completed? You might need to wait for the agent run to finish to determine success.

### 7. **Command execution ordering**
If a client sends `/model x` followed immediately by `/thinking high`, does the server queue them or send both to pi in parallel? Pi might reject the second if the first is still in-flight. You need to specify the concurrency model.

**Recommendation**: Let pi handle it. Your server is a relay, not a scheduler. If pi rejects concurrent commands, the error bubbles back to the client naturally.

---

## Final Recommendation

**Ship Phase 1 only for MVP.** The value is in unified command discovery and routing. Phase 2 (completions) is nice but clients can implement basic completion themselves using the command list. Phase 3 (state changes) is premature optimization — clients already call `get_state` today, and it's not a bottleneck.

Once Phase 1 is live and you have real usage data, you'll know whether the complexity of state change extraction is worth it. My guess: it's not, because state changes are rare (model switch, thinking level change) and polling `get_state` after those commands is cheap.

Focus on making the routing bulletproof. That's where the real pain is today.
