"use client";

import { useState, type FormEvent } from "react";
import { errorMessage, postJson } from "../components/controls";

const MAX_TICKET_CHARS = 5000;

type Usage = { input_tokens: number; output_tokens: number; total_tokens: number };
type TriageResponse = {
  triage: { category: string; priority: string; summary: string | null; suggested_action: string | null };
  meta: {
    strategy: string;
    prompt_version: string;
    llm_model: string | null;
    dm_model: string | null;
    latency_ms: number;
    usage: { llm: Usage | null; dm: Usage | null; total: Usage };
    cost_usd: number;
    dm_probabilities: { category: Record<string, number>; priority: Record<string, number> } | null;
  };
};

function Probabilities({ values }: { values: Record<string, number> }) {
  return (
    <span className="probs">
      {Object.entries(values)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(" · ")}
    </span>
  );
}

export default function TriagePage() {
  const [ticket, setTicket] = useState("");
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { ok, status, data } = await postJson("/api/triage", { ticket });
      if (!ok) throw new Error(`${errorMessage(data, "Triage failed. Please try again.")} (HTTP ${status})`);
      setResult(data as TriageResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Triage failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const tooLong = ticket.length > MAX_TICKET_CHARS;

  return (
    <main className="page">
      <h1>Ticket triage</h1>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="ticket">Ticket (subject, blank line, body)</label>
        <textarea
          id="ticket"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          rows={10}
          placeholder={"CSV export fails\n\nAfter upgrading, every CSV export fails with error 500..."}
          disabled={busy}
        />
        <small className={tooLong ? "warn" : "muted"}>
          {ticket.length} / {MAX_TICKET_CHARS} characters
          {tooLong && " (too long: the server will reject it)"}
        </small>
        <button type="submit" disabled={busy}>
          {busy ? "Triaging..." : "Triage"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>

      {result && (
        <section className="card" aria-live="polite">
          <dl className="fields">
            <dt>Category</dt>
            <dd>
              <span className="badge">{result.triage.category}</span>
              {result.meta.dm_probabilities && <Probabilities values={result.meta.dm_probabilities.category} />}
            </dd>
            <dt>Priority</dt>
            <dd>
              <span className={`badge ${result.triage.priority}`}>{result.triage.priority}</span>
              {result.meta.dm_probabilities && <Probabilities values={result.meta.dm_probabilities.priority} />}
            </dd>
            <dt>Summary</dt>
            <dd>{result.triage.summary ?? <em className="muted">not written: a decision model only chooses</em>}</dd>
            <dt>Suggested action</dt>
            <dd>{result.triage.suggested_action ?? <em className="muted">not written: a decision model only chooses</em>}</dd>
          </dl>

          <p className="muted">
            {result.meta.strategy} · {result.meta.prompt_version} · {result.meta.latency_ms} ms · $
            {result.meta.cost_usd.toFixed(6)}
          </p>
        </section>
      )}
    </main>
  );
}
