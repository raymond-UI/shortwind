#!/usr/bin/env node
import { run, formatFatalError } from "./cli.js";

run().catch((err) => {
  // Friendly, single-line error by default — a raw stack leaks internal paths
  // and request context (audit #156). `SHORTWIND_DEBUG=1` restores the stack.
  const debug =
    process.env.SHORTWIND_DEBUG === "1" || process.env.SHORTWIND_DEBUG === "true";
  console.error(formatFatalError(err, debug));
  process.exit(1);
});
