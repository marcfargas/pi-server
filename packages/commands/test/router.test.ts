import { describe, it, expect } from "vitest";
import { routeInput } from "../src/router.js";

const DISCOVERED = new Set(["todos", "plan", "plans", "skill:web-search", "skill:odoo"]);

describe("routeInput", () => {
  // =========================================================================
  // Plain text → text
  // =========================================================================

  it("routes plain text as text", () => {
    const r = routeInput("hello world", DISCOVERED);
    expect(r).toEqual({ kind: "text", message: "hello world" });
  });

  it("routes text starting with non-slash as text", () => {
    const r = routeInput("what is /model?", DISCOVERED);
    expect(r).toEqual({ kind: "text", message: "what is /model?" });
  });

  // =========================================================================
  // Builtin commands → builtin (RPC)
  // =========================================================================

  it("/model → cycle_model", () => {
    const r = routeInput("/model", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "cycle_model" } });
  });

  it("/model provider/id → set_model", () => {
    const r = routeInput("/model google/gemini-2.5-flash", DISCOVERED);
    expect(r).toEqual({
      kind: "builtin",
      rpc: { type: "set_model", provider: "google", modelId: "gemini-2.5-flash" },
    });
  });

  it("/model bare-id → set_model with modelId only", () => {
    const r = routeInput("/model gemini-2.5-flash", DISCOVERED);
    expect(r).toEqual({
      kind: "builtin",
      rpc: { type: "set_model", modelId: "gemini-2.5-flash" },
    });
  });

  it("/thinking → cycle_thinking_level", () => {
    const r = routeInput("/thinking", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "cycle_thinking_level" } });
  });

  it("/thinking high → set_thinking_level", () => {
    const r = routeInput("/thinking high", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "set_thinking_level", level: "high" } });
  });

  it("/compact → compact", () => {
    const r = routeInput("/compact", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "compact" } });
  });

  it("/compact with instructions → compact + customInstructions", () => {
    const r = routeInput("/compact Focus on architecture decisions", DISCOVERED);
    expect(r).toEqual({
      kind: "builtin",
      rpc: { type: "compact", customInstructions: "Focus on architecture decisions" },
    });
  });

  it("/abort → abort", () => {
    const r = routeInput("/abort", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "abort" } });
  });

  it("/new → new_session", () => {
    const r = routeInput("/new", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "new_session" } });
  });

  it("/stats → get_session_stats", () => {
    const r = routeInput("/stats", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "get_session_stats" } });
  });

  it("/name my-session → set_session_name", () => {
    const r = routeInput("/name my-session", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "set_session_name", name: "my-session" } });
  });

  it("/fork without arg → get_fork_messages", () => {
    const r = routeInput("/fork", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "get_fork_messages" } });
  });

  it("/fork with entryId → fork", () => {
    const r = routeInput("/fork abc123", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "fork", entryId: "abc123" } });
  });

  it("/export → export_html", () => {
    const r = routeInput("/export", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "export_html" } });
  });

  it("/export with path → export_html + outputPath", () => {
    const r = routeInput("/export /tmp/session.html", DISCOVERED);
    expect(r).toEqual({ kind: "builtin", rpc: { type: "export_html", outputPath: "/tmp/session.html" } });
  });

  // =========================================================================
  // Extension/skill commands → prompt
  // =========================================================================

  it("/todos → prompt (discovered extension)", () => {
    const r = routeInput("/todos", DISCOVERED);
    expect(r).toEqual({ kind: "prompt", message: "/todos" });
  });

  it("/plan → prompt (discovered extension)", () => {
    const r = routeInput("/plan", DISCOVERED);
    expect(r).toEqual({ kind: "prompt", message: "/plan" });
  });

  it("/skill:web-search → prompt (discovered skill)", () => {
    const r = routeInput("/skill:web-search", DISCOVERED);
    expect(r).toEqual({ kind: "prompt", message: "/skill:web-search" });
  });

  // =========================================================================
  // Unknown slash commands → prompt (let pi decide)
  // =========================================================================

  it("/unknown → prompt (fallback)", () => {
    const r = routeInput("/something-new", DISCOVERED);
    expect(r).toEqual({ kind: "prompt", message: "/something-new" });
  });
});
