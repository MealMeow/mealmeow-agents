/**
 * Research Agent — run.js
 * Queries Supabase for foods needing price updates or missing data,
 * then outputs a task manifest. Actual web scraping requires Claude
 * API integration (future enhancement).
 *
 * For now: identifies stale/incomplete records and logs them.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const today = new Date().toISOString().slice(0, 10);
const output = {
  date: today,
  status: 'completed',
  itemsProcessed: 0,
  tasks: [],
  errors: [],
};

async function run() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    output.status = 'error';
    output.errors.push('Missing Supabase credentials');
    return;
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find foods missing key data
  console.log('Scanning for incomplete records...');

  // Foods without summaries
  const { data: noSummary, count: noSummaryCount } = await sb
    .from('cat_foods')
    .select('id, brand, product_name, purchase_url', { count: 'exact' })
    .is('summary', null)
    .limit(20);

  if (noSummaryCount > 0) {
    output.tasks.push({
      type: 'enrich_summaries',
      count: noSummaryCount,
      sample: (noSummary || []).slice(0, 5).map((f) => `${f.brand} - ${f.product_name}`),
    });
  }

  // Foods without autoship pricing
  const { count: noAutoshipCount } = await sb
    .from('cat_foods')
    .select('id', { count: 'exact', head: true })
    .is('price_autoship', null);

  if (noAutoshipCount > 0) {
    output.tasks.push({
      type: 'update_autoship_pricing',
      count: noAutoshipCount,
    });
  }

  // Foods without images
  const { count: noImageCount } = await sb
    .from('cat_foods')
    .select('id', { count: 'exact', head: true })
    .is('image_url', null);

  if (noImageCount > 0) {
    output.tasks.push({
      type: 'find_images',
      count: noImageCount,
    });
  }

  // Foods without calorie data
  const { count: noKcalCount } = await sb
    .from('cat_foods')
    .select('id', { count: 'exact', head: true })
    .is('kcal_per_cup', null)
    .is('kcal_per_can', null);

  if (noKcalCount > 0) {
    output.tasks.push({
      type: 'find_calorie_data',
      count: noKcalCount,
    });
  }

  output.itemsProcessed = output.tasks.length;

  console.log(`Found ${output.tasks.length} data gap categories:`);
  for (const task of output.tasks) {
    console.log(`  - ${task.type}: ${task.count} foods`);
  }
}

try {
  await run();
} catch (err) {
  output.status = 'error';
  output.errors.push(err.message);
  console.error('Research agent failed:', err.message);
}

// Write output
const outputPath = path.resolve('logs', `research-${today}.json`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Output saved to ${outputPath}`);
