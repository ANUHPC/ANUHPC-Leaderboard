import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Clock, Eye, Film, Medal, Search, Trophy, X } from 'lucide-react';
import { MfcRunDetails, type MfcRunData } from './MfcRunDetails';

// The MFC board.
//
// This replaces a tab strip that carried one tab per case. With eight cases it
// wrapped onto two rows, most tabs held a single row of data, and the tab
// labels (viscous_weno5_sgb_acoustic) were wider than the numbers they led to
// -- so the navigation cost more space and more reading than the content. It
// also got worse with every case added, which is the wrong direction for a
// board meant to grow by contribution.
//
// Tabs suit a small fixed set of mutually exclusive VIEWS. There are two of
// those here:
//
//   Recent       every run, newest first. The landing view: the question
//                people arrive with is "what has been run lately".
//   Leaderboards the ranked boards, one per case and hardware, which is the
//                question you arrive with second.
//
// Case is a data dimension with unbounded cardinality, so it belongs in a
// filter, not in navigation. Search covers the rest: with 11 runs today and
// no ceiling, typing "ayush gpu" beats hunting through controls.

const base = import.meta.env.BASE_URL;

const hw = (r: MfcRunData) => ((r.config as Record<string, unknown>)?.gpu === 'acc' ? 'GPU' : 'CPU');
const caseOf = (r: MfcRunData) => String((r.config as Record<string, unknown>)?.case ?? 'custom');
const isRanked = (r: MfcRunData) =>
    Boolean(r.ranking?.eligible) && r.status === 'ok' && Number.isFinite(r.metric?.value);

// Everything a row shows, flattened once so typing matches what you can see.
const haystack = (r: MfcRunData) => [
    r.run, r.group, r.cluster, caseOf(r), hw(r),
    r.submitter?.name, r.submitter?.by,
    (r.config as Record<string, unknown>)?.toolchain,
    isRanked(r) ? 'ranked' : 'unranked demo custom',
].filter(Boolean).join(' ').toLowerCase();

// Every word must match something. "ayush gpu" means both, not either --
// with one field per row, OR semantics return almost everything.
function matches(r: MfcRunData, q: string) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = haystack(r);
    return terms.every((t) => hay.includes(t));
}

// "3d ago" reads faster than a timestamp when scanning; the exact time stays
// in the title attribute, because it is the audit trail for a result.
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

export function MfcPage() {
    const [runs, setRuns] = useState<MfcRunData[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'recent' | 'boards'>('recent');
    const [q, setQ] = useState('');
    const [hardware, setHardware] = useState('all');
    const [caseFilter, setCaseFilter] = useState('all');
    const [open, setOpen] = useState<MfcRunData | null>(null);
    const [params] = useSearchParams();
    const cluster = params.get('cluster') ?? 'all';
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch(`${base}data/index.json?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((data) => setRuns(data.runs.filter((r: { suite: string }) => r.suite === 'MFC')))
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    // "/" to search and Escape to clear are the conventions people already
    // carry from GitHub, Slack and Gmail, so they cost nothing to learn.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
            if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
            if (e.key === 'Escape' && typing && el === searchRef.current) { setQ(''); searchRef.current?.blur(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const cases = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of runs) counts.set(caseOf(r), (counts.get(caseOf(r)) ?? 0) + 1);
        return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
    }, [runs]);

    const shown = useMemo(() => runs.filter((r) =>
        (cluster === 'all' || r.cluster === cluster) &&
        (hardware === 'all' || hw(r) === hardware) &&
        (caseFilter === 'all' || caseOf(r) === caseFilter) &&
        matches(r, q)), [runs, cluster, hardware, caseFilter, q]);

    const filtered = q !== '' || hardware !== 'all' || caseFilter !== 'all';
    const clear = () => { setQ(''); setHardware('all'); setCaseFilter('all'); };

    const Row = ({ r, rank }: { r: MfcRunData; rank?: number }) => {
        const cfg = (r.config ?? {}) as Record<string, unknown>;
        const medal = ['text-amber-500', 'text-slate-400', 'text-amber-700'];
        const hasMedia = r.hasMedia ?? Object.keys(r.raw ?? {}).some((n) => /\.(mp4|png)$/i.test(n));
        const who = r.submitter;
        return (
            <tr className="border-t border-slate-100 hover:bg-slate-50/70">
                {rank !== undefined && (
                    <td className="py-3 pl-5 pr-2">
                        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${medal[rank] ?? 'text-slate-400'}`}>
                            {rank < 3 && <Medal className="h-4 w-4" />}#{rank + 1}
                        </span>
                    </td>
                )}
                <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                        {r.run}
                        {hasMedia && <Film className="h-3.5 w-3.5 text-slate-400" aria-label="has a rendered video" />}
                    </div>
                    <div className="text-xs text-slate-500">
                        {caseOf(r)} · {hw(r)} · {r.cluster}
                        {r.status !== 'ok' && <span className="ml-1 text-red-600">· {r.status}</span>}
                    </div>
                </td>
                <td className="px-4 py-3">
                    {who?.name
                        ? <span className={who.house ? 'text-slate-500' : 'font-medium text-slate-800'}
                                title={who.by ? `pushed by ${who.by}` : undefined}>
                              {who.name}{who.house && <span className="ml-1 text-xs text-slate-400">· reference</span>}
                          </span>
                        : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-900">
                    {r.metric?.value != null ? r.metric.value.toFixed(4) : '—'}
                    {!isRanked(r) && <div className="text-xs font-sans font-normal text-amber-700">unranked</div>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-slate-600">{r.wallSec != null ? `${r.wallSec}s` : '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                    {String(cfg.nodes ?? '—')}&nbsp;node · {String(cfg.ranks ?? '—')}&nbsp;ranks
                    <div className="text-xs text-slate-400">{String(cfg.gbpp ?? '—')} GB/rank</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500"
                    title={`${exact(r.date)}${r.dateSource === 'git' ? ' (from the commit that published the results)' : ''}`}>
                    {ago(r.date)}
                </td>
                <td className="py-3 pl-2 pr-5 text-right">
                    <button onClick={() => setOpen(r)}
                            aria-label={`Details for ${r.run}`}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
                        <Eye className="h-4 w-4" /> Details
                    </button>
                </td>
            </tr>);
    };

    // One header for the whole view. The boards view previously rendered a
    // separate card and a repeated 8-column header per board -- with nine
    // boards holding one entry each, that was eight redundant headers and more
    // chrome than data. Group rows inside one table instead: the standard
    // grouped-table pattern, and it stays readable as boards fill up.
    const Head = ({ scored }: { scored: boolean }) => (
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
                {scored && <th className="py-2.5 pl-5 pr-2 font-medium">#</th>}
                <th className="px-4 py-2.5 font-medium">Run</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 text-right font-medium">Grind <span className="normal-case text-slate-400">ns/gp/eq/rhs</span></th>
                <th className="px-4 py-2.5 text-right font-medium">Wall</th>
                <th className="px-4 py-2.5 font-medium">Resources</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="py-2.5 pl-2 pr-5"></th>
            </tr>
        </thead>);

    const Table = ({ items, scored }: { items: MfcRunData[]; scored: boolean }) => (
        <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                <Head scored={scored} />
                <tbody>{items.map((r, i) => <Row key={r.id} r={r} rank={scored ? i : undefined} />)}</tbody>
            </table>
        </div>);

    // Results published in one commit share a timestamp exactly, so date alone
    // leaves their order to whatever the index listed first. Case then name
    // breaks the tie and keeps the list stable between builds.
    const recent = [...shown].sort((a, b) =>
        String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
        caseOf(a).localeCompare(caseOf(b)) || a.run.localeCompare(b.run));

    // One board per (case, hardware): the only grouping in which two grind
    // times are comparable.
    const boards = new Map<string, MfcRunData[]>();
    for (const r of shown.filter(isRanked)) {
        const k = `${caseOf(r)} · ${hw(r)}`;
        boards.set(k, [...(boards.get(k) ?? []), r]);
    }

    const seg = (id: 'recent' | 'boards', label: string, icon: React.ReactNode) => (
        <button onClick={() => setView(id)} aria-pressed={view === id}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    view === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {icon}{label}
        </button>);

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">MFC · Multi-component Flow Code</h1>
                <p className="mt-2 text-slate-600">
                    Grind time is nanoseconds per grid point, per equation, per right-hand-side evaluation.
                    <span className="font-medium"> Lower is better</span> — the opposite of HPL.
                </p>
            </div>

            {/* One row: view, search, filters. Search is widest because it is
                the fastest path to a specific run and the only control that
                does not need you to know the vocabulary first. */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                    {seg('recent', 'Recent', <Clock className="h-4 w-4" />)}
                    {seg('boards', 'Leaderboards', <Trophy className="h-4 w-4" />)}
                </div>

                <div className="relative min-w-[16rem] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)}
                        aria-label="Search runs"
                        placeholder="Search runs, users, cases…   (press /)"
                        className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    {q && (
                        <button onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="Clear search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <X className="h-3.5 w-3.5" />
                        </button>)}
                </div>

                <select aria-label="Filter by case" value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    <option value="all">All cases</option>
                    {cases.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
                </select>

                <select aria-label="Filter by hardware" value={hardware} onChange={(e) => setHardware(e.target.value)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    <option value="all">All hardware</option>
                    <option>GPU</option><option>CPU</option>
                </select>
            </div>

            <div className="flex items-center gap-3 text-sm text-slate-500">
                <span>
                    <span className="font-medium text-slate-700">{shown.length}</span> of {runs.length} run{runs.length === 1 ? '' : 's'}
                    {view === 'boards' && ` · ${boards.size} board${boards.size === 1 ? '' : 's'}`}
                </span>
                {filtered && (
                    <button onClick={clear} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-slate-500 underline-offset-2 hover:bg-slate-100 hover:text-slate-900 hover:underline">
                        <X className="h-3 w-3" /> Clear filters
                    </button>)}
            </div>

            {loading && <p className="text-slate-600">Loading MFC results…</p>}
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">Could not load results: {error}</p>}

            {!loading && !error && shown.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                    <p className="text-slate-700">
                        {filtered ? <>No runs match {q ? <span className="font-medium">“{q}”</span> : 'these filters'}.</>
                                  : 'No MFC results for this cluster yet.'}
                    </p>
                    {filtered && (
                        <button onClick={clear} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                            Clear filters
                        </button>)}
                </div>)}

            {!loading && !error && shown.length > 0 && view === 'recent' && (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <Table items={recent} scored={false} />
                </section>)}

            {!loading && !error && shown.length > 0 && view === 'boards' && (
                boards.size === 0
                    ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
                          Nothing ranked in this selection. Unranked runs — custom cases, and runs without a
                          verified result — appear under Recent.
                      </div>
                    : <div className="space-y-3">
                          <p className="text-sm text-slate-500">
                              Ranked per case and per hardware: 8 A100s and 36 Haswell cores are different machines,
                              and each case is different physics, so only times within one board compare.
                          </p>
                          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                              <div className="overflow-x-auto">
                                  <table className="min-w-full text-left text-sm">
                                      <Head scored />
                                      {[...boards].sort(([a], [b]) => a.localeCompare(b)).map(([k, items]) => (
                                          <tbody key={k}>
                                              <tr>
                                                  <th colSpan={8} scope="colgroup"
                                                      className="border-t border-slate-200 bg-slate-50/60 px-5 py-2 text-left">
                                                      <span className="font-semibold text-slate-800">{k}</span>
                                                      <span className="ml-2 text-xs font-normal text-slate-500">
                                                          {items.length} entr{items.length === 1 ? 'y' : 'ies'}
                                                      </span>
                                                  </th>
                                              </tr>
                                              {[...items]
                                                  .sort((a, b) => (a.metric?.value ?? Infinity) - (b.metric?.value ?? Infinity))
                                                  .map((r, i) => <Row key={r.id} r={r} rank={i} />)}
                                          </tbody>))}
                                  </table>
                              </div>
                          </section>
                      </div>)}

            {open && <MfcRunDetails run={open} onClose={() => setOpen(null)} />}
        </div>);
}
