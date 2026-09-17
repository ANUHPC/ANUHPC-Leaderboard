#!/usr/bin/env node
/**
 * Generates public/data/index.json by scanning all run.json files under:
 *   public/data/runs/<cluster>/<suite>/<group>/<run>/run.json
 *
 * The cluster level was added when the leaderboard started serving both Raijin
 * and Xenon. Results are NOT comparable across clusters, so the cluster is part
 * of the path and part of every run id.
 *
 * This script only rebuilds the `runs` array. The `clusters` and `suites`
 * blocks are written by scripts/collect.mjs on the main branch and carried
 * through unchanged — they hold suite metric labels, units and directions that
 * cannot be reconstructed from run.json alone. Overwriting them is what made
 * the board render empty.
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

function extractBest(_suite, data) {
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
    if (!isDir(RUNS_DIR)) {
        console.warn(`  [warn] ${RUNS_DIR} does not exist`);
        return runs;
    }

    for (const cluster of readdirSync(RUNS_DIR).sort()) {
        const clusterPath = join(RUNS_DIR, cluster);
        if (!isDir(clusterPath) || cluster.startsWith('_')) continue;

        for (const suite of readdirSync(clusterPath).sort()) {
            const suitePath = join(clusterPath, suite);
            if (!isDir(suitePath)) continue;

            for (const group of readdirSync(suitePath).sort()) {
                if (group.startsWith('_')) continue; // _OLD, _archive, etc.
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
                            // Cluster leads the id: two clusters can hold a run
                            // with the same suite/group/run name.
                            id:          `${cluster}/${suite}/${group}/${run}`,
                            suite,
                            group,
                            run,
                            cluster:     data.cluster ?? cluster,
                            metric:      data.metric ?? null,
                            secondary:   data.secondary ?? [],
                            config:      data.config ?? {},
                            status:      data.status ?? null,
                            ranking:     data.ranking,
                            raw:         data.raw ?? {},
                            rank:        data.rank ?? null,
                            best:        extractBest(suite, data),
                            outSummary:  extractOutSummary(data),
                            hasErr:      data.hasErr ?? (data.err != null && data.err !== false),
                            // Small summaries so a board can show wall time and
                            // flag a rendered video without pulling every run's
                            // full record. The detail itself stays in run.json,
                            // fetched only when a row is opened.
                            wallSec:     data.detail?.out?.parsed?.totalTimeSec ?? null,
                            hasMedia:    Object.keys(data.raw ?? {}).some((n) => /\.(mp4|png)$/i.test(n)),
                            // When it ran and who sent it. Written by the
                            // collector on main: a run's own timestamp where it
                            // records one, otherwise the git commit that added
                            // its results. dateSource says which, so a date
                            // that looks wrong can be traced rather than
                            // guessed at.
                            date:        data.date ?? null,
                            dateSource:  data.dateSource ?? null,
                            submittedAt: data.submittedAt ?? null,
                            submitter:   data.submitter ?? null,
                        });
                    } catch (e) {
                        console.warn(`  [warn] Skipping ${runJsonPath}: ${e.message}`);
                    }
                }
            }
        }
    }

    return runs;
}

// Rank within each (cluster, suite): HPL wants the largest number and MFC the
// smallest, and the two clusters measure different hardware.
function applyRanks(runs, suites) {
    const dirOf = {};
    for (const s of suites || []) if (s.name) dirOf[s.name] = s.metric?.direction ?? 'higher';

    const groups = new Map();
    for (const r of runs) {
        const k = `${r.cluster}\u0000${r.suite}\u0000${r.ranking?.group ?? ''}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    for (const [k, list] of groups) {
        const suite = k.split('\u0000')[1];
        const dir = dirOf[suite] ?? 'higher';
        const scored = list.filter((r) => Number.isFinite(r.metric?.value) && r.ranking?.eligible !== false);
        scored.sort((a, b) =>
            dir === 'lower' ? a.metric.value - b.metric.value : b.metric.value - a.metric.value
        );
        scored.forEach((r, i) => { r.rank = i + 1; });
    }
}

// Carry forward the metadata collect.mjs wrote; it cannot be derived here.
let previous = {};
if (existsSync(OUTPUT_FILE)) {
    try { previous = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8')); }
    catch (e) { console.warn(`  [warn] existing index.json unreadable: ${e.message}`); }
}

const runs = scanRuns();
applyRanks(runs, previous.suites);

const index = {
    generatedAt: new Date().toISOString(),
    clusters: previous.clusters ?? [],
    suites: previous.suites ?? [],
    runs,
};

// Keep the per-cluster counts honest even if collect.mjs ran against a
// different tree than the one that got synced here.
index.clusters = index.clusters.map((c) => ({ ...c, count: runs.filter((r) => r.cluster === c.name).length }));
index.suites = index.suites.map((s) => ({ ...s, count: runs.filter((r) => r.suite === s.name).length }));

writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2) + '\n');
const byCluster = index.clusters.map((c) => `${c.name}:${c.count}`).join(' ') || '(no cluster metadata)';
console.log(`✓ index.json — ${runs.length} runs across ${[...new Set(runs.map(r => r.suite))].join(', ') || 'nothing'} | ${byCluster}`);
if (runs.length === 0) {
    console.warn('  [warn] no runs found — check that public/data/runs/<cluster>/<suite>/... exists');
}
