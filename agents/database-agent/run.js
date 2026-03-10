/**
 * Database Agent — run.js
 * Reads research output JSON from logs/ and upserts into Supabase cat_foods.
 * Follows strict validation and merge rules from CLAUDE.md.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const today = new Date().toISOString().slice(0, 10);
const REQUIRED_FIELDS = ['product_name', 'brand', 'food_type', 'protein_pct', 'fat_pct', 'purchase_url'];
const VALID_FOOD_TYPES = ['wet', 'dry', 'raw', 'freeze-dried', 'topper'];
const VALID_LIFE_STAGES = ['kitten', 'adult', 'senior', 'all_stages'];
const ALWAYS_OVERWRITE = ['price_per_unit', 'price_autoship', 'price_first_autoship', 'summary'];

const stats = { total: 0, inserted: 0, updated: 0, skipped: 0 };
const logs = [];
const skipped = [];

function log(msg) {
  logs.push(msg);
  console.log(msg);
}

function skip(entry, reason) {
  const name = entry?.product_name || 'UNKNOWN';
  const brand = entry?.brand || 'UNKNOWN';
  const url = entry?.purchase_url || 'N/A';
  const msg = `[SKIPPED] ${name} | ${brand} | Reason: ${reason} | URL: ${url}`;
  skipped.push(msg);
  console.warn(msg);
  stats.skipped++;
}

// Find research output files from today
function findInputFiles() {
  const logsDir = path.resolve('logs');
  if (!fs.existsSync(logsDir)) return [];

  const files = [];

  // Check top-level and artifact subdirectories
  const entries = fs.readdirSync(logsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subFiles = fs.readdirSync(path.join(logsDir, entry.name));
      for (const f of subFiles) {
        if (f.startsWith('research-') && f.endsWith('.json')) {
          files.push(path.join(logsDir, entry.name, f));
        }
      }
    } else if (entry.name.startsWith('research-') && entry.name.endsWith('.json')) {
      files.push(path.join(logsDir, entry.name));
    }
  }

  return files;
}

// Validate a single entry
function validate(entry) {
  for (const field of REQUIRED_FIELDS) {
    if (!entry[field] && entry[field] !== 0) {
      skip(entry, `Missing required field: ${field}`);
      return false;
    }
  }

  if (!VALID_FOOD_TYPES.includes(entry.food_type)) {
    skip(entry, `Invalid food_type: ${entry.food_type}`);
    return false;
  }

  if (entry.life_stage && !VALID_LIFE_STAGES.includes(entry.life_stage)) {
    skip(entry, `Invalid life_stage: ${entry.life_stage}`);
    return false;
  }

  return true;
}

// Merge benefits arrays (union, dedup, existing first)
function mergeBenefits(existing, incoming) {
  if (!incoming || !Array.isArray(incoming)) return existing;
  if (!existing || !Array.isArray(existing)) return incoming;
  const merged = [...existing];
  for (const b of incoming) {
    if (!merged.includes(b)) merged.push(b);
  }
  return merged;
}

async function processEntries(sb, entries) {
  for (const entry of entries) {
    stats.total++;

    if (!validate(entry)) continue;

    // Check for existing record
    const { data: existing } = await sb
      .from('cat_foods')
      .select('*')
      .ilike('product_name', entry.product_name)
      .ilike('brand', entry.brand)
      .limit(1)
      .single();

    if (!existing) {
      // INSERT
      const { id, created_at, ...insertData } = entry;
      const { error } = await sb.from('cat_foods').insert(insertData);

      if (error) {
        skip(entry, `Insert failed: ${error.message}`);
        continue;
      }

      log(`[INSERTED] ${entry.product_name} | ${entry.brand}`);
      stats.inserted++;
    } else {
      // UPDATE — apply merge rules
      const updates = {};
      const changedFields = [];

      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id' || key === 'created_at') continue;

        if (key === 'special_benefits') {
          const merged = mergeBenefits(existing.special_benefits, value);
          if (JSON.stringify(merged) !== JSON.stringify(existing.special_benefits)) {
            updates.special_benefits = merged;
            changedFields.push('special_benefits');
          }
          continue;
        }

        if (ALWAYS_OVERWRITE.includes(key)) {
          if (value !== existing[key]) {
            updates[key] = value;
            changedFields.push(key);
          }
          continue;
        }

        // Conditional: only update if incoming is non-null and different
        if (value != null && value !== existing[key]) {
          updates[key] = value;
          changedFields.push(key);
        }
      }

      if (changedFields.length === 0) continue;

      const { error } = await sb
        .from('cat_foods')
        .update(updates)
        .eq('id', existing.id);

      if (error) {
        skip(entry, `Update failed: ${error.message}`);
        continue;
      }

      log(`[UPDATED] ${entry.product_name} | ${entry.brand} | Fields changed: ${changedFields.join(', ')}`);
      stats.updated++;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────
console.log(`Database agent starting — ${today}`);

const output = {
  date: today,
  status: 'completed',
  itemsProcessed: 0,
  errors: [],
};

try {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase credentials');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const inputFiles = findInputFiles();

  if (inputFiles.length === 0) {
    console.log('No research output files found — nothing to process');
    output.itemsProcessed = 0;
  } else {
    for (const file of inputFiles) {
      console.log(`Processing: ${file}`);
      const raw = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(raw);

      // Research output may have a .products array or be the array itself
      const entries = Array.isArray(data) ? data : (data.products || []);

      if (entries.length > 0) {
        await processEntries(sb, entries);
      } else {
        console.log(`  No product entries in ${path.basename(file)}`);
      }
    }

    output.itemsProcessed = stats.total;
  }
} catch (err) {
  output.status = 'error';
  output.errors.push(err.message);
  console.error('Database agent failed:', err.message);
}

// Write logs
const logsDir = path.resolve('logs');
fs.mkdirSync(logsDir, { recursive: true });

if (logs.length > 0) {
  fs.writeFileSync(path.join(logsDir, `database-${today}.log`), logs.join('\n'));
}
if (skipped.length > 0) {
  fs.writeFileSync(path.join(logsDir, `database-skipped-${today}.log`), skipped.join('\n'));
}

fs.writeFileSync(path.join(logsDir, `database-${today}.json`), JSON.stringify(output, null, 2));

console.log(`\nProcessing complete:`);
console.log(`  Total: ${stats.total}`);
console.log(`  Inserted: ${stats.inserted}`);
console.log(`  Updated: ${stats.updated}`);
console.log(`  Skipped: ${stats.skipped}`);
