import OpenAI from "openai";

// One place that maps every failure to one HTTP status and one safe message.
// No stack trace or provider detail reaches the browser.
//
// | Failure                                  | Status | Code                 |
// | Invalid JSON or schema mismatch          | 502    | invalid_model_output |
// | Provider 429                             | 429    | rate_limited         |
// | Provider 5xx or network                  | 502    | triage_unavailable   |
// | Timeout                                  | 504    | triage_timeout       |
// | Wrong key, model or parameter (4xx)      | 500    | internal_error       |

export type ErrorCode =
  | "invalid_request"
  | "invalid_model_output"
  | "rate_limited"
  | "triage_unavailable"
  | "triage_timeout"
  | "not_configured"
  | "internal_error";

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "The request is invalid.",
  invalid_model_output: "The model returned an answer we could not use. Please try again.",
  rate_limited: "The model provider is rate limiting us. Please wait a moment and retry.",
  triage_unavailable: "The model provider is unavailable right now. Please try again later.",
  triage_timeout: "The model took too long to answer. Please try again.",
  not_configured: "This model or strategy is not configured on the server.",
  internal_error: "Something went wrong on our side. The incident was logged.",
};

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_model_output: 502,
  rate_limited: 429,
  triage_unavailable: 502,
  triage_timeout: 504,
  not_configured: 400,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  // Server-side detail, for the log only.
  readonly detail?: string;

  constructor(code: ErrorCode, options: { message?: string; detail?: string } = {}) {
    super(options.detail ?? code);
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = options.message ?? SAFE_MESSAGES[code];
    this.detail = options.detail;
  }
}

export function fromHttpStatus(status: number, detail: string): AppError {
  if (status === 429) return new AppError("rate_limited", { detail });
  if (status === 408 || status === 504) return new AppError("triage_timeout", { detail });
  if (status >= 500) return new AppError("triage_unavailable", { detail });
  return new AppError("internal_error", { detail });
}

// Turns anything thrown by the OpenAI SDK, fetch or our code into an AppError.
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AppError("triage_timeout", { detail: error.message });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AppError("triage_unavailable", { detail: error.message });
  }
  if (error instanceof OpenAI.APIError) {
    return fromHttpStatus(error.status ?? 500, `${error.status} ${error.message}`.slice(0, 300));
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new AppError("triage_timeout", { detail: error.message });
  }
  if (error instanceof TypeError) {
    // fetch() network failures surface as TypeError("fetch failed").
    return new AppError("triage_unavailable", { detail: error.message });
  }
  return new AppError("internal_error", {
    detail: error instanceof Error ? error.message : String(error),
  });
}

export function errorResponse(error: AppError): Response {
  return Response.json(
    { error: { code: error.code, message: error.publicMessage } },
    { status: error.status },
  );
}
