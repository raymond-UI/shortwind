#!/usr/bin/env node
import { run } from "./cli.js";

run().catch((err: unknown) => {
  // Print a concise message by default — a full stack can leak request context
  // (URLs, tokens in error chains). Show the stack only under an explicit debug
  // opt-in (`SHORTWIND_DEBUG`), where the operator is deliberately diagnosing.
  const debug = Boolean(process.env.SHORTWIND_DEBUG);
  if (err instanceof Error) {
    console.error(debug ? (err.stack ?? err.message) : `error: ${err.message}`);
  } else {
    console.error(debug ? err : `error: ${String(err)}`);
  }
  process.exit(1);
});
