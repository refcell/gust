// Prints a Markdown summary of Lighthouse JSON reports: category scores, CLS and shift culprits.
// Usage: node scripts/lh-summary.mjs report1.json [report2.json ...]
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`#### ${r.finalDisplayedUrl ?? r.requestedUrl}\n`);
  console.log('| Category | Score |\n|---|---|');
  for (const c of Object.values(r.categories)) console.log(`| ${c.title} | ${Math.round(c.score * 100)} |`);
  const cls = r.audits['cumulative-layout-shift'];
  console.log(`\nCLS: ${cls?.displayValue ?? 'n/a'}`);
  for (const item of r.audits['layout-shifts']?.details?.items ?? []) {
    console.log(`- ${item.score?.toFixed(3)} \`${item.node?.selector ?? '?'}\` ${(item.node?.nodeLabel ?? '').split('\n')[0]}`);
  }
  console.log('');
}
