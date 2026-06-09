import { afterAll, describe, expect, it } from "vitest";
import { loadCatalog } from "../src/registry.js";
import { buildMessages } from "../src/prompts.js";
import { createOfflineClient } from "../src/offline.js";
import { createGrader } from "../src/grader.js";
import { buildReport, type TaskResult } from "../src/report.js";
import { TASKS } from "../src/tasks.js";

const catalog = loadCatalog();
const grader = createGrader();
afterAll(() => grader.dispose());

describe("harness (offline, end-to-end)", () => {
  it("the simulated guided condition has a strictly lower unknown rate", async () => {
    const client = createOfflineClient(TASKS);
    const results: TaskResult[] = [];
    for (const task of TASKS) {
      for (const condition of ["control", "guided"] as const) {
        const messages = buildMessages(catalog, condition, task);
        const gen = await client.generate({ model: "offline/sim", messages });
        const score = await grader.grade(gen.text);
        results.push({ model: "offline/sim", condition, taskId: task.id, score, output: gen.text });
      }
    }

    const [report] = buildReport(results);
    expect(report).toBeDefined();
    // The simulator models the hypothesis: guidance eliminates the invented
    // names it emits under control. This asserts the *pipeline* detects that
    // differential, not that a real model behaves this way.
    expect(report!.control.totalUnknown).toBeGreaterThan(0);
    expect(report!.guided.totalUnknown).toBe(0);
    expect(report!.guided.meanUnknownRate).toBeLessThan(report!.control.meanUnknownRate);
  });
});
