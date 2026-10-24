# Support ticket triage app

Course project for AI Systems Integration and Operations (BCS S5, EPITA 2026), built on top of the
`triage-base` template.

The app is for a made-up BI SaaS company called Kestrel Analytics. A support agent pastes in a customer
ticket and the server suggests a category, a priority, a short summary and a next action. Only the
server talks to the model providers, so API keys never reach the browser.

There is also a simple chat page that keeps the conversation going by resending the history.

## Pages

- `/` chat
- `/triage` triage one ticket
- `/smoke` smoke test on the datasets
- `/admin` logged runs and call stats

## How to run it

You need Node.js 20.9 or newer.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Then fill in the keys in `.env.local` and open http://localhost:3033.

## Configuration

Everything provider-related comes from `.env.local` (see `.env.example`):

- `LLM_*` is the main model. We used Gemini 3.1 Flash Lite through Google's OpenAI-compatible endpoint.
- `LLM_ALT_*` is an optional second model for comparison. We tried NVIDIA's `openai/gpt-oss-20b`.
- `DM_*` is the decision model. We used `vllm-sr/d3-flash` from vLLM Semantic Router (the key is free).

`LLM_STRUCTURED_OUTPUT` can be `json_schema` (the provider enforces the schema) or `prompt` (the format
is only described in the prompt). The answer goes through Zod either way.

Prices are set per model so the cost columns mean something, and `*_MAX_RPM` is the requests-per-minute
limit. We added that one after the Gemini free tier started returning 429s during the smoke tests; the
runner now spaces out the requests.

## Triage strategies

You can pick the strategy on the triage page and on the smoke test page:

- `llm`: the LLM does everything (category, priority, summary, action).
- `dm`: the decision model picks the category and priority. It can't write text, so summary and action stay empty.
- `dm+llm`: the decision model picks, then the LLM writes the summary and action for that decision.

The reasoning behind this and the results are in [LLM-DM-report.md](./LLM-DM-report.md).

## How the code is organised

- `lib/llm.ts` is the only file that calls an LLM, and `lib/dm.ts` the only one that calls the decision model.
- `lib/prompt.ts` has the prompts and `PROMPT_VERSION` (currently `triage-v2`).
- `lib/schema.ts` has the Zod schemas for the requests and the responses. The triage schema is also
  converted to JSON Schema and sent to the provider.
- `lib/triage.ts` runs one ticket through the chosen strategy, and `lib/smoke.ts` runs a sample of tickets.
- `lib/errors.ts` turns every failure into one status code and one message that is safe to show.
- `lib/log.ts` writes one line per call to `logs/llm-calls.jsonl` and saves each smoke run in `runs/`.

Error handling:

| What went wrong | Status | Code |
|---|---|---|
| Bad request (invalid JSON, unknown field, empty ticket, ticket over 5000 characters, `system` role in chat) | 400 | `invalid_request` |
| Unknown model config, or a DM strategy without a DM key | 400 | `not_configured` |
| Model answer is not valid JSON or doesn't match the schema (retried once) | 502 | `invalid_model_output` |
| Provider rate limit | 429 | `rate_limited` |
| Provider down or network error | 502 | `triage_unavailable` |
| Timeout (30 s per attempt) | 504 | `triage_timeout` |
| Wrong key, model name or parameter | 500 | `internal_error` |

## Data

- `data/support_tickets_500.json`: 500 tickets without labels
- `data/support_tickets_100_labelled.json`: 100 labelled tickets, which we used as the dev set

What gets sent to the model is the subject, a blank line, then the body.

## Quality checklist

- [x] One LLM module, and the routes only call that module (no SDK calls in components)
- [x] Prompts in one place with a version
- [x] Provider settings only come from config
- [x] Each failure maps to one status and one safe message
- [x] Timeouts and retries are set explicitly (30 s, one retry)
- [x] No stack traces or provider details in responses
- [x] The key stays on the server: `/api/configs` only returns config names and model ids
- [x] `.env.local` is ignored by git (`git check-ignore -v .env.local`)
- [x] Tickets over 5000 characters get a 400 without calling the provider
- [x] Logs have no keys and no ticket text (only the ticket id and its length)
- [x] Injection tickets don't change the category, priority or format (see EXPERIMENTS.md)

The one thing we actually fixed while going through the list: TCK-10087 closes our `<ticket>` tag itself
and then adds its own "instructions". Now any `<ticket>` or `</ticket>` inside the customer text is
replaced before we wrap it.

## Results

Smoke tests on the 100 labelled tickets (one ticket is over 5000 characters and gets rejected on purpose,
so the percentages are out of 99):

| Strategy and model | Answered | Category | Priority | Median latency | Cost for 100 |
|---|---|---|---|---|---|
| llm, Gemini 3.1 Flash Lite | 99 | 96.0% | 83.8% | 3.7 s | $0.0084 |
| llm, NVIDIA gpt-oss-20b | 20 (79 timeouts) | 95% of 20 | 80% of 20 | 60 s | free |
| dm, vllm-sr/d3-flash | 99 | 89.9% | 71.7% | 0.13 s | free tier |
| dm+llm, d3-flash and Gemini | 99 | 89.9% | 71.7% | 3.0 s | $0.0089 |

Differences we noticed between the two LLMs:

1. Gemini accepted `json_schema`, and we ran gpt-oss-20b in `prompt` mode.
2. gpt-oss-20b is a reasoning model and used about 2.5 times more output tokens per ticket.
3. The free NVIDIA endpoint was very slow and timed out on most of the tickets.

Our conclusion: Gemini for the triage itself, since it was more accurate and only an LLM can write the
summary. The decision model is much faster and its confidence turned out to be reliable on this set, so
it would make sense as a first pass, with the LLM handling the tickets where it isn't sure.

## Checks

```sh
npm run typecheck
npm run build
```
