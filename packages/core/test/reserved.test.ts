import { describe, expect, it } from "vitest";
import {
  RESERVED_RECIPE_NAMES,
  isReservedRecipeName,
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
