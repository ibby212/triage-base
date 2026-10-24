# LLM vs Decision Model: research, integration and results

Triage App, AI Systems Integration and Operations, BCS S5 2026.

## 1. What a decision model (DM) is, for this app

A decision model reads a state (here: the ticket text) and answers typed questions about it
(`choice`, `noul` yes/no, `score`) with a probability per option. It cannot answer outside the options
we give it, and it cannot write. In our app this maps naturally to the two closed-set fields of the triage:

| Triage field | Closed set? | DM can do it? |
|---|---|---|
| `category` | yes, 4 values | yes: `choice` question |
| `priority` | yes, 3 values | yes: `choice` question (or `score`, ordered) |
| `summary` | no, free text | no |
| `suggested_action` | no, free text | no |

So a DM can replace the LLM for the *decision*, but not for the *writing*.

## 2. Free decision models we found (October 2026)

| Provider / model | Endpoint | Free? | Notes |
|---|---|---|---|
| vLLM Semantic Router, Decision 3.0 (`vllm-sr/d3-turbo` 27B, `d3-flash` 9B, `d3-mini` 4B, `d3-nano`, `d3-lite`, `d3-edge`) | `POST https://decision.vllm-sr.ai/v1/systemone` | Yes: free key, no account (one click, or a proof-of-work request); per-minute and daily quotas per key | Typed questions `choice` / `noul` / `score` (+ `box` for images). Decision 1.0 was deprecated on 10 Oct; 3.0 current since 17 Oct. |
| Inception Mercury Decide (free) on OpenRouter | OpenRouter Decisions API (not the chat endpoint) | Yes, rate limited; needs an OpenRouter account and key | Free variant listed on OpenRouter. |
| TypeSafe Jev (`typesafe/jev-1.x`) on OpenRouter | `/api/v1/systemone` | No: billed per input token (output free) | The model that started the category (15 Sept). TypeSafe's own signup was paused. |
| Upstage Solar Decide on OpenRouter | OpenRouter Decisions API | No: about $0.05 per million input tokens | |
| OpenAI Decisions API (GPT-6 Luna) | `POST /v1/decisions` | No: paid OpenAI API (public beta since 6 Oct) | |
| Cloudflare Clef / Clef-flash, AWS Strands Decider, Perplexity pplx-decider | open weights | Free to download, not a free hosted API | Would need our own GPU to serve. |

### Choice: vLLM Semantic Router Decision 3.0, `vllm-sr/d3-flash`

- Free without an account or a card: the only option where a student gets a key in one click.
- Same request contract as the course (`/v1/systemone`, `state` + `questions` + `criteria`), so the
  code follows the slides directly.
- `d3-flash` (9B) rather than `d3-turbo` (27B): the free quotas are per model and per minute; the
  mid-size model is the cheaper, faster default for a 4-way and a 3-way choice. Switching is one line
  (`DM_MODEL` in `.env.local`).
- Risk accepted: a weeks-old service (the 1.0 family lived about two weeks), and vendor-reported numbers.
  The integration is isolated in one module (`lib/dm.ts`) so it can be swapped.

## 3. Integration strategy

The user picks the strategy on the Triage page and on the Smoke test page:

| Strategy | Flow | Why it exists |
|---|---|---|
| `llm` | ticket → LLM → `{category, priority, summary, suggested_action}` → Zod | Baseline (triage v2). |
| `dm` | ticket → DM (2 `choice` questions) → `{category, priority}` + probabilities → Zod | Fastest, cheapest possible triage; no text. |
| `dm+llm` | ticket → DM decides `category` + `priority` → LLM writes `summary` + `suggested_action` for that decision → Zod | Each model does what it is good at: the DM chooses, the LLM writes. |

Implementation notes:

- `lib/dm.ts` calls `/v1/systemone` with plain `fetch` (the chat SDK does not apply), with a 30 s
  timeout and one retry on 429 that honours `Retry-After`.
- The DM answer is untrusted like any other: it is parsed with Zod, and an option outside our enum
  is rejected as `invalid_model_output` (502).
- The decision guidance lives in the questions as data (`criteria`): what each category and each
  priority means, plus "judge the impact, not the tone". The questions are versioned
  (`DM_QUESTIONS_VERSION = "dm-questions-v1"`) like the LLM prompt.
- In `dm+llm`, the LLM is told the decision and asked to keep it; the code then forces the DM's
  category and priority into the result, so the LLM cannot override the decision.
- With `dm`, `summary` and `suggested_action` are `null` in the response schema, and the page says why.
- The probabilities of each DM answer are returned and shown next to the badges on the Triage page.
- Every call is logged with `strategy`, `api`, `llm_model` and `dm_model`; every smoke run stores
  both models, and `/admin` shows them in the runs table, the comparison and the call statistics.

## 4. Results

All runs: the full labelled dev set (100 tickets, `data/support_tickets_100_labelled.json`), started from the
Smoke test page or `POST /api/smoke`, 24 Oct 2026. One ticket (TCK-10308, > 5,000 characters) is rejected with
a 400 by design in every run, so accuracy is over 99 answered tickets. Run files are in `runs/`.

| Strategy | Model(s) | Answered | Category acc. | Priority acc. | Both | Avg latency (p50 / p95) | Tokens in / out | Cost (100 tickets) |
|---|---|---|---|---|---|---|---|---|
| `llm` | Gemini 3.1 Flash Lite | 99 | 96.0 % | 83.8 % | 80.8 % | 7.9 s (3.7 s / 35.2 s)¹ | 51,634 / 8,151 | $0.0084² |
| `dm` | vllm-sr/d3-flash | 99 | 89.9 % | 71.7 % | 62.6 % | 0.14 s (0.13 s / 0.18 s) | 51,292 / 0 | $0 (free tier)³ |
| `dm+llm` | d3-flash + Gemini | 99 | 89.9 % | 71.7 % | 62.6 % | 5.5 s (3.0 s / 22.9 s)¹ | 106,313 / 8,456 | $0.0089 |
| `llm` | NVIDIA gpt-oss-20b | 20 (79 timeouts) | 95.0 %⁴ | 80.0 %⁴ | 80.0 %⁴ | 56 s (60 s timeouts) | 10,641 / 4,184 | $0 (free trial) |

¹ The LLM latencies include the free tier's 429 back-off (about 15 requests per minute); the median is the fairer number.
² At the configured $0.10 / $0.40 per million input / output tokens.
³ Free key. At the ~$0.24 per million input tokens quoted for hosted decision models, the same run would cost about $0.012:
the DM bills input only, but reads as many input tokens as the LLM (about 518 per ticket, the ticket plus the questions).
⁴ Over the 20 answered tickets only: not comparable.

Run files: `…-563d-triage-v2-llm-gemini…json`, `…-2a71-dm-questions-v1-dm-vllm-sr_d3-flash.json` (with per-ticket DM
confidence), `…-b1bc-…dm…json` (same DM run, before confidence was stored), `…-5003-…dm+llm…json`, `…-3afb-…gpt-oss-20b.json`.

### Confusion (where the mistakes are)

| | LLM (Gemini) | DM (d3-flash) |
|---|---|---|
| Category | 3 `account` → `technical_bug`, 1 `feature_request` → `technical_bug` | 7 `account` → `technical_bug`, 3 others |
| Priority | 8 `medium` → `low`, 5 `medium` → `high`, 2 `high` → `medium`, 1 `low` → `medium` | 18 `medium` → `low`, 4 `medium` → `high`, 6 `high` → `medium` |

### Slices (both category and priority right)

| Tag | LLM | DM |
|---|---|---|
| adversarial / prompt injection | 8 / 8 | 7 / 8 |
| multilingual | 7 / 7 | 7 / 7 |
| has PII | 13 / 14 | 11 / 14 |
| noisy | 6 / 8 | 4 / 8 |
| ambiguous | 4 / 7 | 5 / 7 |
| tone mismatch | 2 / 4 | 1 / 4 |

### Is the DM's confidence honest? (calibration, d3-flash run with confidence)

| DM confidence in its own answer | Category: n / accuracy | Priority: n / accuracy |
|---|---|---|
| < 0.6 | 6 / 33 % | 27 / 52 % |
| 0.6 – 0.8 | 14 / 71 % | 29 / 55 % |
| 0.8 – 0.9 | 11 / 82 % | 21 / 90 % |
| ≥ 0.9 | 68 / 100 % | 22 / 100 % |
| mean confidence vs accuracy | 0.90 vs 0.90 | 0.74 vs 0.72 |

On this set the confidence is well calibrated: the average confidence matches the accuracy, and every answer given
with ≥ 0.9 confidence was right. (The slides warn that this is not guaranteed: one public test found 87 % confidence
for 75 % accuracy. 99 tickets is a small sample.)

### DM vs LLM agreement

The DM and the LLM agree on the category for 91 / 99 tickets (97 % correct when they agree) and on the priority for
78 / 99 (86 % correct when they agree).

## 5. Analysis

What the DM is good at here. Category on clear tickets: 0.14 s instead of seconds, no output tokens, no invalid
JSON, no code fence, no retry. It never failed the format, and the response was always one of our options. It handled
the multilingual and injection tickets as well as the LLM did.

Where it loses. Priority. Its typical mistake is rating `medium` tickets as `low` (18 of 28 priority misses), across
all categories. Priority depends on business rules (impact, number of users affected, deadlines) that the LLM gets as
several lines of decision guidance, while the DM gets one short description per option. Our hypothesis, not yet
tested: richer priority `criteria`, or a `score` question instead of a `choice`, would close part of the gap. The DM also files more
user-management tickets (invitations, sharing) as bugs.

`dm+llm`. The decisions are the DM's, so the accuracy is the DM's (identical to `dm`: the DM is deterministic on the
same input). It adds the LLM's summary and action, but costs as much as `llm` (two calls, about twice the input tokens)
and is slower than `dm`. It brings no accuracy gain over `dm` and costs more than `llm`: it makes sense only if the decision
must come with auditable probabilities while a human still needs a written summary.

Cost. Against a cheap "flash-lite" LLM, the DM is not cheaper per ticket at public decision-model prices: the bill
is input tokens, and both read the same ticket. The DM's advantages are latency, guaranteed format and the
probabilities. Against a mid-range LLM (about $2.88 per 1,000 requests on the slides), the saving would be large.

The second LLM (F5). The free NVIDIA endpoint for `gpt-oss-20b` timed out on 79 of 100 tickets at 30 s per attempt
(two attempts). Three differences with Gemini: (1) latency, 26 s for a single ticket earlier versus 1 to 4 s; (2)
structured output, which we ran in `prompt` mode, while Gemini accepted `json_schema`; (3) output tokens, which include
hidden reasoning (about 210 per ticket versus 82 for Gemini). On the 20 tickets it answered, its accuracy was close to
Gemini's. It is not usable for this feature on the free tier.

### Which model for which task

The LLM decides and writes the triage. The DM serves as a fast first pass: its answer is used when it is confident, and
the LLM is called otherwise. Category and priority are a closed set, which suits the DM, but on this set the LLM is
clearly more accurate (81 % vs 63 % fully right) and only the LLM can write the summary and the action. The DM's
calibrated confidence makes a cascade attractive:

| Cascade (simulated from the two runs above) | Tickets the DM handles alone | Category | Priority | Both | LLM tokens |
|---|---|---|---|---|---|
| DM confidence ≥ 0.85 on both questions, else LLM | 23 / 99 | 96.0 % | 83.8 % | 80.8 % | −22 % |
| DM confidence ≥ 0.80 on both questions, else LLM | 32 / 99 | 94.9 % | 83.8 % | 79.8 % | −32 % |

At 0.85 the cascade keeps the LLM's accuracy and skips about a quarter of the LLM calls (for those tickets, the
summary would be left to the agent or generated on demand). This is a simulation on the same 99 tickets, not a
measured run. It is the next strategy to implement, and it should be validated on the hold-out set.

### Limits of this evaluation

- 99 labelled tickets, one run per strategy: a difference of 2 to 3 points is within noise.
- The prompt and the DM questions were tuned on this same dev set (no hold-out).
- Vendor-hosted, weeks-old models: results can change when the provider updates `d3-flash`.
- Prices are configuration values (`.env.local`), not invoices.

## Sources

- Course slides: *LLM API Integration – Part III – Xtra – Decisions Decisions* (decision models, endpoints, providers).
- vLLM Semantic Router Decision 3.0 API docs: https://decision.vllm-sr.ai/docs
- OpenRouter: Jev guide (https://openrouter.ai/docs/guides/community/jev), Mercury Decide (free), Solar Decide model pages.
- TrueFoundry AI Gateway, Decisions API (`/v1/decisions`, `/v1/systemone`): https://www.truefoundry.com/docs/ai-gateway/decisions
