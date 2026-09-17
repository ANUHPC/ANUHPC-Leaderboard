import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MfcRunDetails, type MfcRunData } from './MfcRunDetails';
import { MfcConvergence } from './MfcConvergence';
import { caseName, comparableGrind, guide, hardware, number, repo, secondary, settingFields, statusLabel, validRun, value } from './mfc';

const tasks = [
    ['1', 'Build & test', 'practice-task1', 'Terminal'],
    ['2', 'Convergence', 'practice-task2', 'GitHub'],
    ['3', 'Shock & droplet', 'practice-problem3', 'GitHub'],
    ['4', 'ParaView', 'practice-task4', 'Remote viewer'],
];

export function MfcPage() {
    const [params, setParams] = useSearchParams();
    const update = (changes: Record<string, string | null>) => setParams(prev => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) { if (v && v !== 'all') next.set(k, v); else next.delete(k); }
        return next;
    }, { replace: true });
    const q = params.get('q') ?? '', cluster = params.get('cluster') ?? 'all';
    const hardwareFilter = ['CPU','GPU','Unknown hardware'].includes(params.get('hardware') ?? '') ? params.get('hardware')! : 'all', caseFilter = params.get('case') ?? 'all';
    const view = ['convergence', 'benchmarks'].includes(params.get('view') ?? '') ? params.get('view')! : 'runs';
    const norm = params.get('norm') === 'L1' ? 'L1' : params.get('norm') === 'Linf' ? 'Linf' : 'L2';
    const [runs, setRuns] = useState<MfcRunData[]>([]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<string[]>([]);
    const search = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState<MfcRunData | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError('');
        fetch(`${import.meta.env.BASE_URL}data/index.json?t=${Date.now()}`, { signal: controller.signal, cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(data => {
                if (!Array.isArray(data?.runs)) throw new Error('Invalid results index');
                const mfc = data.runs.filter((r: { suite?: string } | null) => r?.suite === 'MFC');
                if (!mfc.every(validRun)) throw new Error('Invalid MFC run record');
                setRuns(mfc);
            }).catch(e => { if (!controller.signal.aborted) setError(String(e)); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [retry]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (!open && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !target.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
                e.preventDefault(); search.current?.focus();
            }
        };
        window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
    }, [open]);
    const shown = useMemo(() => runs.filter(r =>
        (cluster === 'all' || r.cluster === cluster) && (hardwareFilter === 'all' || hardware(r) === hardwareFilter) &&
        (caseFilter === 'all' || caseName(r) === caseFilter) && q.toLowerCase().split(/\s+/).every(word =>
            [r.run, r.group, r.cluster, caseName(r), hardware(r), r.submitter?.name, r.submitter?.by, r.config?.toolchain, statusLabel(r)].join(' ').toLowerCase().includes(word))),
        [runs, cluster, hardwareFilter, caseFilter, q]);
    const cases = [...new Set(runs.filter(r => cluster === 'all' || r.cluster === cluster).map(caseName))].sort();
    const filtered = Boolean(q || hardwareFilter !== 'all' || caseFilter !== 'all');
    const clear = () => update({ q: null, hardware: null, case: null });
    const compared = shown.filter(r => selected.includes(r.id));
    const safeGrind = comparableGrind(shown);
    const sort = params.get('sort') === 'step' ? 'step' : params.get('sort') === 'grind' && safeGrind ? 'grind' : 'recent';
    const recent = [...shown].sort((a,b) => {
        const score = (r: MfcRunData) => { const n = sort === 'step' ? secondary(r, 's_step') : r.metric?.value; return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : Infinity; };
        return (sort !== 'recent' ? score(a) - score(b) : (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0)) || a.id.localeCompare(b.id);
    });
    const boards = new Map<string, MfcRunData[]>();
    for (const r of shown.filter(r => r.ranking?.eligible && r.status === 'ok')) {
        const k = `${r.cluster} · ${caseName(r)} · ${hardware(r)}`;
        boards.set(k, [...(boards.get(k) ?? []), r]);
    }
    const openDetails = (r: MfcRunData) => setOpen(r);
    const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 focus-visible:outline-blue-600';
    const cell = 'px-4 py-3 align-top';
    const table = (items: MfcRunData[], ranked = false) => <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">MFC run settings and measured costs</caption>
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Compare', 'Run', 'Settings', 'Time', 'Resources / date', ''].map((label,i) => <th key={i} className={cell}>{label}</th>)}</tr></thead>
        <tbody>{items.map((r,i) => <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className={cell}><input type="checkbox" aria-label={`Compare ${r.run}`} checked={selected.includes(r.id)} disabled={!selected.includes(r.id) && compared.length >= 4}
                onChange={e => setSelected(e.target.checked ? [...compared.map(r => r.id), r.id] : selected.filter(id => id !== r.id))} /></td>
            <td className={`${cell} min-w-48 max-w-xs break-words`}><button className="font-semibold text-blue-800 underline-offset-2 hover:underline" onClick={() => openDetails(r)}>{ranked ? `#${i+1} · ` : ''}{r.run}</button>
                <p className="mt-1 text-xs text-slate-500">{caseName(r)} · {r.cluster} · {hardware(r)}</p>
                <p className="mt-1 text-xs">{r.submitter?.name ?? r.group}{r.submitter?.house ? ' · reference' : ''}</p>
                <p className={`mt-2 text-xs ${statusLabel(r).startsWith('Verified') ? 'text-emerald-800' : 'text-amber-800'}`} title={r.verification?.reason ?? r.ranking?.reason}>{statusLabel(r)}</p>
            </td>
            <td className={`${cell} min-w-48`}>
                {r.parameters ? <><p>{value(r.parameters.grid)} cells</p><p className="mt-1">WENO {value(r.parameters.wenoOrder)} · {value(r.parameters.riemann)}</p></> : <><p className="text-slate-500">Settings unknown</p></>}
            </td>
            <td className={`${cell} min-w-44 font-mono text-xs leading-6`}><p>{number(secondary(r, 's_step'))} s / step</p><p>{number(secondary(r, 'exec'))} s simulation</p><p className="text-slate-500">{number(r.metric?.value)} grind · {value(r.parameters?.equations)} eq</p></td>
            <td className={`${cell} min-w-40 text-xs leading-6`}><p>{value(r.config?.nodes)} nodes · {value(r.config?.ranks)} ranks</p><p>{r.date && Number.isFinite(Date.parse(r.date)) ? new Date(r.date).toLocaleString('en-GB', {timeZone:'UTC'}) + ' UTC' : 'Date unknown'}</p><p className="text-slate-500">{r.dateSource === 'git' ? 'Result publication date' : r.dateSource === 'run' ? 'Run completion date' : ''}</p></td>
            <td className={cell}><button className={button} onClick={() => openDetails(r)} aria-label={`Details for ${r.run}`}>{r.hasMedia ? 'Details + media' : 'Details'}</button></td>
        </tr>)}</tbody></table></div>;
    return <div className="min-w-0 space-y-5 text-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-700">SCC26 practice · MFC</p><h1 className="mt-1 text-3xl font-bold">MFC · Simulation studies</h1><p className="mt-2 max-w-3xl text-slate-600">Compare settings, accuracy and run time.</p></div><a href={guide('')} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">Submit a run ↗</a></div>
        <section aria-label="SCC26 practice tasks" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{tasks.map(([n,title,path,mode]) => <a key={n} href={guide(path)} className="rounded-xl border border-slate-200 bg-white p-3 hover:border-blue-400"><p className="text-xs text-slate-500">Task {n} · {mode}</p><h2 className="mt-1 text-sm font-semibold">{title} ↗</h2></a>)}</section>
        <details className="text-sm text-slate-600"><summary className="cursor-pointer text-blue-800">Quick help</summary><div className="mt-2 max-w-3xl space-y-2 rounded-lg border border-slate-200 bg-white p-4"><p>For Tasks 2–3, copy a template to input/xenon/MFC/&lt;name&gt;/&lt;run&gt;/ and push to main. Follow <a href={`${repo}/actions/workflows/submit-xenon.yml`} className="text-blue-700 underline">GitHub Actions</a> for progress. Tasks 1 and 4 use a cluster terminal.</p><p>Compare seconds per step alongside grid size and accuracy. Grind is ns per grid point, equation and RHS evaluation; adding equations can lower it without making a run faster.</p><p>Verified means execution provenance checked, not physics validated. Missing settings stay unknown.</p><a href={guide('')} className="inline-block text-blue-700 underline">Full guide ↗</a></div></details>
        <div className="flex flex-wrap gap-2" aria-label="MFC views">{[['runs','Runs & settings'],['convergence','Convergence'],['benchmarks','Benchmarks']].map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => update({view:id})} className={`${button} ${view === id ? '!border-blue-700 !bg-blue-700 text-white' : ''}`}>{label}</button>)}</div>
        <div className="flex flex-wrap items-center gap-3"><input ref={search} type="search" aria-label="Search runs" placeholder="Search runs, users, cases… ( / )" value={q} onChange={e => update({q:e.target.value})} className="min-w-0 flex-1 basis-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <select aria-label="Filter by case" value={caseFilter} onChange={e => update({case:e.target.value})} className={`${button} max-w-full`}><option value="all">All cases</option>{caseFilter !== 'all' && !cases.includes(caseFilter) && <option value={caseFilter}>{caseFilter} (not in this cluster)</option>}{cases.map(c => <option key={c}>{c}</option>)}</select>
            <select aria-label="Filter by hardware" value={hardwareFilter} onChange={e => update({hardware:e.target.value})} className={button}><option value="all">All hardware</option><option>CPU</option><option>GPU</option><option>Unknown hardware</option></select>
            {view === 'runs' && <select aria-label="Sort runs" value={sort} onChange={e => update({sort:e.target.value})} className={button}><option value="recent">Newest first</option><option value="step">Seconds per step</option><option value="grind" disabled={!safeGrind}>Grind (matching benchmarks only)</option></select>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600" aria-live="polite"><span>{shown.length} of {runs.length} MFC runs</span>{filtered && <button className="text-blue-700 underline" onClick={clear}>Clear filters</button>}<span>Compare up to 4 runs.</span></div>
        {compared.length > 0 && <section className="overflow-hidden rounded-xl border border-blue-200 bg-white"><div className="flex justify-between gap-2 bg-blue-50 p-4"><h2 className="font-semibold">Compare selected runs ({compared.length})</h2><button className="text-sm text-blue-700 underline" onClick={() => setSelected([])}>Clear selection</button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className={cell}>Setting / measurement</th>{compared.map(r => <th key={r.id} className={`${cell} min-w-48`}><button onClick={() => openDetails(r)} className="text-blue-700 underline">{r.run}</button></th>)}</tr></thead><tbody>
            {[['Cluster / hardware', (r: MfcRunData) => `${r.cluster} / ${hardware(r)}`], ['Case', caseName], ...settingFields.map(([k,label]) => [label, (r: MfcRunData) => value(r.parameters?.[k])]), ['Seconds per step', (r: MfcRunData) => number(secondary(r,'s_step'))], ['Simulation seconds', (r: MfcRunData) => number(secondary(r,'exec'))], ['Total seconds', (r: MfcRunData) => number(r.wallSec)], ['Grind (ns/gp/eq/rhs)', (r: MfcRunData) => number(r.metric?.value)]].map(([label,get]) => <tr key={String(label)} className="border-t"><th className={`${cell} font-medium`}>{String(label)}</th>{compared.map(r => <td className={cell} key={r.id}>{(get as (r: MfcRunData) => string)(r)}</td>)}</tr>)}
        </tbody></table></div><p className="p-4 text-sm text-amber-900">{comparableGrind(compared) ? 'Matching grind context. Check grid and resources before comparing speed.' : 'Grind is not directly comparable: settings or equation counts differ or are unknown.'}</p></section>}
        {loading && <p role="status">Loading MFC results…</p>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>Could not load results: {error}</p><button className={`${button} mt-3`} onClick={() => setRetry(v => v+1)}>Retry</button></div>}
        {!loading && !error && <>
            {view === 'convergence' ? <MfcConvergence runs={shown} norm={norm} onNorm={norm => update({norm})} onOpen={openDetails} /> : shown.length === 0 ? <div className="rounded-xl border bg-white p-8"><p>{filtered ? 'No runs match these filters.' : 'No MFC results for this cluster yet.'}</p>{filtered && <button onClick={clear} className={`${button} mt-3`}>Reset filters</button>}</div> : view === 'runs' ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">{table(recent)}</section> : <div className="space-y-4"><p className="text-sm text-slate-600">Benchmarks are grouped by cluster, case and hardware. Only matching settings can be ranked.</p>{boards.size === 0 && <p className="rounded-xl border bg-white p-6">No verified benchmarks in this selection.</p>}{[...boards].map(([key,items]) => {
                const safe = comparableGrind(items);
                return <section key={key} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><h2 className="bg-slate-50 p-4 font-semibold">{key}</h2>{!safe && <p className="px-4 pb-3 text-sm text-amber-800">Settings differ or are incomplete; grind ranking is unavailable.</p>}{table(safe ? [...items].sort((a,b) => a.metric!.value-b.metric!.value) : items,safe)}</section>;
            })}</div>}
        </>}
        <p className="text-xs text-slate-500">Older runs may lack settings. <a href="https://mflowcode.github.io/documentation/expectedPerformance.html" className="underline">About MFC performance metrics ↗</a></p>
        {open && <MfcRunDetails run={open} onClose={() => setOpen(null)} />}
    </div>;
}
