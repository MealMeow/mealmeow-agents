# MealMeow Agents

Automated agent pipeline for the [MealMeow](https://github.com/MealMeow/MealMeow) cat food recommendation app. Runs Claude-powered agents on a daily schedule to research cat food products, update the Supabase database, write educational articles, and self-improve through a meta-agent feedback loop.

## How It Works

```
research → database → meta
learn ─────────────→ meta
```

1. **Research Agent** scrapes Chewy/Petco for new cat food products and pricing
2. **Database Agent** validates and upserts research data into Supabase `cat_foods`
3. **Learn Agent** writes veterinary-grade educational articles for the Learn section
4. **Display Agent** fixes UI bugs and rendering issues (on-demand)
5. **Meta Agent** runs last — analyzes results, updates project state, writes task queues for the next run

Each agent reads its task queue before executing. The meta agent is the only agent that writes task queues — agents cannot self-assign work.

## Current Stats

| Metric | Value |
|--------|-------|
| Total foods in database | 1,000 |
| Foods with autoship pricing | 986 |
| Published learn articles | 27 |
| Distinct brands | 101 |

## Architecture

```
mealmeow-agents/
├── .github/workflows/
│   ├── daily-pipeline.yml    # Mon-Fri at 8:00 AM UTC
│   └── weekly-report.yml     # Sundays at 10:00 AM UTC
├── agents/
│   ├── research-agent/       # Scrapes retailer sites for cat food data
│   │   ├── CLAUDE.md         # Agent system prompt
│   │   ├── task-queue.md     # Current tasks (written by meta-agent)
│   │   └── run.js            # Entry point script
│   ├── database-agent/       # Upserts research data into Supabase
│   ├── learn-agent/          # Writes educational articles
│   ├── display-agent/        # Fixes UI bugs and rendering issues
│   └── meta-agent/           # Orchestrates other agents, updates state
├── knowledge/
│   └── mealmeow-state.md     # Auto-updated project state dashboard
├── scripts/
│   ├── send-report.js        # Daily report → GitHub Actions Job Summary
│   └── send-weekly-report.js # Weekly aggregate report
└── logs/                     # Pipeline run logs (per-agent, per-date)
    ├── research-output/
    ├── database-log/
    ├── learn-log/
    └── meta-*.md
```

## Pipelines

### Daily Pipeline (`daily-pipeline.yml`)
Runs **Mon-Fri at 8:00 AM UTC**:

| Step | Agent | Timeout | What It Does |
|------|-------|---------|--------------|
| 1 | Research | 30 min | Scrapes new products from Chewy/Petco based on task queue |
| 2 | Database | 15 min | Upserts research output into Supabase, logs skips |
| 3 | Learn | 20 min | Writes or updates educational articles |
| 4 | Meta | 10 min | Analyzes run, updates state, writes next task queues, posts daily report |

### Weekly Report (`weekly-report.yml`)
Runs **Sundays at 10:00 AM UTC**. Aggregates the week's pipeline activity, database stats, and errors into a summary posted to the GitHub Actions Job Summary.

### Manual Trigger
Any workflow can be triggered from the Actions tab. The daily pipeline accepts an `agents` input to run specific agents:

```
agents: "research,database"  # Only run research and database
```

## Agents

### Research Agent
Browses Chewy.com and Petco.com to extract structured product data (pricing, nutrition, benefits, images). Outputs JSON matching the `cat_foods` schema.

**Scope lock:** Output JSON only — does NOT insert into the database.

### Database Agent
Receives JSON from the research agent and performs validated upserts into Supabase. Handles deduplication, enum validation, and merge logic for special_benefits arrays.

**Scope lock:** Process JSON input only — does NOT browse retailers.

### Learn Agent
Writes veterinary-grade educational articles with callout blocks, markdown tables, source citations, and MealMeow feature tie-ins. Outputs SQL INSERT statements for the `learn_articles` table.

**Scope lock:** Does NOT modify existing articles unless explicitly assigned.

### Display Agent
Diagnoses and fixes UI bugs, rendering issues, and display problems. Only runs when the task queue has entries.

**Scope lock:** Bug fixes only — does NOT add features or refactor.

### Meta Agent
The strategic planner. Runs after all other agents to:
- Analyze pipeline results and log patterns
- Update `knowledge/mealmeow-state.md` with current database stats
- Write task queues for the next pipeline run
- Post a daily report to the GitHub Actions Job Summary

**Exclusive authority:** Only the meta agent writes task queues.

## Guardrails

- **Max 3 tasks per agent per run** — prevents runaway execution
- **Scope lock** — each agent has explicit "do NOT" rules
- **2-retry limit** — failed tasks retry twice, then get escalated
- **No self-assignment** — only the meta agent writes task queues
- **Timeout enforcement** — GitHub Actions kills jobs that exceed limits
- **Git audit trail** — all state changes committed with timestamps

## Setup

### Required Secrets

Set these in **Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS for agent writes) |
| `ANTHROPIC_API_KEY` | Claude API key for agent runs |

### Reports
Reports are written to the **GitHub Actions Job Summary** — visible in the Actions tab after each run. No email service needed.

## Related

- [MealMeow App](https://github.com/MealMeow/MealMeow) — The main Next.js application
