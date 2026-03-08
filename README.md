<div align="center">

# Fairtrail

**The price trail airlines don't show you.**

Track flight prices over time. Self-hosted. Open source. Bring your own LLM.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/affromero/fairtrail/pulls)

</div>

---

## Quick Start

```bash
git clone git@github.com:affromero/fairtrail.git
cd fairtrail
cp .env.example .env
# Add at least one LLM API key to .env (Anthropic, OpenAI, or Google)
docker compose up -d
```

Open [localhost:3003](http://localhost:3003) — the setup wizard will guide you through first-run configuration.

## Why Fairtrail?

Every flight price tracker gives you "alert me when it's cheap." None of them let you *see* how prices evolve — and none give you a shareable link with that data.

**This isn't an accident:**

1. **Aggregators want you inside their app.** Google Flights and Hopper track history internally but lock charts behind your account.
2. **"Buy or Wait" is more profitable than transparency.** A black-box prediction keeps you dependent on their platform.
3. **Airlines don't want price transparency.** If you can see that a route dips 3 weeks before departure, that undermines dynamic pricing.

**Fairtrail exists because the data is useful to *you* — just not to the companies that have it.**

### What you get

- **Natural language search** — `"NYC to Paris around June 15 ± 3 days"`
- **Price evolution charts** — see how fares move over days and weeks
- **Shareable links** — send `/q/abc123` to anyone, no login required
- **Direct booking links** — click any data point to go straight to the airline
- **Airline comparison** — see which carriers are cheapening vs. getting expensive
- **Self-hosted** — your data stays on your machine
- **Agent-friendly API** — hook Claude Code, OpenClaw, Codex, or any agent into your instance

## Community Data

Fairtrail is **fully decentralized**. You run everything — scraping, LLM calls, storage — on your own machine. There is no central server doing work for you.

**What fairtrail.org does:** aggregates anonymized price data that self-hosted instances **opt in** to share. Think of it as a community price database that grows as more people run Fairtrail.

**What gets shared (opt-in only):**
- Route (origin/destination airports)
- Travel date, price, currency, airline, stops, cabin class
- When the data was scraped

**What is never shared:**
- Your queries, search history, or preferences
- Your LLM API keys
- Your IP address or identity

Enable community sharing during the setup wizard or later in `/admin → Config`. Explore community data at [fairtrail.org/explore](https://fairtrail.org/explore).

## LLM Providers

Fairtrail needs an LLM for two things: parsing natural language queries and extracting price data from Google Flights pages. Pick **any one** of these:

| Provider | Env Var | Cost | Notes |
|----------|---------|------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | ~$0.001/query | Claude Haiku 4.5 (default) |
| **OpenAI** | `OPENAI_API_KEY` | ~$0.0004/query | GPT-4.1 Mini |
| **Google** | `GOOGLE_AI_API_KEY` | ~$0.00015/query | Gemini 2.5 Flash (cheapest) |
| **Claude Code** | `CLAUDE_CODE_ENABLED=true` | Free (Max plan) | Mount `~/.claude` from host |
| **Codex CLI** | `CODEX_ENABLED=true` | Free | Mount `~/.codex` from host |

To use CLI providers (Claude Code, Codex), uncomment the volume mounts in `docker-compose.yml`.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | One LLM key required | — | Anthropic API key |
| `OPENAI_API_KEY` | | — | OpenAI API key |
| `GOOGLE_AI_API_KEY` | | — | Google AI API key |
| `POSTGRES_PASSWORD` | | `postgres` | Database password |
| `ADMIN_PASSWORD` | | Auto-generated | Admin panel password |
| `ADMIN_SESSION_SECRET` | | Auto-generated | Session signing key |
| `CRON_SECRET` | | Auto-generated | Cron auth token |
| `CRON_ENABLED` | | `true` | Enable built-in scrape scheduler |
| `CRON_INTERVAL_HOURS` | | `6` | Hours between scrape runs |
| `REDIS_URL` | | Set by compose | Optional — app works without Redis |
| `COMMUNITY_HUB_URL` | | `https://fairtrail.org` | Hub for community data sharing |
| `PORT` | | `3003` | Web server port |

Secrets left empty are auto-generated on first run and printed in Docker logs.

## Agent & CLI Integration

Your local Fairtrail instance exposes a REST API that any agent, script, or CLI tool can use. No SDK needed — just HTTP calls to `localhost:3003`.

See [`AGENTS.md`](AGENTS.md) for the full API reference.

### Quick example

```bash
# 1. Parse a natural language query
curl -s -X POST http://localhost:3003/api/parse \
  -H "Content-Type: application/json" \
  -d '{"query": "NYC to Paris around June 15 ± 3 days"}' | jq .

# 2. Create a tracked query (use the parsed response)
curl -s -X POST http://localhost:3003/api/queries \
  -H "Content-Type: application/json" \
  -d '{
    "rawInput": "NYC to Paris around June 15 ± 3 days",
    "origin": "JFK", "originName": "New York JFK",
    "destination": "CDG", "destinationName": "Paris CDG",
    "dateFrom": "2026-06-12", "dateTo": "2026-06-18",
    "flexibility": 3, "cabinClass": "economy",
    "tripType": "round_trip", "routes": [...]
  }' | jq .

# 3. Trigger an immediate scrape
curl -s http://localhost:3003/api/cron/scrape \
  -H "Authorization: Bearer $CRON_SECRET" | jq .

# 4. Get price data for a query
curl -s http://localhost:3003/api/queries/{id}/prices | jq .
```

### Using with Claude Code

Add your Fairtrail API to Claude Code's context so it can track flights for you:

```bash
# In your project's CLAUDE.md or conversation:
"Track NYC to Paris flights for mid-June. Use the Fairtrail API at
http://localhost:3003. See AGENTS.md for endpoints."
```

Claude Code will read `AGENTS.md`, understand the API, and make the calls.

### Using with any agent (OpenClaw, Codex, custom)

Any agent that can make HTTP requests works. Point it at your Fairtrail instance:

1. Set `FAIRTRAIL_URL=http://localhost:3003` in the agent's environment
2. Give it the `CRON_SECRET` if you want it to trigger scrapes
3. Let it read `AGENTS.md` for the API schema

The endpoints are auth-free in self-hosted mode (except scrape triggering, which needs `CRON_SECRET`).

## How It Works

```
You type: "SFO to Tokyo sometime in July ± 5 days"
                        │
                        ▼
              ┌─────────────────┐
              │   LLM Parser    │  Extracts origin, destination,
              │  (Claude/GPT)   │  date range, flexibility
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Playwright    │  Navigates Google Flights
              │   (headless)    │  with your exact query
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  LLM Extractor  │  Reads the page, extracts
              │  (configurable) │  structured price data
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   PostgreSQL    │  Stores price snapshots
              │   + Prisma     │  with timestamps
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Plotly.js      │  Interactive chart at
              │  /q/[id]       │  a shareable public URL
              └─────────────────┘
```

The built-in cron runs on a configurable interval (default: every 6h). Each run captures prices across all active queries and the chart pages update automatically.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), TypeScript, CSS Modules |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache | Redis 7 (optional) |
| Browser | Playwright (headless Chromium) |
| LLM | Anthropic, OpenAI, Google, Claude Code, or Codex |
| Charts | Plotly.js (interactive) |
| Cron | Built-in (node-cron) or external trigger |

## Architecture

```
fairtrail/
├── apps/web/                 # Next.js 15 app (@fairtrail/web)
│   ├── src/app/              # Pages + API routes
│   │   ├── page.tsx          # Landing — natural language search bar
│   │   ├── q/[id]/           # Public shareable chart page
│   │   ├── explore/          # Community data explorer
│   │   ├── setup/            # First-run setup wizard
│   │   ├── admin/            # Admin panel (LLM config, queries, costs)
│   │   └── api/              # REST endpoints
│   │       ├── parse/        # LLM query parsing
│   │       ├── queries/      # Query CRUD + price data
│   │       ├── cron/         # Scrape trigger
│   │       └── community/    # Registration + data ingest + routes
│   ├── src/components/       # UI components (SearchBar, PriceChart, etc.)
│   ├── src/lib/              # Core logic
│   │   ├── scraper/          # Playwright + LLM extraction pipeline
│   │   ├── community-sync.ts # Opt-in data sharing to fairtrail.org
│   │   ├── cron.ts           # Built-in scrape scheduler
│   │   ├── prisma.ts         # Database client
│   │   ├── redis.ts          # Cache client (optional)
│   │   └── admin-auth.ts     # Session management
│   └── prisma/schema.prisma  # Database models
├── AGENTS.md                 # API reference for agents & scripts
├── docker-compose.yml        # Self-hosted: PostgreSQL, Redis, web
├── docker-compose.prod.yml   # Production deployment
├── Dockerfile                # Multi-stage build with Chromium
└── .env.example              # Configuration template
```

## Development

```bash
# Install dependencies
npm install

# Start database + cache
docker compose up -d db redis

# Apply schema
npm run db:push

# Generate Prisma client
npm run db:generate

# Start dev server (set env vars or use `doppler run --`)
npm run dev
```

## Admin Panel

Access at `/admin` to:

- **Manage queries** — pause, resume, delete, adjust scrape frequency
- **Configure LLM** — choose extraction provider and model
- **Monitor costs** — see LLM API usage per scrape run
- **View fetch history** — success/failure status, errors, snapshot counts

## Contributing

Pull requests welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
