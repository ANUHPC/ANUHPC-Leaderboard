import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Clock, Eye, Film, Medal, User } from 'lucide-react';
import { MfcRunDetails, type MfcRunData } from './MfcRunDetails';

// The MFC board.
//
// Two ways to read the same runs, as tabs:
//
//   Recent      everything, newest first. The landing view, because the
//               question people arrive with is "what has been run lately",
//               and a leaderboard whose boards mostly hold one entry each
//               answers that badly.
//   per case    the ranked board for one case, split by hardware.
//
// Ranking is per (cluster, case, hardware): a grind time on 8 A100s and one on
// 36 Haswell cores measure different machines, and the pinned cases are
// different physics, so a single ordering across them would be meaningless.
// Runs with a supplied case.py are unranked by construction.

const base = import.meta.env.BASE_URL;

const hw = (r: MfcRunData) => ((r.config as Record<string, unknown>)?.gpu === 'acc' ? 'GPU' : 'CPU');
const caseOf = (r: MfcRunData) => String((r.config as Record<string, unknown>)?.case ?? 'custom');
const isRanked = (r: MfcRunData) =>
    Boolean(r.ranking?.eligible) && r.status === 'ok' && Number.isFinite(r.metric?.value);

// "3 days ago" reads faster than a timestamp when scanning a list, but the
// exact time has to stay reachable -- it is the audit trail for a result.
function ago(iso?: string | null) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const exact = (iso?: string | null) =>
    iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString() : 'date unknown';

// Who entered the run. The folder under input/ is the identity the leaderboard
// is organised by; "house" marks the seeded reference entries, which belong to
// nobody and should not wear a person's name.
function Who({ r }: { r: MfcRunData }) {
    const s = r.submitter;
    if (!s?.name) return <span className="text-slate-400">—</span>;
    if (s.house) {
        return (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium">{s.name}</span>
                <span className="text-xs">reference</span>
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800" title={s.by ? `pushed by ${s.by}` : undefined}>
            <User className="h-3.5 w-3.5 text-slate-400" />{s.name}
        </span>
    );
}

export function MfcPage() {
    const [runs, setRuns] = useState<MfcRunData[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [hardware, setHardware] = useState('all');
    const [tab, setTab] = useState('recent');
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

    const scoped = useMemo(
        () => runs.filter((r) => (cluster === 'all' || r.cluster === cluster) && (hardware === 'all' || hw(r) === hardware)),
        [runs, cluster, hardware]);

    // Tabs are built from the runs, not from a hardcoded list, so a case
    // contributed through suites/MFC/cases/ appears here the moment it has a
    // result without this file needing to know it exists.
    const cases = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of runs.filter((x) => isRanked(x))) counts.set(caseOf(r), (counts.get(caseOf(r)) ?? 0) + 1);
        return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
    }, [runs]);

    const unrankedCount = runs.filter((r) => !isRanked(r)).length;
    const tabs = [
        { id: 'recent', label: 'Recent', count: runs.length },
        ...cases.map(([c, n]) => ({ id: `case:${c}`, label: c, count: n })),
        ...(unrankedCount ? [{ id: 'other', label: 'Demos & unranked', count: unrankedCount }] : []),
    ];
    // A case tab can vanish when the hardware filter excludes its only runs.
    const active = tabs.some((t) => t.id === tab) ? tab : 'recent';

    const Row = ({ r, rank }: { r: MfcRunData; rank?: number }) => {
        const cfg = (r.config ?? {}) as Record<string, unknown>;
        const medal = ['text-amber-500', 'text-slate-400', 'text-amber-700'];
        const hasMedia = r.hasMedia ?? Object.keys(r.raw ?? {}).some((n) => /\.(mp4|png)$/i.test(n));
        return (
            <tr className="border-t border-slate-100 hover:bg-slate-50/70">
                {rank !== undefined && (
                    <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 font-semibold ${medal[rank] ?? 'text-slate-400'}`}>
                            {rank < 3 && <Medal className="h-4 w-4" />}#{rank + 1}
                        </span>
                    </td>
                )}
                <td className="px-5 py-4">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                        {r.run}
                        {hasMedia && <Film className="h-3.5 w-3.5 text-slate-400" aria-label="has a rendered video" />}
                    </div>
                    <div className="text-xs text-slate-500">
                        {r.cluster} · {caseOf(r)} · {hw(r)}
                        {r.status !== 'ok' && <span className="ml-1 text-red-600">· {r.status}</span>}
                    </div>
                    {!isRanked(r) && r.ranking?.reason && (
                        <div className="text-xs text-amber-700">{r.ranking.reason}</div>)}
                </td>
                <td className="px-5 py-4"><Who r={r} /></td>
                <td className="px-5 py-4 font-mono text-base text-slate-900">
                    {r.metric?.value != null ? r.metric.value.toFixed(4) : '—'}
                </td>
                <td className="px-5 py-4 font-mono text-slate-600">{r.wallSec != null ? `${r.wallSec}s` : '—'}</td>
                <td className="px-5 py-4 text-slate-700">
                    {String(cfg.nodes ?? '—')} node(s), {String(cfg.ranks ?? '—')} ranks
                    <div className="text-xs text-slate-500">{hw(r)} · {String(cfg.gbpp ?? '—')} GB/rank</div>
                </td>
                <td className="px-5 py-4 whitespace-nowrap text-slate-600" title={`${exact(r.date)}${r.dateSource === 'git' ? ' (from the commit that published the results)' : ''}`}>
                    {ago(r.date)}
                </td>
                <td className="px-5 py-4">
                    <button onClick={() => setOpen(r)}
                            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">
                        <Eye className="h-4 w-4" /> Details
                    </button>
                </td>
            </tr>);
    };

    const Table = ({ items, scored }: { items: MfcRunData[]; scored: boolean }) => (
        <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                        {scored && <th className="w-20 px-5 py-3">Rank</th>}
                        <th className="px-5 py-3">Run</th>
                        <th className="px-5 py-3">User</th>
                        <th className="px-5 py-3">Grind time<div className="font-normal normal-case">ns/gp/eq/rhs</div></th>
                        <th className="px-5 py-3">Wall</th>
                        <th className="px-5 py-3">Resources</th>
                        <th className="px-5 py-3">When</th>
                        <th className="w-28 px-5 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((r, i) => <Row key={r.id} r={r} rank={scored ? i : undefined} />)}
                </tbody>
            </table>
        </div>);

    const Panel = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">
                {title}{hint && <span className="ml-2 text-sm font-normal text-slate-500">{hint}</span>}
            </h2>
            {children}
        </section>);

    // --- what the active tab shows ---
    let body: React.ReactNode = null;
    if (active === 'recent') {
        // Results are committed in batches, so runs published together share a
        // timestamp exactly -- 8 of the first 10 MFC runs do. Date alone would
        // leave their order down to whatever the index happened to list first,
        // which changes between builds. Case then run name breaks the tie, so
        // the list is stable and reads sensibly.
        const recent = [...scoped].sort((a, b) =>
            String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
            caseOf(a).localeCompare(caseOf(b)) ||
            a.run.localeCompare(b.run));
        body = recent.length ? (
            <Panel title="All runs, newest first"
                   hint={`${recent.length} run${recent.length === 1 ? '' : 's'} · ranked and unranked together`}>
                <Table items={recent} scored={false} />
            </Panel>
        ) : null;
    } else if (active === 'other') {
        const others = scoped.filter((r) => !isRanked(r));
        body = others.length ? (
            <Panel title="Demos and unranked runs" hint="custom cases, and runs without a verified result">
                <Table items={others} scored={false} />
            </Panel>
        ) : null;
    } else {
        const slug = active.slice(5);
        const mine = scoped.filter((r) => isRanked(r) && caseOf(r) === slug);
        // One board per hardware: a grind time on A100s and one on Haswell
        // cores are not comparable, so they must not share an ordering.
        const boards = new Map<string, MfcRunData[]>();
        for (const r of mine) boards.set(hw(r), [...(boards.get(hw(r)) ?? []), r]);
        body = boards.size ? [...boards].sort(([a], [b]) => a.localeCompare(b)).map(([k, items]) => (
            <Panel key={k} title={`${slug} · ${k}`} hint={`${items.length} ranked entr${items.length === 1 ? 'y' : 'ies'}`}>
                <Table items={[...items].sort((a, b) => (a.metric?.value ?? Infinity) - (b.metric?.value ?? Infinity))} scored />
            </Panel>
        )) : null;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">MFC · Multi-component Flow Code</h1>
                <p className="mt-2 text-slate-600">
                    Grind time is nanoseconds per grid point, per equation, per right-hand-side evaluation.
                    <span className="font-medium"> Lower is better</span> — the opposite of HPL.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                    Ranked per case and per hardware: 8 A100s and 36 Haswell cores are different machines, and each
                    case is different physics. Runs with their own case.py are unranked.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
                {tabs.map((t) => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                            aria-current={active === t.id ? 'page' : undefined}
                            className={`-mb-px flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                                active === t.id
                                    ? 'border-blue-600 text-blue-700'
                                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>
                        {t.id === 'recent' && <Clock className="h-4 w-4" />}
                        {t.label}
                        <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                            active === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600">Hardware
                    <select className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                            value={hardware} onChange={(e) => setHardware(e.target.value)}>
                        <option value="all">All</option><option>GPU</option><option>CPU</option>
                    </select>
                </label>
                <span className="text-sm text-slate-500">
                    {scoped.length} run{scoped.length === 1 ? '' : 's'} in view
                </span>
            </div>

            {loading && <p className="text-slate-600">Loading MFC results…</p>}
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">Could not load results: {error}</p>}
            {!loading && !error && !body && (
                <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">No MFC results for this selection yet.</p>)}
            {body}

            {open && <MfcRunDetails run={open} onClose={() => setOpen(null)} />}
        </div>);
}
