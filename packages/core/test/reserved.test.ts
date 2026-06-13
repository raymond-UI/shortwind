import { describe, expect, it } from "vitest";
import {
  RESERVED_RECIPE_NAMES,
  isReservedRecipeName,
  looksLikeRecipeToken,
  PROTO_POLLUTION_KEYS,
  isProtoPollutionKey,
} from "../src/reserved.js";

// reserved.ts had zero tests despite gating recipe names across core, cli, and
// the registry build (#57).
describe("reserved recipe names", () => {
  it("flags Tailwind @-utility collisions", () => {
    expect(isReservedRecipeName("container")).toBe(true);
    expect(RESERVED_RECIPE_NAMES.has("container")).toBe(true);
  });

  it("does not flag ordinary recipe names", () => {
    for (const name of ["card", "btn-primary", "stack-sm", "containerish"]) {
      expect(isReservedRecipeName(name)).toBe(false);
    }
  });
});

describe("prototype-pollution keys", () => {
  it("flags inherited Object.prototype member names", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(isProtoPollutionKey(key)).toBe(true);
      expect(PROTO_POLLUTION_KEYS.has(key)).toBe(true);
    }
  });

  it("does not flag safe names", () => {
    for (const name of ["card", "proto", "construct", "toString"]) {
      expect(isProtoPollutionKey(name)).toBe(false);
    }
  });
});

describe("looksLikeRecipeToken", () => {
  it("accepts recipe-shaped tokens", () => {
    for (const t of ["@badge", "@btn-primary", "@grid-2", "@stack-md", "@description-list"]) {
      expect(looksLikeRecipeToken(t)).toBe(true);
    }
  });

  it("rejects Tailwind @-utilities and non-recipe shapes", () => {
    for (const t of [
      "@container", // reserved (Tailwind's)
      "@md:flex", // variant (colon)
      "@2xl:grid", // variant starting with a digit
      "@min-[400px]:flex", // arbitrary variant (bracket, colon)
      "@container/sidebar", // named container (slash)
      "@Badge", // uppercase — not a recipe name shape
      "flex", // not an @-token
      "@", // empty
    ]) {
      expect(looksLikeRecipeToken(t)).toBe(false);
    }
  });
});
