/**
 * send-report.js
 * Sends a daily pipeline summary email after all agents have run.
 * Uses SendGrid for email delivery.
 *
 * Required env vars:
 *   REPORT_EMAIL - recipient email address
 *   SENDGRID_API_KEY - SendGrid API key
 *
 * Usage: node scripts/send-report.js
 */

import fs from 'fs';
import path from 'path';

const REPORT_EMAIL = process.env.REPORT_EMAIL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (!REPORT_EMAIL || !SENDGRID_API_KEY) {
  console.warn('WARN: Missing REPORT_EMAIL or SENDGRID_API_KEY — skipping email, printing to stdout.');
}

// Collect logs from today's run
function collectLogs() {
  const logsDir = path.resolve('logs');
  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    date: today,
    agents: [],
    errors: [],
  };

  if (!fs.existsSync(logsDir)) {
    summary.errors.push('No logs directory found');
    return summary;
  }

  const files = fs.readdirSync(logsDir).filter((f) => f.includes(today));

  for (const file of files) {
    const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
    const agent = file.split('-')[0]; // e.g., "research" from "research-2026-03-10.json"

    try {
      const data = JSON.parse(content);
      summary.agents.push({
        name: agent,
        status: data.status || 'completed',
        itemsProcessed: data.itemsProcessed || 0,
        errors: data.errors || [],
        duration: data.duration || 'unknown',
      });
    } catch {
      // Plain text log
      summary.agents.push({
        name: agent,
        status: content.includes('ERROR') ? 'error' : 'completed',
        log: content.slice(0, 500),
      });
    }
  }

  return summary;
}

// Format as HTML email
function formatEmail(summary) {
  const agentRows = summary.agents
    .map(
      (a) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600">${a.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">
        <span style="color:${a.status === 'completed' ? '#16a34a' : '#dc2626'}">${a.status}</span>
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee">${a.itemsProcessed ?? '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${a.duration ?? '—'}</td>
    </tr>`
    )
    .join('');

  return `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#ea580c">MealMeow Daily Pipeline Report</h2>
      <p style="color:#6b7280">${summary.date}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#fff7ed">
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Agent</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Status</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Items</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid #fed7aa">Duration</th>
          </tr>
        </thead>
        <tbody>${agentRows}</tbody>
      </table>
      ${summary.errors.length > 0 ? `<p style="color:#dc2626">Errors: ${summary.errors.join(', ')}</p>` : ''}
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent by MealMeow Agent Pipeline</p>
    </div>
  `;
}

// Send via SendGrid
async function sendEmail(html, subject) {
  if (!SENDGRID_API_KEY || !REPORT_EMAIL) {
    console.log('--- Email Preview ---');
    console.log(`Subject: ${subject}`);
    console.log(html.replace(/<[^>]+>/g, ''));
    return;
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

  console.log(`Report sent to ${REPORT_EMAIL}`);
}

// Main
const summary = collectLogs();
const html = formatEmail(summary);
const subject = `MealMeow Pipeline Report — ${summary.date}`;

await sendEmail(html, subject);

// Also save to logs
const reportPath = path.resolve('logs', `report-${summary.date}.html`);
fs.writeFileSync(reportPath, html);
console.log(`Report saved to ${reportPath}`);
