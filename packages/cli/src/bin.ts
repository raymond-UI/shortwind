#!/usr/bin/env node
import { run } from "./cli.js";

run().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
