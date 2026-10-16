# aivo

A personal AI "chief of staff" that lives in Discord. It's a single long-running
Node/TypeScript service: a Discord bot with an in-house LLM tool-calling agent loop,
first-class LLM cost control (model tiering, budget caps, an owner-approval gate for
expensive requests), and a YouTube subscriptions daily digest as its centerpiece
capability. A read-only web dashboard rides along as a second workspace in this repo,
served by the same backend pod.

Discord is the primary interface — there's no general-purpose HTTP API. The only HTTP
surface is `/health`, the dashboard API, and a one-time YouTube OAuth callback.

## Docs

- [`docs/concept.md`](docs/concept.md) — product concept: why this exists, the persona,
  the digest UX, cost-control philosophy.
- [`docs/technical-overview.md`](docs/technical-overview.md) — architecture and the
  technical decisions behind it.
- [`docs/data-model.md`](docs/data-model.md) — database schema and rationale.
- [`docs/deployment.md`](docs/deployment.md) — how it's deployed.
- [`docs/phase-3-web-dashboard-prd.md`](docs/phase-3-web-dashboard-prd.md) — the web
  dashboard's requirements.
- [`docs/roadmap.md`](docs/roadmap.md) — implementation status by slice. Each doc carries
  a status blockquote at the top — trust that over the prose beneath it, since the prose
  can lag the actual state of the code.
- [`AGENTS.md`](AGENTS.md) — repo map and conventions for coding agents working in this
  codebase.

## Stack

TypeScript on Node, pnpm workspaces (`backend/`, `frontend/`). Express + discord.js on the
backend, Postgres via Kysely, an OpenAI-SDK-compatible LLM provider. The frontend is a
Vite + React SPA. Biome for lint/format, Vitest for tests.

## Audio model pricing

Voice messages are transcribed by Scaleway audio models, whose billing doesn't fit the
per-token pricing used for chat, so `model_pricing` carries a separate per-minute audio
price (`audio_cost_per_min_cents`) and STT cost is metered as rate × duration. The quirk:
Scaleway bills the two models differently. `whisper-large-v3` is genuinely priced per
audio minute (€0.003/min), so the linear formula is exact for it. `voxtral-small-24b-2507`
is priced per *token* (€0.15/M in, €0.35/M out): audio input tokenizes at 1 token per
80 ms (750 tokens per minute) and is **rounded up to 30-second chunks** — a 10 s clip
bills as a full 30 s — plus the transcript itself as output tokens. Its seeded rate
(0.03¢/min) is a flat equivalent of that shape, set slightly high so short clips' chunk
round-up never under-counts. Transcription resolves the audio model from the user's
model-tier preference (the same way chat does), then meters and degrades against the
budget like any other call. By default both audio tier slots in `model_tier_assignments`
are seeded to voxtral — ~10× cheaper than whisper per minute *and* the stronger
transcriber — so either tier lands on it out of the box; whisper stays priced but
unassigned, one `set_tier_role` away if you ever want to point a slot at it.

## Prompt-cache pricing

Scaleway caches request prefixes automatically (per project, no opt-in) and bills
input tokens that hit the cache at a discounted rate. `model_pricing` carries that as an
optional `cached_input_cost_per_mtok_cents`; NULL means no known discount, so cache hits
bill at the full input price. The hit count comes from the provider's response —
`usage.prompt_tokens_details.cached_tokens`, the OpenAI-compatible field — and is stored
per call in `llm_usage.tokens_cached` (a subset of `tokens_in`). A server that omits the
field simply reports zero hits, which bills conservatively at full price. The pre-call
approval-gate estimate deliberately ignores caching (it can't know the hit rate ahead of
time), so it stays an over-estimate. Cache hits need a byte-identical prefix, which is
why `buildContext` orders the prompt most-stable-first (persona → memories → the volatile
clock line → transcript). The dashboard's Models page shows each model's cached price
and its observed cache-hit ratio; the Usage page's token-mix chart plots cached input per
day alongside tokens in/out, with the range's overall cache-hit rate.

## Getting started

Requires Node (see `.nvmrc`), pnpm, and Docker (for backend tests). Copy `.env.example`
to `.env` and fill in a dev Discord bot token and the other secrets described there.

```
pnpm install
pnpm dev            # backend + frontend, both in watch mode
```

`docker-compose.yml` brings up Postgres alongside the service for a closer-to-prod local
run. See [`AGENTS.md`](AGENTS.md) for the full command list (typecheck, lint, test, build)
and the repo's internal conventions.

By default `pnpm dev` serves the backend on `:8081` and the Vite frontend on `:3001`
(see `frontend/vite.config.ts`); these are dedicated local ports chosen to avoid
colliding with the other homectl repos' dev servers in this workspace.

### Testing the aivo↔unforked integration locally

To exercise the `unforked/` tool (`backend/src/unforked/client.ts`) against a real
unforked instance instead of leaving it unconfigured, also run unforked's own local
stack (its human API defaults to `:8082` locally, but the machine API aivo actually
calls is a separate listener on `:8086` — see unforked's own README). Then in aivo's
`.env`, set `UNFORKED_BASE_URL=http://localhost:8086` and register a real `ufk_...`
API key via aivo's dashboard Settings page — mint the key from unforked's own UI
first, since aivo never generates or reads it from an env var (see
`unforked docs/aivo-integration.md` for the API contract).

### Running the real homectl-auth-proxy sidecar locally (Option B)

`pnpm dev:sidecar` runs aivo with `AUTH_MODE=sidecar` (`.env.sidecar`), which expects
identity headers from an actual `homectl-auth-proxy` in front of it rather than the
`pnpm dev` fixed dev principal. To put the real sidecar in the loop without a login
flow, run it with a fake identity (homectl-auth `docs/sidecar/integration.md` §"Option
B — `DEV_FAKE_IDENTITY`"), pointed at aivo's local backend port and homectl-auth's
local auth API (`:4400`, unchanged — no in-cluster DNS locally so
`PUBLIC_AUTH_URL`/`INTERNAL_AUTH_URL` are the same address):

```bash
docker run --rm -p 4180:4180 \
  -e NODE_ENV=development \
  -e PUBLIC_AUTH_URL=http://localhost:4400 \
  -e INTERNAL_AUTH_URL=http://localhost:4400 \
  -e AUTH_CLIENT_ID=aivo \
  -e AUTH_CLIENT_SECRET=dev \
  -e APP_BASE_URL=http://localhost:4180 \
  -e UPSTREAM=http://host.docker.internal:8081 \
  -e LISTEN_PORT=4180 \
  -e COOKIE_KEY="$(openssl rand -base64 32)" \
  -e DEV_FAKE_IDENTITY='{"sub":"dev-user","email":"dev@homectl.no","role":"admin"}' \
  rg.fr-par.scw.cloud/homectl/homectl-auth-proxy:latest
```

Start aivo with `pnpm dev:sidecar` first (so `:8081` is up), then hit the dashboard
through the sidecar on `:4180` instead of `:3001`/`:8081` directly.
