"use client";

import { useState, type FormEvent } from "react";
import {
  errorMessage,
  ModelSelect,
  postJson,
  StrategySelect,
  useConfigs,
  type StrategyName,
} from "../components/controls";

type Row = {
  ticket_id: string;
  tags: string | null;
  outcome: string;
  status: number;
  expected: { category: string; priority: string } | null;
  predicted: { category: string; priority: string } | null;
  category_match: boolean | null;
  priority_match: boolean | null;
  dm_confidence: { category: number; priority: number } | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
};

type Run = {
  run_id: string;
  dataset: "labelled100" | "all500";
  sample_size: number;
  strategy: StrategyName;
  llm_model: string | null;
  dm_model: string | null;
  prompt_version: string;
  outcomes: Record<string, number>;
  accuracy: { category: number; priority: number; both: number } | null;
  mismatches: { category: number; priority: number } | null;
  latency_ms: { avg: number; p50: number; p95: number; wall: number };
  tokens: { input: number; output: number; total: number };
  cost_usd: number;
  rows: Row[];
  file?: string;
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return ok ? <span className="ok">✓</span> : <span className="bad">✗</span>;
}

export default function SmokePage() {
  const info = useConfigs();
  const [dataset, setDataset] = useState<"labelled100" | "all500">("labelled100");
  const [sample, setSample] = useState(10);
  const [strategy, setStrategy] = useState<StrategyName>("llm");
  const [config, setConfig] = useState("default");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const { ok, status, data } = await postJson("/api/smoke", { dataset, sample, strategy, config });
      if (!ok) throw new Error(`${errorMessage(data, "The smoke test failed to start.")} (HTTP ${status})`);
      setRun(data as Run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The smoke test failed.");
    } finally {
      setBusy(false);
    }
  }

  const labelled = run?.dataset === "labelled100";

  return (
    <main className="page wide">
      <h1>Smoke test</h1>
      <form onSubmit={start} className="row" aria-busy={busy}>
        <label className="field">
          Dataset
          <select value={dataset} onChange={(e) => setDataset(e.target.value as typeof dataset)} disabled={busy}>
            <option value="labelled100">Labelled dev set (100 tickets)</option>
            <option value="all500">All tickets (500, unlabelled)</option>
          </select>
        </label>
        <label className="field">
          Random sample size
          <input
            type="number"
            min={1}
            max={100}
            value={sample}
            onChange={(e) => setSample(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            disabled={busy}
          />
        </label>
        <StrategySelect info={info} value={strategy} onChange={setStrategy} disabled={busy} />
        {strategy !== "dm" && <ModelSelect info={info} value={config} onChange={setConfig} disabled={busy} />}
        <button type="submit" disabled={busy}>
          {busy ? `Running ${sample} tickets...` : "Run smoke test"}
        </button>
      </form>
      {busy && <p className="muted">Tickets run 3 at a time. Free tiers can be slow: allow a few seconds per ticket.</p>}
      {error && <p role="alert">{error}</p>}

      {run && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Outcome</th>
                {labelled && <th>Expected category</th>}
                <th>Predicted category</th>
                {labelled && <th>Expected priority</th>}
                <th>Predicted priority</th>
                {run.strategy !== "llm" && <th>DM confidence (cat / pri)</th>}
                <th>Latency</th>
                <th>Tokens (in/out)</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {run.rows.map((r) => (
                <tr key={r.ticket_id} className={r.outcome !== "ok" ? "error-row" : undefined}>
                  <td>{r.ticket_id}</td>
                  <td>{r.outcome === "ok" ? "200" : `${r.status} ${r.outcome}`}</td>
                  {labelled && <td>{r.expected?.category}</td>}
                  <td>
                    {r.predicted?.category ?? "—"} <Mark ok={r.category_match} />
                  </td>
                  {labelled && <td>{r.expected?.priority}</td>}
                  <td>
                    {r.predicted?.priority ?? "—"} <Mark ok={r.priority_match} />
                  </td>
                  {run.strategy !== "llm" && (
                    <td>
                      {r.dm_confidence
                        ? `${pct(r.dm_confidence.category)} / ${pct(r.dm_confidence.priority)}`
                        : "—"}
                    </td>
                  )}
                  <td>{r.latency_ms} ms</td>
                  <td>
                    {r.input_tokens}/{r.output_tokens}
                  </td>
                  <td className="muted">{r.tags}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="card">
            <h2>Summary</h2>
            <p>
              {run.sample_size} tickets · {run.strategy} · LLM: {run.llm_model ?? "—"} · DM: {run.dm_model ?? "—"} ·{" "}
              {run.prompt_version}
            </p>
            <p>
              Outcomes:{" "}
              {Object.entries(run.outcomes)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}
            </p>
            {run.mismatches && run.accuracy && (
              <p>
                <strong>Mismatches</strong>: category {run.mismatches.category}, priority {run.mismatches.priority}{" "}
                (out of {run.outcomes.ok ?? 0} answered) · accuracy: category {pct(run.accuracy.category)}, priority{" "}
                {pct(run.accuracy.priority)}, both {pct(run.accuracy.both)}
              </p>
            )}
            <p>
              Latency avg {run.latency_ms.avg} ms, p50 {run.latency_ms.p50} ms, p95 {run.latency_ms.p95} ms · wall{" "}
              {(run.latency_ms.wall / 1000).toFixed(1)} s · tokens {run.tokens.input} in / {run.tokens.output} out · cost $
              {run.cost_usd.toFixed(5)}
            </p>
            <p className="muted">Saved to {run.file}. See all runs on /admin.</p>
          </section>
        </>
      )}
    </main>
  );
}
