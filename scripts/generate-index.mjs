#!/usr/bin/env node
/**
 * Generates public/data/index.json by scanning all run.json files under:
 *   public/data/runs/<suite>/<group>/<run>/run.json
 *
 * Usage:
 *   node scripts/generate-index.mjs
 *
 * Run this after adding new run.json files, or let the CI workflow do it automatically.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(__dirname, '../public/data/runs');
const OUTPUT_FILE = resolve(__dirname, '../public/data/index.json');

function isDir(p) {
    try { return statSync(p).isDirectory(); } catch { return false; }
}

function extractHplBest(data) {
    if (!data.best) return null;
    return {
        gflops:  data.best.gflops  ?? data.best.Gflops ?? null,
        N:       data.best.N       ?? data.best.n       ?? null,
        NB:      data.best.NB      ?? data.best.nb      ?? null,
        timeSec: data.best.timeSec ?? data.best.time    ?? null,
    };
}

function extractIqtreeBest(data) {
    if (!data.best) return null;
    return {
        logL:     data.best.logL    ?? null,
        BIC:      data.best.BIC     ?? null,
        model:    data.best.model   ?? null,
        numTaxa:  data.best.numTaxa ?? null,
        numSites: data.best.numSites ?? null,
        timeSec:  data.best.timeSec  ?? null,
    };
}

function extractBest(suite, data) {
    if (suite === 'IQTree') return extractIqtreeBest(data);
    return extractHplBest(data);
}

function extractOutSummary(data) {
    if (data.outSummary) return data.outSummary;
    // Try to derive from out field
    const out = data.out;
    if (out && typeof out === 'object') {
        return {
            testsTotal:   out.testsTotal   ?? null,
            testsPassed:  out.testsPassed  ?? null,
            testsFailed:  out.testsFailed  ?? null,
            testsSkipped: out.testsSkipped ?? null,
        };
    }
    return { testsTotal: null, testsPassed: null, testsFailed: null, testsSkipped: null };
}

function scanRuns() {
    const runs = [];

    for (const suite of readdirSync(RUNS_DIR).sort()) {
        const suitePath = join(RUNS_DIR, suite);
        if (!isDir(suitePath)) continue;

        for (const group of readdirSync(suitePath).sort()) {
            if (group.startsWith('_')) continue; // skip _OLD, _archive, etc.
            const groupPath = join(suitePath, group);
            if (!isDir(groupPath)) continue;

            for (const run of readdirSync(groupPath).sort()) {
                const runPath = join(groupPath, run);
                if (!isDir(runPath)) continue;

                const runJsonPath = join(runPath, 'run.json');
                if (!existsSync(runJsonPath)) continue;

                try {
                    const data = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
                    runs.push({
                        id:          `${suite}/${group}/${run}`,
                        suite,
                        group,
                        run,
                        cluster:     data.cluster     ?? null,
                        best:        extractBest(suite, data),
                        outSummary:  extractOutSummary(data),
                        hasErr:      data.hasErr ?? (data.err != null && data.err !== false),
                    });
                } catch (e) {
                    console.warn(`  [warn] Skipping ${runJsonPath}: ${e.message}`);
                }
            }
        }
    }

    return runs;
}

const runs = scanRuns();
const index = {
    generatedAt: new Date().toISOString(),
    runs,
};

writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2) + '\n');
console.log(`✓ index.json generated — ${runs.length} runs across ${[...new Set(runs.map(r => r.suite))].join(', ')}`);
