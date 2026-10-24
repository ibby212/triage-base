import "server-only";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// One request = one line in logs/llm-calls.jsonl. Never the key, never the full ticket text.
// Smoke test runs are saved to runs/<date>-<prompt-version>-<strategy>-<model>.json.

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "llm-calls.jsonl");
const RUNS_DIR = path.join(process.cwd(), "runs");

export type CallLogEntry = {
  ts: string;
  route: "chat" | "triage" | "smoke";
  strategy: string | null;
  api: "chat.completions" | "systemone" | "chat.completions+systemone";
  prompt_version: string | null;
  config: string;
  llm_model: string | null;
  dm_model: string | null;
  status: number;
  error_code: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  ticket_id?: string;
  ticket_chars?: number;
  run_id?: string;
};

export async function logCall(entry: CallLogEntry): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (error) {
    // Logging must never break the feature.
    console.error("[log] could not write call log", error);
  }
}

export async function readCallLog(): Promise<CallLogEntry[]> {
  try {
    const text = await readFile(LOG_FILE, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as CallLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9.+-]+/g, "_").slice(0, 60);
}

export async function saveRun(run: { run_id: string; prompt_version: string; strategy: string; llm_model: string | null; dm_model: string | null }): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const model = [run.llm_model, run.dm_model].filter(Boolean).join("+") || "none";
  const file = `${run.run_id}-${slug(run.prompt_version)}-${slug(run.strategy)}-${slug(model)}.json`;
  await writeFile(path.join(RUNS_DIR, file), JSON.stringify(run, null, 2), "utf8");
  return `runs/${file}`;
}

export async function readRuns<T>(): Promise<(T & { file: string })[]> {
  try {
    const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".json")).sort().reverse();
    const runs: (T & { file: string })[] = [];
    for (const file of files) {
      try {
        runs.push({ ...(JSON.parse(await readFile(path.join(RUNS_DIR, file), "utf8")) as T), file: `runs/${file}` });
      } catch {
        // skip unreadable run files
      }
    }
    return runs;
  } catch {
    return [];
  }
}
