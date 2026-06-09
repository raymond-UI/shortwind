import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/registry.js";
import { buildMessages } from "../src/prompts.js";
import { TASKS } from "../src/tasks.js";

const catalog = loadCatalog();
const task = TASKS[0]!;

describe("prompts (A/B conditions)", () => {
  it("the only difference between conditions is the guidance", () => {
    const control = buildMessages(catalog, "control", task);
    const guided = buildMessages(catalog, "guided", task);

    const controlSys = control[0]!.content;
    const guidedSys = guided[0]!.content;

    // guided carries the selection hint + per-family guidance blockquotes;
    // control does not.
    expect(guidedSys).toContain("Read it before picking");
    expect(controlSys).not.toContain("Read it before picking");
    expect(guidedSys).toContain("> ");
    expect(controlSys).not.toMatch(/\n> /);

    // both still list the same recipes
    expect(controlSys).toContain("@card");
    expect(guidedSys).toContain("@card");

    // the user turn (the task) is identical
    expect(control[1]!.content).toBe(guided[1]!.content);
    expect(guidedSys.length).toBeGreaterThan(controlSys.length);
  });

  it("instructs the model to only use catalog recipe names", () => {
    const [system] = buildMessages(catalog, "guided", task);
    expect(system!.content).toContain("Do not invent recipe names");
  });
});
