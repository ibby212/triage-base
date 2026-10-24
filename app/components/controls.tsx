"use client";

import { useEffect, useState } from "react";

export type ConfigInfo = {
  llm: { name: string; label: string; model: string }[];
};

// Loads the server-side configurations (names and models only, never keys).
export function useConfigs() {
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  useEffect(() => {
    fetch("/api/configs")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ llm: [] }));
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
