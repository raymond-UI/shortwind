import { afterAll, describe, expect, it } from "vitest";
import { createGrader } from "../src/grader.js";

// One grader (one temp project) shared across the suite; disposed at the end.
const grader = createGrader();
afterAll(() => grader.dispose());

describe("grader", () => {
  it("counts real recipe tokens with zero unknowns", async () => {
    const score = await grader.grade(`<div className="@card @stack-md" />`);
    expect(score.recipeTokens).toBe(2);
    expect(score.unknown).toBe(0);
    expect(score.unknownRate).toBe(0);
  });

  it("flags an invented recipe name as unknown", async () => {
    const score = await grader.grade(`<div className="@flex-row @row" />`);
    // @flex-row does not exist; @row does.
    expect(score.unknown).toBe(1);
    expect(score.recipeTokens).toBe(2);
    expect(score.unknownRate).toBeCloseTo(0.5, 5);
  });

  it("counts raw utilities toward density but not recipe tokens", async () => {
    const score = await grader.grade(`<div className="@card p-4 text-center" />`);
    expect(score.recipeTokens).toBe(1);
    expect(score.rawTokens).toBe(2);
    expect(score.recipeDensity).toBeCloseTo(1 / 3, 5);
  });

  it("detects a conflicting-intent selection mistake", async () => {
    const score = await grader.grade(`<button className="@btn-primary @btn-danger" />`);
    expect(score.conflicts).toBeGreaterThanOrEqual(1);
  });

  it("detects a redundant utility already in a recipe", async () => {
    // @card expands to include rounded-lg; restating it is redundant.
    const score = await grader.grade(`<div className="@card rounded-lg" />`);
    expect(score.redundant).toBeGreaterThanOrEqual(1);
  });

  it("treats output with no classes as empty, not divide-by-zero", async () => {
    const score = await grader.grade(`<div />`);
    expect(score.recipeTokens).toBe(0);
    expect(score.unknownRate).toBe(0);
    expect(score.recipeDensity).toBe(0);
  });
});
