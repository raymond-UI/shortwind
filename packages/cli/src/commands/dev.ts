import path from "node:path";
import chokidar from "chokidar";
import { readConfig } from "../project.js";
import { build, BuildError } from "./build.js";

export type DevOptions = {
  cwd: string;
  signal?: AbortSignal;
  onStatus?: (status: DevStatus) => void;
  debounceMs?: number;
  reconcileIntervalMs?: number;
};

export type DevStatus =
  | { kind: "ready"; recipesDir: string }
  | { kind: "rebuilt"; families: string[]; changed: boolean }
  | { kind: "error"; message: string };

export async function dev(options: DevOptions): Promise<{ stop: () => Promise<void> }> {
  options.signal?.throwIfAborted();
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const debounceMs = options.debounceMs ?? 50;
  const reconcileIntervalMs = options.reconcileIntervalMs ?? Math.max(1000, debounceMs * 5);

  const status = (s: DevStatus): void => options.onStatus?.(s);

  const watcher = chokidar.watch(recipesDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 25, pollInterval: 10 },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let pending = false;
  let pendingSilent = true;

  const runBuild = async (silentNoChange = false): Promise<void> => {
    if (running) {
      pending = true;
      pendingSilent = pendingSilent && silentNoChange;
      return;
    }
    running = true;
    try {
      let currentSilent = silentNoChange;
      do {
        pending = false;
        pendingSilent = true;
        try {
          const result = await build({ cwd });
          if (!currentSilent || result.changed) {
            status({ kind: "rebuilt", families: result.families, changed: result.changed });
          }
        } catch (err) {
          if (err instanceof BuildError) status({ kind: "error", message: err.message });
          else status({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
        currentSilent = pendingSilent;
      } while (pending);
    } finally {
      running = false;
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runBuild(false), debounceMs);
  };

  watcher.on("add", schedule).on("change", schedule).on("unlink", schedule);

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    await watcher.close();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      await stop();
      return { stop };
    }
    options.signal.addEventListener("abort", () => void stop(), { once: true });
  }

  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  if (stopped) return { stop };

  // initial build so SKILL.md is current at start
  await runBuild();
  if (stopped) return { stop };
  status({ kind: "ready", recipesDir });
  reconcileTimer = setInterval(() => void runBuild(true), reconcileIntervalMs);

  return { stop };
}
