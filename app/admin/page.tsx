import { readCallLog, readRuns, type CallLogEntry } from "@/lib/log";
import type { SmokeRun } from "@/lib/smoke";

// Reads the files on every request: always up to date, no cache.
export const dynamic = "force-dynamic";

const pct = (n: number | undefined) => (n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);
const usd = (n: number) => `$${n.toFixed(5)}`;

type Group = { key: string; calls: number; errors: number; input: number; output: number; cost: number; latency: number };

function groupCalls(entries: CallLogEntry[], keyOf: (e: CallLogEntry) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const key = keyOf(e);
    const g = groups.get(key) ?? { key, calls: 0, errors: 0, input: 0, output: 0, cost: 0, latency: 0 };
    g.calls++;
    if (e.status !== 200) g.errors++;
    g.input += e.input_tokens ?? 0;
    g.output += e.output_tokens ?? 0;
    g.cost += e.cost_usd;
    g.latency += e.latency_ms;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.calls - a.calls);
}

function modelOf(run: SmokeRun) {
  return [run.llm_model, run.dm_model].filter(Boolean).join(" + ");
}

const COMPARE_ROWS: [string, (r: SmokeRun) => string][] = [
  ["Date", (r) => new Date(r.ts).toLocaleString("en-GB")],
  ["Strategy", (r) => r.strategy],
  ["LLM model", (r) => r.llm_model ?? "—"],
  ["Decision model", (r) => r.dm_model ?? "—"],
  ["Prompt version", (r) => r.prompt_version],
  ["Dataset / sample", (r) => `${r.dataset} / ${r.sample_size}`],
  ["Outcomes", (r) => Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")],
  ["Category accuracy", (r) => pct(r.accuracy?.category)],
  ["Priority accuracy", (r) => pct(r.accuracy?.priority)],
  ["Both correct", (r) => pct(r.accuracy?.both)],
  ["Mismatches (cat / pri)", (r) => (r.mismatches ? `${r.mismatches.category} / ${r.mismatches.priority}` : "—")],
  ["Latency avg / p95", (r) => `${r.latency_ms.avg} / ${r.latency_ms.p95} ms`],
  ["Wall time", (r) => `${(r.latency_ms.wall / 1000).toFixed(1)} s`],
  ["Tokens in / out", (r) => `${r.tokens.input} / ${r.tokens.output}`],
  ["Tokens per ticket", (r) => (r.sample_size ? Math.round(r.tokens.total / r.sample_size).toString() : "—")],
  ["Cost", (r) => usd(r.cost_usd)],
];

function Confusion({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const labels = [...new Set([...Object.keys(matrix), ...Object.values(matrix).flatMap(Object.keys)])].sort();
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>expected ↓ / predicted →</th>
          {labels.map((l) => <th key={l}>{l}</th>)}
        </tr>
      </thead>
      <tbody>
        {labels.map((e) => (
          <tr key={e}>
            <th>{e}</th>
            {labels.map((p) => (
              <td key={p} className={e === p ? "diag" : matrix[e]?.[p] ? "off" : undefined}>
                {matrix[e]?.[p] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const [runs, calls, params] = await Promise.all([readRuns<SmokeRun>(), readCallLog(), searchParams]);
  const a = runs.find((r) => r.run_id === params.a) ?? runs[1];
  const b = runs.find((r) => r.run_id === params.b) ?? runs[0];
  const compared = [a, b].filter((r): r is SmokeRun & { file: string } => Boolean(r));

  const totals = groupCalls(calls, () => "all")[0];
  const byStatus = groupCalls(calls, (e) => (e.status === 200 ? "200" : `${e.status} ${e.error_code}`));
  const byModel = groupCalls(calls, (e) => `${e.route} · ${e.strategy ?? "-"} · ${e.api} · ${[e.llm_model, e.dm_model].filter(Boolean).join(" + ") || "?"} · ${e.prompt_version ?? "-"}`);

  return (
    <main className="page wide">
      <h1>Admin</h1>

      <h2>Smoke test runs ({runs.length})</h2>
      {runs.length === 0 ? (
        <p>No runs yet. Start one from the Smoke test page.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>Strategy</th><th>Model(s)</th><th>Prompt</th><th>Dataset</th><th>N</th>
              <th>Outcomes</th><th>Cat. acc.</th><th>Pri. acc.</th><th>Mismatch cat/pri</th>
              <th>Avg latency</th><th>Tokens</th><th>Cost</th><th>File</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td>{new Date(r.ts).toLocaleString("en-GB")}</td>
                <td>{r.strategy}</td>
                <td>{modelOf(r)}</td>
                <td>{r.prompt_version}</td>
                <td>{r.dataset}</td>
                <td>{r.sample_size}</td>
                <td>{Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}</td>
                <td>{pct(r.accuracy?.category)}</td>
                <td>{pct(r.accuracy?.priority)}</td>
                <td>{r.mismatches ? `${r.mismatches.category}/${r.mismatches.priority}` : "—"}</td>
                <td>{r.latency_ms.avg} ms</td>
                <td>{r.tokens.total}</td>
                <td>{usd(r.cost_usd)}</td>
                <td className="muted">{r.file}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {runs.length > 0 && (
        <>
          <h2>Compare two runs</h2>
          <form className="row" method="get">
            {(["a", "b"] as const).map((slot, i) => (
              <label className="field" key={slot}>
                Run {slot.toUpperCase()}
                <select name={slot} defaultValue={compared[i]?.run_id}>
                  {runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {new Date(r.ts).toLocaleString("en-GB")} · {r.strategy} · {modelOf(r)} · n={r.sample_size}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="submit">Compare</button>
          </form>
          <table className="table">
            <thead>
              <tr>
                <th></th>
                {compared.map((r, i) => <th key={i}>Run {i === 0 ? "A" : "B"}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label, fn]) => (
                <tr key={label}>
                  <th>{label}</th>
                  {compared.map((r, i) => <td key={i}>{fn(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid2">
            {compared.map((r, i) =>
              r.confusion ? (
                <div key={i}>
                  <h3>Run {i === 0 ? "A" : "B"}: category confusion</h3>
                  <Confusion matrix={r.confusion.category} />
                  <h3>Run {i === 0 ? "A" : "B"}: priority confusion</h3>
                  <Confusion matrix={r.confusion.priority} />
                </div>
              ) : null,
            )}
          </div>
        </>
      )}

      <h2>All calls (logs/llm-calls.jsonl)</h2>
      {!totals ? (
        <p>No calls logged yet.</p>
      ) : (
        <>
          <p>
            {totals.calls} calls · {totals.errors} errors · {totals.input} input / {totals.output} output tokens ·{" "}
            {usd(totals.cost)}
          </p>
          <h3>By status</h3>
          <table className="table compact">
            <thead><tr><th>Status</th><th>Calls</th></tr></thead>
            <tbody>{byStatus.map((g) => <tr key={g.key}><td>{g.key}</td><td>{g.calls}</td></tr>)}</tbody>
          </table>
          <h3>By route, strategy, API, model and prompt version</h3>
          <table className="table">
            <thead>
              <tr><th>Group</th><th>Calls</th><th>Errors</th><th>Input tok.</th><th>Output tok.</th><th>Avg latency</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {byModel.map((g) => (
                <tr key={g.key}>
                  <td>{g.key}</td><td>{g.calls}</td><td>{g.errors}</td><td>{g.input}</td><td>{g.output}</td>
                  <td>{Math.round(g.latency / g.calls)} ms</td><td>{usd(g.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
