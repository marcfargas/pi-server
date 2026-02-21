# Architecture Review — Claude Sonnet 4.5

---

## Summary Verdict

The unified command layer addresses a real problem but creates a **fundamental architectural conflict** with the project's core principles. The design proposes hardcoding a catalog of 28 builtin commands with dispatch logic, directly violating the explicit directive: *"Do NOT hardcode slash commands, RPC command names, or capability lists... Assume nothing about pi — discover dynamically."*

This tension isn't acknowledged in the document. The builtin catalog will drift from pi's implementation, creating exactly the kind of fragile coupling the project principles were written to avoid. The design has merit for the client experience, but it's solving the problem at the wrong layer and building technical debt into the architecture.

**Recommendation**: Narrow the scope drastically or solve this upstream in pi.

---

## Strengths

1. **Identifies the right problem** — The builtin/extension command split genuinely creates client complexity. Every client reimplementing routing logic is wasteful.

2. **The `stateChanges` innovation is solid** — Telling clients what changed rather than forcing them to poll `get_state` is a real improvement. This could be useful even without the full command catalog.

3. **Clear phase breakdown** — The three-phase rollout is reasonable and allows for learning.

4. **Good completion schema thinking** — The argument schema types (enum, model_selector, picker) are well-chosen abstractions for UI needs.

---

## Critical Issues

### 1. **Violates core project principle — MUST FIX**

The vision document proposes building a "builtin command catalog" with codified dispatch logic for all 28 RPC commands. But AGENTS.md explicitly states:

> "Do NOT hardcode slash commands, RPC command names, or capability lists. Use `get_commands` to discover available commands at runtime."

Your TODO (bc720a3c) even acknowledges this: *"the full list is only in `rpc-mode.js` source"* and *"Builtin catalog drift — pi adds a command we don't know about."*

**Why this matters**: When pi adds `/tree` RPC support (which your TODO notes is missing), your server won't know about it until someone manually updates the catalog. You've built a layer that requires coordinated releases with upstream.

**What to do instead**: Either:
- (A) **Minimal routing only** — Server just checks if a slash command is in `get_commands` result. If yes → `prompt`. If no → try parsing as a builtin and dispatch typed RPC. Unknown commands fall through to prompt (pi decides if it's an error). No catalog, no hardcoded list.
- (B) **Fix this upstream** — Contribute to pi to make `get_commands` return ALL commands including builtins. Then your server just relays without interpreting.
- (C) **Hybrid discovery** — Server queries pi's `get_state` capabilities and dynamically detects which RPC commands exist by introspecting pi's responses. Build the catalog at runtime, not compile-time.

### 2. **Over-engineering for a client problem**

The document says *"with multiple clients planned (TUI, web, mobile), this logic would be duplicated everywhere."* But look at what's actually duplicated:

- Mapping `/model` → `cycle_model` or `set_model` based on args — ~10 lines of code per command
- Showing a model picker — UI-specific anyway, can't be shared
- Parsing command args — trivial for builtins (none, flag, or rest-of-line)

You're building an entire command framework with schemas, dispatch functions, state extraction, and versioning to save maybe 500 lines of duplicated logic across all clients. Meanwhile you're creating:
- A catalog of 28+ commands to maintain
- A protocol versioning burden
- A testing surface that mirrors pi's test surface
- Drift risk with every pi release

**What to do**: Solve this where it belongs. If the problem is "clients need to know builtin commands," put that knowledge in a **shared client library** (not the server). The server should be dumb relay. Or better: make pi expose builtins in `get_commands`.

### 3. **The "stateChanges" extraction couples you to pi internals**

Your `extractStateChanges` function needs to parse the response of every builtin command to figure out what state changed. When `set_model` response format changes, your server breaks. You're maintaining a shadow implementation of pi's state machine.

**What to do**: Just broadcast `get_state` after every command. Yes, it's an extra RPC call, but it's 100% reliable and requires zero maintenance. Profile it — if it's actually a bottleneck, optimize then.

---

## Suggestions

### Narrow to what's actually valuable

The document bundles four separate features:
1. Unified command discovery (merge builtins into `get_commands`)
2. Server-side routing (intercept slash commands)
3. Completion metadata (schemas for autocomplete)
4. Response normalization (stateChanges)

**Which of these are actually valuable?**

- **#1 (discovery)** — Only valuable if you're hiding the builtin/extension split. But that split exists for a reason (different execution models). Making it invisible might confuse more than it helps.
  
- **#2 (routing)** — This is where the principle violation happens. Routing logic must live somewhere; putting it in the server just moves the problem, doesn't solve it.

- **#3 (completion metadata)** — Genuinely useful! But this is UI metadata, which is client-specific. TUI wants keybindings and fuzzy search; web wants dropdowns. The server can't dictate this. At most it can provide raw data (model list, thinking levels).

- **#4 (stateChanges)** — Nice-to-have optimization. But fragile. And you can get 90% of the value by just having clients call `get_state` after builtins.

**Recommendation**: Split these into independent features. Ship #3 first (completion data endpoints), defer the rest.

### Make the constraint your design

Your constraint is *"cannot modify pi."* But your design acts like you control pi's protocol. Instead, embrace the relay model:

- Client sends `{ type: "prompt", message: "/model gemini" }` — server relays to pi
- Pi's RPC layer decides if that's valid
- Server relays response back
- Client deals with the result

This is **robust to pi changes** because you're not trying to outsmart pi.

The only value-add the server should provide: **pre-fetching metadata for completion** (model list, thinking levels, command list). That's a pure read operation with no routing logic.

### Consider the mobile client use case

You mention "mobile" as a future client. Mobile clients will want:
- Smaller payload sizes (don't send full model list on every connection)
- Offline command validation (know what commands exist without roundtrip)
- Simplified command entry (buttons, not typing slash commands)

Your design optimizes for the TUI case (autocomplete while typing). For mobile, you'd want a different command entry model entirely (buttons, forms, wizards). Building completion schemas into the protocol might be premature.

---

## Questions for the Author

1. **Why not contribute this to pi upstream?** If `get_commands` returning builtins solves 80% of the problem, why build a workaround layer instead of a PR to pi?

2. **What's the actual pain point today?** Is this a problem clients are hitting now, or speculative complexity for future clients? If the TUI works fine with the current split, is this premature?

3. **How will you keep the catalog in sync?** When pi releases a new builtin (like the missing `/tree`), what's your process? Manual code updates? Automated tests that fail if pi's command set changes? This process needs to be defined before you build the catalog.

4. **What happens to unknown builtins?** If pi adds a command and a client tries to use it before you've updated the catalog, what happens? Does it fail? Fall through to `prompt`? This failure mode isn't specified.

5. **Have you profiled the "just call get_state" alternative?** You're building `stateChanges` extraction to avoid a second RPC call. What's the actual latency? Is this optimization worth the complexity?

6. **What about bash commands?** Your catalog doesn't mention `bash`, `abort_bash`, `steer`, `abort_retry`. Are these handled? Or are they "not worth exposing" because they're agent-internal?

7. **How does this interact with session switching?** `switch_session` changes all state. Do you re-send `stateChanges` for everything? Re-call `get_state`? The document doesn't cover this.

---

**Final take**: This is a well-researched design document that solves a real problem with thoughtful abstractions. But it's the wrong solution for this architecture. You're building a stateful command layer on top of a protocol you don't control, violating a core project principle, to save clients from a small amount of duplicated logic. Either push this upstream or embrace the relay model fully.
