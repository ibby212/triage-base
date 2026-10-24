"use client";

import { useEffect, useState } from "react";

export type ConfigInfo = {
  llm: { name: string; label: string; model: string }[];
  dm: { model: string } | null;
};

export type StrategyName = "llm" | "dm" | "dm+llm";

// Loads the server-side configurations (names and models only, never keys).
export function useConfigs() {
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  useEffect(() => {
    fetch("/api/configs")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ llm: [], dm: null }));
  }, []);
  return info;
}

export function ModelSelect({
  info,
  value,
  onChange,
  disabled,
}: {
  info: ConfigInfo | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      LLM model
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || !info}>
        {info?.llm.map((c) => (
          <option key={c.name} value={c.name}>
            {c.label} ({c.model})
          </option>
        ))}
      </select>
    </label>
  );
}

const STRATEGY_LABELS: Record<StrategyName, string> = {
  llm: "LLM only",
  dm: "Decision model only",
  "dm+llm": "Decision model + LLM",
};

export function StrategySelect({
  info,
  value,
  onChange,
  disabled,
}: {
  info: ConfigInfo | null;
  value: StrategyName;
  onChange: (value: StrategyName) => void;
  disabled?: boolean;
}) {
  const dmReady = Boolean(info?.dm);
  return (
    <label className="field">
      Strategy
      <select value={value} onChange={(e) => onChange(e.target.value as StrategyName)} disabled={disabled}>
        {(Object.keys(STRATEGY_LABELS) as StrategyName[]).map((s) => (
          <option key={s} value={s} disabled={s !== "llm" && !dmReady}>
            {STRATEGY_LABELS[s]}
            {s !== "llm" && !dmReady ? " (not configured)" : ""}
          </option>
        ))}
      </select>
      {info?.dm && value !== "llm" && <small>Decision model: {info.dm.model}</small>}
    </label>
  );
}

// Reads { error: { message } } from an API response, with a safe fallback.
export function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return fallback;
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // non-JSON error page
  }
  return { ok: response.ok, status: response.status, data };
}
