# MealMeow Agents

Automated agent pipeline for the [MealMeow](https://github.com/MealMeow/MealMeow) cat food recommendation app. This repo runs Claude-powered agents on a schedule to research cat food products, update the database, write educational articles, and generate reports.

## Architecture

```
mealmeow-agents/
├── .github/workflows/       # GitHub Actions (daily pipeline, weekly report)
├── agents/
│   ├── research-agent/      # Scrapes retailer sites for cat food data
│   ├── database-agent/      # Upserts research data into Supabase
│   ├── learn-agent/         # Writes/updates educational articles
│   ├── display-agent/       # Fixes UI bugs and rendering issues
│   └── meta-agent/          # Orchestrates other agents, updates state
├── knowledge/               # Shared project state (auto-updated by meta-agent)
├── scripts/                 # Email report scripts
└── logs/                    # Pipeline run logs (gitignored except .gitkeep)
```

## Pipelines

### Daily Pipeline (`daily-pipeline.yml`)
Runs Mon-Fri at 8:00 AM UTC:
1. **Research Agent** — scrapes new products from Chewy/Petco
2. **Database Agent** — upserts research output into Supabase `cat_foods`
3. **Learn Agent** — writes or updates educational articles
4. **Meta Agent** — analyzes run results, updates state, sends daily report

### Weekly Report (`weekly-report.yml`)
Runs Sundays at 10:00 AM UTC. Aggregates the week's pipeline activity, database stats, and errors into a summary email.

## Setup

### Required Secrets
Set these in GitHub repo Settings > Secrets and variables > Actions:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `ANTHROPIC_API_KEY` | Claude API key for agent runs |
| `REPORT_EMAIL` | Email address for pipeline reports |
| `SENDGRID_API_KEY` | SendGrid API key for sending emails |

### Manual Trigger
Any workflow can be triggered manually from the Actions tab. The daily pipeline accepts an `agents` input to run specific agents:

```
agents: "research,database"  # Only run research and database agents
```

## Agent Configuration
Each agent folder contains:
- `CLAUDE.md` — Agent system prompt and configuration
- `task-queue.md` — Current/next tasks (populated by meta-agent)
- `run.js` — Entry point script (to be implemented)

## Shared Knowledge
`knowledge/mealmeow-state.md` is the single source of truth for project state. The meta-agent updates it after each pipeline run with database stats, coverage gaps, and priorities.
