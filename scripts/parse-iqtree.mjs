#!/usr/bin/env node
/**
 * Parses IQ-TREE output files from a completed run and writes run.json.
 *
 * Usage:
 *   node scripts/parse-iqtree.mjs <GROUP> <RUN_NAME> [CLUSTER]
 *
 * Expects these files in public/data/runs/IQTree/<GROUP>/<RUN_NAME>/:
 *   iqtree_out.log    — captured stdout/stderr
 *   iqtree_out.iqtree — main IQ-TREE report (optional but recommended)
 *   alignment.fasta   — input alignment
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [,, group, runName, cluster = 'Xenon'] = process.argv;
if (!group || !runName) {
    console.error('Usage: node scripts/parse-iqtree.mjs <GROUP> <RUN_NAME> [CLUSTER]');
    process.exit(1);
}

const runDir = resolve(__dirname, `../public/data/runs/IQTree/${group}/${runName}`);
const logPath = resolve(runDir, 'iqtree.log');
const reportPath = resolve(runDir, 'iqtree_out.iqtree');

if (!existsSync(logPath)) {
    console.error(`Log file not found: ${logPath}`);
    process.exit(1);
}

const log = readFileSync(logPath, 'utf-8');
const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';

// --- Parse key metrics ---
const logL = (() => {
    const m = log.match(/Best LogL:\s*([-\d.]+)/i) || report.match(/Log-likelihood of the tree:\s*([-\d.]+)/i);
    return m ? parseFloat(m[1]) : null;
})();

const BIC = (() => {
    const m = log.match(/BIC score:\s*([-\d.]+)/i) || report.match(/BIC score:\s*([-\d.]+)/i);
    return m ? parseFloat(m[1]) : null;
})();

const model = (() => {
    const m = log.match(/Best-fit model:\s*(\S+)/i) || report.match(/Model of substitution:\s*(\S+)/i);
    return m ? m[1] : null;
})();

const numTaxa = (() => {
    const m = log.match(/(\d+)\s+sequences/i) || report.match(/Number of sequences:\s*(\d+)/i);
    return m ? parseInt(m[1]) : null;
})();

const numSites = (() => {
    const m = log.match(/(\d+)\s+(?:columns|sites|positions)/i) || report.match(/Alignment length:\s*(\d+)/i);
    return m ? parseInt(m[1]) : null;
})();

const timeSec = (() => {
    const m = log.match(/Total wall-clock time:\s*([\d.]+)\s*sec/i)
        || log.match(/Total CPU time:\s*([\d.]+)\s*sec/i)
        || log.match(/Time used:\s*([\d:.]+)/i);
    if (!m) return null;
    // Handle hh:mm:ss format
    if (m[1].includes(':')) {
        const parts = m[1].split(':').map(Number);
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return parseFloat(m[1]);
})();

const hasErr = log.includes('ERROR') || log.includes('Segmentation fault');

const runJson = {
    id: `IQTree/${group}/${runName}`,
    suite: 'IQTree',
    group,
    run: runName,
    cluster,
    best: logL !== null ? { logL, BIC, model, numTaxa, numSites, timeSec } : null,
    outSummary: {
        testsTotal: 1,
        testsPassed: logL !== null ? 1 : 0,
        testsFailed: logL !== null ? 0 : 1,
        testsSkipped: 0,
    },
    hasErr,
};

const outPath = resolve(runDir, 'run.json');
writeFileSync(outPath, JSON.stringify(runJson, null, 2) + '\n');
console.log(`✓ Written ${outPath}`);
console.log(`  logL=${logL}  BIC=${BIC}  model=${model}  taxa=${numTaxa}  sites=${numSites}  time=${timeSec}s`);
console.log('');
console.log('Now regenerate the index:');
console.log('  node scripts/generate-index.mjs');
