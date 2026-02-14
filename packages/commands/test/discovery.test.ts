import { describe, it, expect } from "vitest";
import { mergeCommands, extractCommandNames } from "../src/discovery.js";

const PI_COMMANDS = [
  { name: "todos", description: "List todos", source: "extension" },
  { name: "plan", description: "Toggle plan mode", source: "extension" },
  { name: "skill:web-search", description: "Web search", source: "skill" },
];

describe("mergeCommands", () => {
  it("returns builtins first, then discovered commands", () => {
    const merged = mergeCommands(PI_COMMANDS);

    // Builtins come first
    expect(merged[0].source).toBe("builtin");
    expect(merged[0].name).toBe("model");

    // Discovered come after
    const todoIdx = merged.findIndex((c) => c.name === "todos");
    const modelIdx = merged.findIndex((c) => c.name === "model");
    expect(todoIdx).toBeGreaterThan(modelIdx);
  });

  it("includes all builtins", () => {
    const merged = mergeCommands([]);
    const builtins = merged.filter((c) => c.source === "builtin");
    expect(builtins.length).toBeGreaterThanOrEqual(9);
    expect(builtins.map((c) => c.name)).toContain("model");
    expect(builtins.map((c) => c.name)).toContain("thinking");
    expect(builtins.map((c) => c.name)).toContain("compact");
    expect(builtins.map((c) => c.name)).toContain("abort");
  });

  it("includes all discovered commands", () => {
    const merged = mergeCommands(PI_COMMANDS);
    expect(merged.find((c) => c.name === "todos")).toBeDefined();
    expect(merged.find((c) => c.name === "skill:web-search")).toBeDefined();
  });

  it("builtins have arg schemas, discovered commands don't", () => {
    const merged = mergeCommands(PI_COMMANDS);

    const model = merged.find((c) => c.name === "model")!;
    expect(model.args).toBeDefined();
    expect(model.args!.type).toBe("model_selector");

    const todos = merged.find((c) => c.name === "todos")!;
    expect(todos.args).toBeUndefined();
  });
});

describe("extractCommandNames", () => {
  it("returns a Set of command names", () => {
    const names = extractCommandNames(PI_COMMANDS);
    expect(names).toBeInstanceOf(Set);
    expect(names.has("todos")).toBe(true);
    expect(names.has("plan")).toBe(true);
    expect(names.has("skill:web-search")).toBe(true);
    expect(names.has("model")).toBe(false); // builtins not included
  });
});
