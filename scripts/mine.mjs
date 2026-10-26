#!/usr/bin/env node
/**
 * Print the publisher's own numbers for one or more npm packages.
 *
 * This is the CLI twin of the `radar_mine` tool, and the fastest way to check that
 * the npm side of the plugin works on this network:
 *
 *   node scripts/mine.mjs dsh-wsl-tool dsh-plugin-health
 */
import { npmFacts } from '../lib/npm.mjs';

const packages = process.argv.slice(2);
if (packages.length === 0) {
  console.error('usage: node scripts/mine.mjs <npm-package> [more...]');
  process.exit(2);
}

const rows = await npmFacts(packages);
for (const row of rows) {
  if (row.missing) {
    console.log(`${row.package}\tNOT PUBLISHED`);
    continue;
  }
  if (row.error) {
    console.log(`${row.package}\tERROR\t${row.error}`);
    continue;
  }
  console.log(`${row.package}\tv${row.version ?? '?'}\t${row.downloads ?? '?'} downloads (${row.period ?? 'unknown period'})`);
}
