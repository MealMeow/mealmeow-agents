/**
 * Learn Agent — run.js
 * Audits existing learn articles and identifies coverage gaps.
 * Full article generation via Claude API is a future enhancement.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const today = new Date().toISOString().slice(0, 10);

const EXPECTED_CATEGORIES = [
  'fundamentals',
  'reading-labels',
  'feeding-approaches',
  'life-stages',
  'hydration',
  'myths',
];

// Topics we'd like covered (from learn-writer agent memory)
const DESIRED_TOPICS = [
  { category: 'fundamentals', topic: 'Dental health and diet' },
  { category: 'myths', topic: 'Food allergies vs food intolerances' },
  { category: 'feeding-approaches', topic: 'Treats: how to pick and budget calories' },
  { category: 'reading-labels', topic: 'Reading supplement labels' },
  { category: 'life-stages', topic: 'Weight loss: safe rate and monitoring' },
  { category: 'life-stages', topic: 'Phosphorus and kidney disease management' },
  { category: 'hydration', topic: 'Water fountains vs bowls for cats' },
  { category: 'fundamentals', topic: 'Taurine: the essential amino acid for cats' },
  { category: 'feeding-approaches', topic: 'Raw feeding pros and cons' },
  { category: 'myths', topic: 'Grain-free diets and heart disease (DCM)' },
];

const output = {
  date: today,
  status: 'completed',
  itemsProcessed: 0,
  audit: {},
  gaps: [],
  errors: [],
};

async function run() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase credentials');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch all published articles
  const { data: articles, error } = await sb
    .from('learn_articles')
    .select('slug, title, category, sort_order, is_published, created_at')
    .eq('is_published', true)
    .order('sort_order');

  if (error) throw new Error(`Failed to fetch articles: ${error.message}`);

  console.log(`Found ${articles.length} published articles`);

  // Audit by category
  const byCategory = {};
  for (const cat of EXPECTED_CATEGORIES) {
    byCategory[cat] = [];
  }
  for (const article of articles) {
    if (byCategory[article.category]) {
      byCategory[article.category].push(article.title);
    }
  }

  output.audit = {
    totalArticles: articles.length,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, titles]) => [cat, { count: titles.length, titles }])
    ),
  };

  // Identify categories with fewer than 3 articles
  const underserved = Object.entries(byCategory)
    .filter(([, titles]) => titles.length < 3)
    .map(([cat, titles]) => ({ category: cat, count: titles.length }));

  if (underserved.length > 0) {
    output.gaps.push({
      type: 'underserved_categories',
      categories: underserved,
    });
  }

  // Check desired topics against existing titles (fuzzy match)
  const existingTitles = articles.map((a) => a.title.toLowerCase());
  const missingTopics = DESIRED_TOPICS.filter((t) => {
    const topicWords = t.topic.toLowerCase().split(' ');
    return !existingTitles.some((title) =>
      topicWords.filter((w) => w.length > 3).every((w) => title.includes(w))
    );
  });

  if (missingTopics.length > 0) {
    output.gaps.push({
      type: 'missing_topics',
      topics: missingTopics,
    });
  }

  output.itemsProcessed = articles.length;

  // Print summary
  console.log('\nCategory breakdown:');
  for (const [cat, titles] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${titles.length} articles`);
  }

  console.log(`\nUnderserved categories: ${underserved.length}`);
  console.log(`Missing desired topics: ${missingTopics.length}`);
  for (const t of missingTopics) {
    console.log(`  - [${t.category}] ${t.topic}`);
  }
}

try {
  await run();
} catch (err) {
  output.status = 'error';
  output.errors.push(err.message);
  console.error('Learn agent failed:', err.message);
}

// Write output
const outputPath = path.resolve('logs', `learn-${today}.json`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nOutput saved to ${outputPath}`);
