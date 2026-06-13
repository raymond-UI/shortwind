import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/registry.js";
import { resolveGuess } from "../src/guess.js";
import { GUESSES, KNOWN_GAPS } from "../src/guess-corpus.js";

// ≥90%: an agent guessing a recipe name from intent should land on the real
// recipe at least this often (the naming-grammar acceptance target).
const GUESSABILITY_TARGET = 0.9;

const names = new Set(Object.keys(loadCatalog().registry.flattened));

describe("guessability", () => {
  it(`resolves ≥${GUESSABILITY_TARGET * 100}% of realistic name guesses`, () => {
    const misses: string[] = [];
    let hits = 0;
    for (const g of GUESSES) {
      const { hit, via } = resolveGuess(g.guess, names);
      if (hit === g.expected) hits++;
      else misses.push(`  @${g.guess} → ${hit ? `@${hit} (${via})` : "unknown"}  (wanted @${g.expected}) — ${g.intent}`);
    }
    const rate = hits / GUESSES.length;
    // Surface the number and any misses regardless of pass/fail.
    console.log(
      `\nguessability: ${hits}/${GUESSES.length} = ${(rate * 100).toFixed(1)}% (target ${GUESSABILITY_TARGET * 100}%)` +
        (misses.length ? `\nmisses:\n${misses.join("\n")}` : ""),
    );
    expect(rate).toBeGreaterThanOrEqual(GUESSABILITY_TARGET);
  });

  it("every resolved guess lands on a real recipe", () => {
    for (const g of GUESSES) {
      const { hit } = resolveGuess(g.guess, names);
      if (hit !== null) expect(names.has(hit)).toBe(true);
    }
  });

  // The tracked gaps. These SHOULD currently fail to resolve — each is closed by
  // a specific follow-up (abbreviation aliases, a default-size alias). When one
  // starts resolving, this flips red as a nudge to promote it into GUESSES.
  it("known gaps do not resolve yet (tracking the alias/default-size work)", () => {
    const unexpectedlyResolved: string[] = [];
    for (const gap of KNOWN_GAPS) {
      const { hit } = resolveGuess(gap.guess, names);
      if (hit === gap.expected) {
        unexpectedlyResolved.push(`  @${gap.guess} now resolves to @${gap.expected} — promote it (was blocked by: ${gap.blockedBy})`);
      }
    }
    if (unexpectedlyResolved.length) {
      console.log(`\nnewly-resolving gaps:\n${unexpectedlyResolved.join("\n")}`);
    }
    expect(unexpectedlyResolved).toEqual([]);
  });
});
