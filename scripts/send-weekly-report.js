/**
 * send-weekly-report.js
 * Generates and sends a weekly summary of all pipeline activity.
 * Aggregates daily logs, database changes, and agent performance.
 *
 * Required env vars:
 *   REPORT_EMAIL - recipient email address
 *   SENDGRID_API_KEY - SendGrid API key
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 *
 * Usage: node scripts/send-weekly-report.js
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const REPORT_EMAIL = process.env.REPORT_EMAIL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Get date range for the past week
const now = new Date();
const weekAgo = new Date(now);
weekAgo.setDate(weekAgo.getDate() - 7);
const weekStart = weekAgo.toISOString().slice(0, 10);
const weekEnd = now.toISOString().slice(0, 10);

// Collect weekly stats from logs
function collectWeeklyLogs() {
  const logsDir = path.resolve('logs');
  const stats = {
    totalRuns: 0,
    agentStats: {},
    errors: [],
  };

  if (!fs.existsSync(logsDir)) return stats;

  const files = fs.readdirSync(logsDir);
  for (const file of files) {
    // Check if file is from this week
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const fileDate = dateMatch[1];
    if (fileDate < weekStart || fileDate > weekEnd) continue;

    const agent = file.split('-')[0];
    if (!stats.agentStats[agent]) {
      stats.agentStats[agent] = { runs: 0, successes: 0, failures: 0, totalItems: 0 };
    }

    stats.totalRuns++;
    const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');

    try {
      const data = JSON.parse(content);
      stats.agentStats[agent].runs++;
      if (data.status === 'error') {
        stats.agentStats[agent].failures++;
        stats.errors.push(`${fileDate} ${agent}: ${data.errors?.[0] || 'unknown error'}`);
      } else {
        stats.agentStats[agent].successes++;
      }
      stats.agentStats[agent].totalItems += data.itemsProcessed || 0;
    } catch {
      stats.agentStats[agent].runs++;
      if (content.includes('ERROR')) {
        stats.agentStats[agent].failures++;
      } else {
        stats.agentStats[agent].successes++;
      }
    }
  }

  return stats;
}

// Fetch database stats from Supabase
async function fetchDatabaseStats() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { foods: '—', articles: '—', users: '—', recentFoods: 0 };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [foodsRes, articlesRes, usersRes, recentFoodsRes] = await Promise.all([
    supabase.from('cat_foods').select('id', { count: 'exact', head: true }),
    supabase.from('learn_articles').select('id', { count: 'exact', head: true }).eq('is_published', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('cat_foods').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
  ]);

  return {
    foods: foodsRes.count ?? '—',
    articles: articlesRes.count ?? '—',
    users: usersRes.count ?? '—',
    recentFoods: recentFoodsRes.count ?? 0,
  };
}

// Format as markdown (saved to logs) and HTML (emailed)
function formatReport(stats, dbStats) {
  const md = `# MealMeow Weekly Report
## ${weekStart} to ${weekEnd}

### Database
- Total foods: ${dbStats.foods}
- Published articles: ${dbStats.articles}
- Registered users: ${dbStats.users}
- New foods this week: ${dbStats.recentFoods}

### Pipeline Activity
- Total agent runs: ${stats.totalRuns}
${Object.entries(stats.agentStats)
  .map(([name, s]) => `- **${name}**: ${s.runs} runs (${s.successes} ok, ${s.failures} failed) — ${s.totalItems} items`)
  .join('\n')}

### Errors
${stats.errors.length > 0 ? stats.errors.map((e) => `- ${e}`).join('\n') : 'None this week.'}
`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#ea580c">MealMeow Weekly Report</h2>
      <p style="color:#6b7280">${weekStart} to ${weekEnd}</p>

      <h3 style="margin-top:24px">Database</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee">Total foods</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${dbStats.foods}</td></tr>
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee">Published articles</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${dbStats.articles}</td></tr>
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee">Registered users</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${dbStats.users}</td></tr>
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee">New foods this week</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;color:#16a34a">${dbStats.recentFoods}</td></tr>
      </table>

      <h3 style="margin-top:24px">Pipeline Activity</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#fff7ed">
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Agent</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Runs</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Success</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Items</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(stats.agentStats)
            .map(
              ([name, s]) => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600">${name}</td>
              <td style="padding:8px;border-bottom:1px solid #eee">${s.runs}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;color:${s.failures > 0 ? '#dc2626' : '#16a34a'}">${s.successes}/${s.runs}</td>
              <td style="padding:8px;border-bottom:1px solid #eee">${s.totalItems}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>

      ${
        stats.errors.length > 0
          ? `<h3 style="margin-top:24px;color:#dc2626">Errors (${stats.errors.length})</h3>
             <ul>${stats.errors.map((e) => `<li style="color:#6b7280;font-size:14px">${e}</li>`).join('')}</ul>`
          : '<p style="color:#16a34a;margin-top:16px">No errors this week.</p>'
      }

      <p style="color:#9ca3af;font-size:12px;margin-top:32px">Sent by MealMeow Agent Pipeline</p>
    </div>
  `;

  return { md, html };
}

// Send via SendGrid
async function sendEmail(html, subject) {
  if (!SENDGRID_API_KEY || !REPORT_EMAIL) {
    console.log('No email credentials — printing report to stdout.');
    return false;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: REPORT_EMAIL }] }],
      from: { email: 'pipeline@mealmeow.com', name: 'MealMeow Pipeline' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${text}`);
  }

  console.log(`Weekly report sent to ${REPORT_EMAIL}`);
  return true;
}

// Main
console.log(`Generating weekly report for ${weekStart} to ${weekEnd}...`);

const stats = collectWeeklyLogs();
const dbStats = await fetchDatabaseStats();
const { md, html } = formatReport(stats, dbStats);

// Save markdown report
const reportPath = path.resolve('logs', `weekly-report-${weekEnd}.md`);
fs.writeFileSync(reportPath, md);
console.log(`Report saved to ${reportPath}`);

// Send email
const subject = `MealMeow Weekly Report — ${weekStart} to ${weekEnd}`;
await sendEmail(html, subject);

// Print summary
console.log(`\nTotal runs: ${stats.totalRuns}`);
console.log(`Errors: ${stats.errors.length}`);
console.log(`DB: ${dbStats.foods} foods, ${dbStats.articles} articles, ${dbStats.users} users`);
