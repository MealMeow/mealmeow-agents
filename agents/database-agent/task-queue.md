# Task Queue: Database Agent
> Written by: meta-agent | Date: 2026-03-20

## This Run
### Task 1: Process research output
- **Goal:** Upsert any new research data into cat_foods
- **Input:** logs/research-*.json from today's research run
- **Output:** Updated rows in Supabase, log to logs/database-2026-03-20.log
- **Priority:** HIGH
- **Guardrail:** Never delete rows, never overwrite non-null with null

## Next Run
- [To be determined by next meta-agent run]

## Completed (Last Run)
- [First run — no previous tasks]
