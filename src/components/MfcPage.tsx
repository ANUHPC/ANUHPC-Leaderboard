import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Eye, Film, Medal } from 'lucide-react';
import { MfcRunDetails, type MfcRunData } from './MfcRunDetails';

// The MFC board.
//
// Ranking is per (cluster, case, hardware): a grind time on 8 A100s and one on
// 36 Haswell cores measure different machines, and the seven pinned cases are
// different physics, so a single ordering across them would be meaningless.
// Runs with a supplied case.py are unranked by construction and shown apart.
//
// The previous version put every artifact in the table as a column of eight
// stacked links, which buried the numbers. Files now live behind Details,
// which is also where HPL puts them.

const base = import.meta.env.BASE_URL;

export function MfcPage() {
    const [runs, setRuns] = useState<MfcRunData[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [hardware, setHardware] = useState('all');
    const [caseFilter, setCaseFilter] = useState('all');
    const [open, setOpen] = useState<MfcRunData | null>(null);
    const [params] = useSearchParams();
    const cluster = params.get('cluster') ?? 'all';

    useEffect(() => {
        fetch(`${base}data/index.json?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((data) => setRuns(data.runs.filter((r: { suite: string }) => r.suite === 'MFC')))
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    const hw = (r: MfcRunData) => ((r.config as Record<string, unknown>)?.gpu === 'acc' ? 'GPU' : 'CPU');
    const caseOf = (r: MfcRunData) => String((r.config as Record<string, unknown>)?.case ?? 'custom');

    const cases = useMemo(
        () => [...new Set(runs.map(caseOf).filter((c) => c !== 'custom'))].sort(),
        [runs]);

    const visible = runs.filter((r) =>
        (cluster === 'all' || r.cluster === cluster) &&
        (hardware === 'all' || hw(r) === hardware) &&
        (caseFilter === 'all' || caseOf(r) === caseFilter));

    const ranked = visible.filter((r) => r.ranking?.eligible && r.status === 'ok' && Number.isFinite(r.metric?.value));
    const others = visible.filter((r) => !ranked.includes(r));

    // One board per (cluster, case, hardware) — the only grouping in which two
    // grind times are comparable.
    const boards = new Map<string, MfcRunData[]>();
    for (const r of ranked) {
        const k = `${r.cluster} · ${caseOf(r)} · ${hw(r)}`;
        boards.set(k, [...(boards.get(k) ?? []), r]);
    }

    const medal = ['text-amber-500', 'text-slate-400', 'text-amber-700'];

    const Table = ({ items, scored }: { items: MfcRunData[]; scored: boolean }) => (
        <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                        <th className="w-20 px-5 py-3">{scored ? 'Rank' : ''}</th>
                        <th className="px-5 py-3">Run</th>
                        <th className="px-5 py-3">Grind time<div className="font-normal normal-case">ns/gp/eq/rhs</div></th>
                        <th className="px-5 py-3">Wall</th>
                        <th className="px-5 py-3">Resources</th>
                        <th className="w-28 px-5 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    {[...items]
                        .sort((a, b) => (a.metric?.value ?? Infinity) - (b.metric?.value ?? Infinity))
                        .map((r, i) => {
                            const cfg = (r.config ?? {}) as Record<string, unknown>;
                            const total = r.wallSec;
                            const hasMedia = r.hasMedia ?? Object.keys(r.raw ?? {}).some((n) => /\.(mp4|png)$/i.test(n));
                            return (
                                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                                    <td className="px-5 py-4">
                                        {scored
                                            ? <span className={`inline-flex items-center gap-1 font-semibold ${medal[i] ?? 'text-slate-400'}`}>
                                                  {i < 3 && <Medal className="h-4 w-4" />}#{i + 1}
                                              </span>
                                            : <span className="text-xs text-slate-400">—</span>}
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                                            {r.group} / {r.run}
                                            {hasMedia && <Film className="h-3.5 w-3.5 text-slate-400" aria-label="has a rendered video" />}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {r.cluster} · {caseOf(r)} · {hw(r)}
                                            {r.status !== 'ok' && <span className="ml-1 text-red-600">· {r.status}</span>}
                                        </div>
                                        {!scored && r.ranking?.reason && (
                                            <div className="text-xs text-amber-700">{r.ranking.reason}</div>)}
                                    </td>
                                    <td className="px-5 py-4 font-mono text-base text-slate-900">
                                        {r.metric?.value != null ? r.metric.value.toFixed(4) : '—'}
                                    </td>
                                    <td className="px-5 py-4 font-mono text-slate-600">{total != null ? `${total}s` : '—'}</td>
                                    <td className="px-5 py-4 text-slate-700">
                                        {String(cfg.nodes ?? '—')} node(s), {String(cfg.ranks ?? '—')} ranks
                                        <div className="text-xs text-slate-500">{hw(r)} · {String(cfg.gbpp ?? '—')} GB/rank</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <button onClick={() => setOpen(r)}
                                                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">
                                            <Eye className="h-4 w-4" /> Details
                                        </button>
                                    </td>
                                </tr>);
                        })}
                </tbody>
            </table>
        </div>);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">MFC · Multi-component Flow Code</h1>
                <p className="mt-2 text-slate-600">
                    Grind time is nanoseconds per grid point, per equation, per right-hand-side evaluation.
                    <span className="font-medium"> Lower is better</span> — the opposite of HPL.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                    Ranked per case and per hardware: 8 A100s and 36 Haswell cores are different machines, and the
                    seven pinned cases are different physics. Runs with their own case.py are unranked.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600">Hardware
                    <select className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            value={hardware} onChange={(e) => setHardware(e.target.value)}>
                        <option value="all">All</option><option>GPU</option><option>CPU</option>
                    </select>
                </label>
                <label className="text-sm text-slate-600">Case
                    <select className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}>
                        <option value="all">All cases</option>
                        {cases.map((c) => <option key={c}>{c}</option>)}
                    </select>
                </label>
                <span className="text-sm text-slate-500">
                    {visible.length} run{visible.length === 1 ? '' : 's'}
                    {ranked.length ? ` · ${ranked.length} ranked` : ''}
                </span>
            </div>

            {loading && <p className="text-slate-600">Loading MFC results…</p>}
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">Could not load results: {error}</p>}
            {!loading && !error && visible.length === 0 && (
                <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">No MFC results for this selection yet.</p>)}

            {[...boards].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => (
                <section key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">{key}</h2>
                    <Table items={items} scored />
                </section>))}

            {others.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">
                        Demos and unranked runs
                        <span className="ml-2 text-sm font-normal text-slate-500">custom cases, and runs without a verified result</span>
                    </h2>
                    <Table items={others} scored={false} />
                </section>)}

            {open && <MfcRunDetails run={open} onClose={() => setOpen(null)} />}
        </div>);
}
