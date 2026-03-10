/**
 * Meta Agent — run.js
 * Analyzes pipeline run results, updates mealmeow-state.md,
 * and writes task queues for the next run.
 *
 * Writes report to GitHub Actions Job Summary.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;

const today = new Date().toISOString().slice(0, 10);

// ── Supabase Stats ──────────────────────────────────────────────
async function fetchStats() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('No Supabase credentials — using placeholder stats');
    return { foods: '—', wet: '—', dry: '—', autoship: '—', articles: '—', users: '—' };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [all, wet, dry, autoship, articles, users] = await Promise.all([
    sb.from('cat_foods').select('id', { count: 'exact', head: true }),
    sb.from('cat_foods').select('id', { count: 'exact', head: true }).eq('food_type', 'wet'),
    sb.from('cat_foods').select('id', { count: 'exact', head: true }).eq('food_type', 'dry'),
    sb.from('cat_foods').select('id', { count: 'exact', head: true }).not('price_autoship', 'is', null),
    sb.from('learn_articles').select('id', { count: 'exact', head: true }).eq('is_published', true),
    sb.from('profiles').select('id', { count: 'exact', head: true }),
  ]);

  return {
    foods: all.count ?? '—',
    wet: wet.count ?? '—',
    dry: dry.count ?? '—',
    autoship: autoship.count ?? '—',
    articles: articles.count ?? '—',
    users: users.count ?? '—',
  };
}

// ── Collect today's pipeline logs ───────────────────────────────
function collectLogs() {
  const logsDir = path.resolve('logs');
  const results = [];

  if (!fs.existsSync(logsDir)) return results;

  // Check for artifact subdirectories (GitHub Actions downloads into named folders)
  const entries = fs.readdirSync(logsDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(logsDir, entry.name);

    if (entry.isDirectory()) {
      // Artifact folder — read files inside
      const files = fs.readdirSync(entryPath);
      for (const file of files) {
        results.push(parseLogFile(path.join(entryPath, file), file));
      }
    } else if (entry.isFile() && entry.name !== '.gitkeep') {
      results.push(parseLogFile(entryPath, entry.name));
    }
  }

  return results.filter(Boolean);
}

function parseLogFile(filePath, fileName) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const agent = fileName.split('-')[0];

    try {
      const data = JSON.parse(content);
      return {
        agent,
        file: fileName,
        status: data.status || 'completed',
        itemsProcessed: data.itemsProcessed || 0,
        errors: data.errors || [],
        duration: data.duration || '—',
      };
    } catch {
      return {
        agent,
        file: fileName,
        status: content.includes('ERROR') ? 'error' : 'completed',
        itemsProcessed: 0,
        errors: [],
        duration: '—',
      };
    }
  } catch {
    return null;
  }
}

// ── Update mealmeow-state.md ───────────────────────────────────
function updateState(stats, logs) {
  const logRows = logs.length > 0
    ? logs.map((l) => `| ${today} | ${l.agent} | ${l.status} | ${l.itemsProcessed} items |`).join('\n')
    : `| ${today} | meta | completed | State refresh only |`;

  const state = `# MealMeow Project State

> Auto-updated by the meta-agent on ${today}

## Database Stats
| Metric | Value | Last Updated |
|--------|-------|--------------|
| Total cat foods | ${stats.foods} | ${today} |
| Wet foods | ${stats.wet} | ${today} |
| Dry foods | ${stats.dry} | ${today} |
| Foods with autoship pricing | ${stats.autoship} | ${today} |
| Learn articles (published) | ${stats.articles} | ${today} |
| Registered users | ${stats.users} | ${today} |

## Recent Pipeline Runs
| Date | Agent | Status | Summary |
|------|-------|--------|---------|
${logRows}

## Next Priorities
- Research: Expand food database coverage for underrepresented brands
- Database: Fill missing summaries and autoship pricing
- Learn: Write articles for uncovered topics
- Display: No known bugs
`;

  const statePath = path.resolve('knowledge/mealmeow-state.md');
  fs.writeFileSync(statePath, state);
  console.log(`Updated ${statePath}`);
}

// ── Write stub task queues ──────────────────────────────────────
function writeTaskQueues(stats) {
  const queueDir = path.resolve('agents');

  const agents = [
    {
      dir: 'research-agent',
      name: 'Research Agent',
      tasks: `### Task 1: Price audit for existing foods
- **Goal:** Check for price changes on top 20 most-viewed foods
- **Input:** Supabase cat_foods table, sorted by recommendation frequency
- **Output:** JSON with updated pricing to logs/research-${today}.json
- **Priority:** HIGH
- **Guardrail:** Max 20 products per run`,
    },
    {
      dir: 'database-agent',
      name: 'Database Agent',
      tasks: `### Task 1: Process research output
- **Goal:** Upsert any new research data into cat_foods
- **Input:** logs/research-*.json from today's research run
- **Output:** Updated rows in Supabase, log to logs/database-${today}.log
- **Priority:** HIGH
- **Guardrail:** Never delete rows, never overwrite non-null with null`,
    },
    {
      dir: 'learn-agent',
      name: 'Learn Agent',
      tasks: `### Task 1: Audit article coverage gaps
- **Goal:** Identify top 3 missing topics based on user search patterns
- **Input:** Current article list from Supabase learn_articles
- **Output:** Topic recommendations to logs/learn-${today}.log
- **Priority:** MEDIUM
- **Guardrail:** Do not write articles this run, only identify gaps`,
    },
    {
      dir: 'display-agent',
      name: 'Display Agent',
      tasks: `(No tasks — no known bugs)`,
    },
    {
      dir: 'meta-agent',
      name: 'Meta Agent',
      tasks: `### Task 1: Refresh state and write task queues
- **Goal:** Update mealmeow-state.md with latest DB stats, write next task queues
- **Input:** Supabase, pipeline logs
- **Output:** Updated state file and task queues
- **Priority:** HIGH
- **Guardrail:** Always refresh state before writing queues`,
    },
  ];

  for (const agent of agents) {
    const queue = `# Task Queue: ${agent.name}
> Written by: meta-agent | Date: ${today}

## This Run
${agent.tasks}

## Next Run
- [To be determined by next meta-agent run]

## Completed (Last Run)
- [First run — no previous tasks]
`;

    const queuePath = path.join(queueDir, agent.dir, 'task-queue.md');
    fs.writeFileSync(queuePath, queue);
    console.log(`Wrote task queue: ${queuePath}`);
  }
}

// ── Write Job Summary ───────────────────────────────────────────
function writeSummary(stats, logs) {
  const statusIcon = (s) => (s === 'completed' ? '✅' : s === 'error' ? '❌' : '⚠️');

  const logRows = logs.length > 0
    ? logs.map((l) => `| ${statusIcon(l.status)} ${l.agent} | ${l.status} | ${l.itemsProcessed} | ${l.duration} |`).join('\n')
    : '| ✅ meta | completed | — | — |';

  const md = `# 🐱 MealMeow Meta-Agent Report
**${today}**

## Database Stats
| Metric | Count |
|--------|-------|
| Total foods | ${stats.foods} |
| Wet / Dry | ${stats.wet} / ${stats.dry} |
| Autoship pricing | ${stats.autoship} |
| Published articles | ${stats.articles} |
| Users | ${stats.users} |

## Pipeline Results

| Agent | Status | Items | Duration |
|-------|--------|-------|----------|
${logRows}

## Task Queues Written
- ✅ research-agent/task-queue.md
- ✅ database-agent/task-queue.md
- ✅ learn-agent/task-queue.md
- ✅ display-agent/task-queue.md
- ✅ meta-agent/task-queue.md

---
*Meta-agent run complete*
`;

  if (GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(GITHUB_STEP_SUMMARY, md);
    console.log('Report written to GitHub Actions Job Summary');
  } else {
    console.log(md);
  }

  // Also save locally
  const reportPath = path.resolve('logs', `meta-${today}.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, md);
}

// ── Main ────────────────────────────────────────────────────────
console.log(`Meta-agent starting — ${today}`);

const stats = await fetchStats();
console.log(`DB stats: ${stats.foods} foods, ${stats.articles} articles, ${stats.users} users`);

const logs = collectLogs();
console.log(`Found ${logs.length} log file(s) from pipeline`);

updateState(stats, logs);
writeTaskQueues(stats);
writeSummary(stats, logs);

console.log('Meta-agent complete');
