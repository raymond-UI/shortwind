import type { GenerationScore } from "./grader.js";
import type { Condition } from "./registry.js";

export type TaskResult = {
  model: string;
  condition: Condition;
  taskId: string;
  score: GenerationScore;
  output: string;
};

export type ConditionAgg = {
  n: number;
  meanUnknownRate: number;
  totalUnknown: number;
  totalConflicts: number;
  totalRedundant: number;
  meanRecipeDensity: number;
};

export type ModelReport = {
  model: string;
  control: ConditionAgg;
  guided: ConditionAgg;
};

function aggregate(results: TaskResult[]): ConditionAgg {
  const n = results.length;
  if (n === 0) {
    return {
      n: 0,
      meanUnknownRate: 0,
      totalUnknown: 0,
      totalConflicts: 0,
      totalRedundant: 0,
      meanRecipeDensity: 0,
    };
  }
  let unknownRate = 0;
  let unknown = 0;
  let conflicts = 0;
  let redundant = 0;
  let density = 0;
  for (const r of results) {
    unknownRate += r.score.unknownRate;
    unknown += r.score.unknown;
    conflicts += r.score.conflicts;
    redundant += r.score.redundant;
    density += r.score.recipeDensity;
  }
  return {
    n,
    meanUnknownRate: unknownRate / n,
    totalUnknown: unknown,
    totalConflicts: conflicts,
    totalRedundant: redundant,
    meanRecipeDensity: density / n,
  };
}

export function buildReport(results: TaskResult[]): ModelReport[] {
  const models = [...new Set(results.map((r) => r.model))];
  return models.map((model) => {
    const forModel = results.filter((r) => r.model === model);
    return {
      model,
      control: aggregate(forModel.filter((r) => r.condition === "control")),
      guided: aggregate(forModel.filter((r) => r.condition === "guided")),
    };
  });
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

// Lower is better for unknown/conflicts/redundant; higher for density. The
// arrow shows whether guidance moved each metric the right way.
function delta(control: number, guided: number, lowerIsBetter: boolean): string {
  const d = guided - control;
  if (Math.abs(d) < 1e-9) return "·";
  const better = lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}${better ? " ✓" : " ✗"}`;
}

export function formatReport(reports: ModelReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`\nModel: ${r.model}   (${r.control.n} tasks × 2 conditions)`);
    lines.push("─".repeat(64));
    const rows: Array<[string, number, number, boolean]> = [
      ["Unknown-recipe rate (mean)", r.control.meanUnknownRate, r.guided.meanUnknownRate, true],
      ["Recipe density (mean)", r.control.meanRecipeDensity, r.guided.meanRecipeDensity, false],
    ];
    const counts: Array<[string, number, number, boolean]> = [
      ["Unknown recipes (total)", r.control.totalUnknown, r.guided.totalUnknown, true],
      ["Selection conflicts (total)", r.control.totalConflicts, r.guided.totalConflicts, true],
      ["Redundant utilities (total)", r.control.totalRedundant, r.guided.totalRedundant, true],
    ];
    lines.push(`${"Metric".padEnd(30)}${"Control".padStart(10)}${"Guided".padStart(10)}${"Δ".padStart(12)}`);
    for (const [label, c, g, lower] of rows) {
      lines.push(
        `${label.padEnd(30)}${pct(c).padStart(10)}${pct(g).padStart(10)}${delta(c, g, lower).padStart(12)}`,
      );
    }
    for (const [label, c, g, lower] of counts) {
      lines.push(
        `${label.padEnd(30)}${String(c).padStart(10)}${String(g).padStart(10)}${delta(c, g, lower).padStart(12)}`,
      );
    }
  }
  lines.push("");
  lines.push("✓ = guidance moved the metric the right way · lower is better except recipe density.");
  return lines.join("\n");
}
