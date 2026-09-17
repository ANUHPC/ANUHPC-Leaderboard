import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

interface MfcRun {
    id: string; cluster: string; group: string; run: string; status: string;
    metric: { value: number } | null;
    config: { case?: string; gpu?: string; ranks?: number; nodes?: number; mfc_sha?: string; gbpp?: number };
    secondary: { key: string; value: number }[];
    ranking?: { eligible: boolean; reason: string; group: string };
    raw?: Record<string, string>;
}

export function MfcPage() {
    const [runs, setRuns] = useState<MfcRun[]>([]);
    const [cases, setCases] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [hardware, setHardware] = useState('GPU');
    const [caseFilter, setCaseFilter] = useState('all');
    const [params] = useSearchParams();
    const cluster = params.get('cluster') ?? 'all';
    useEffect(() => {
        fetch(`${import.meta.env.BASE_URL}data/index.json?t=${Date.now()}`, { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(data => {
                const mfc: MfcRun[] = data.runs.filter((r: { suite: string }) => r.suite === 'MFC');
                setRuns(mfc);
                setCases([...new Set(mfc.map(r => r.config.case).filter((c): c is string => Boolean(c)))].sort());
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);
    const visible = runs.filter(r => (cluster === 'all' || r.cluster === cluster) &&
        (r.config.gpu === 'acc' ? 'GPU' : 'CPU') === hardware &&
        (caseFilter === 'all' || r.config.case === caseFilter));
    const ranked = visible.filter(r => r.ranking?.eligible && r.status === 'ok' && Number.isFinite(r.metric?.value));
    const groups = new Map<string, MfcRun[]>();
    for (const r of ranked) {
        const key = `${r.cluster} · ${r.config.case}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const demos = visible.filter(r => !r.ranking?.eligible);
    const table = (items: MfcRun[], scored: boolean) => <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-4">Rank</th><th className="p-4">Run</th>
                <th className="p-4">Grind time<br /><span className="font-normal">ns/gp/eq/rhs</span></th>
                <th className="p-4">Resources</th><th className="p-4">Artifacts</th>
            </tr></thead>
            <tbody>{[...items].sort((a, b) => (a.metric?.value ?? Infinity) - (b.metric?.value ?? Infinity)).map((r, i) =>
                <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-4">{scored ? `#${i + 1}` : 'Unranked'}</td>
                    <td className="p-4"><div className="font-semibold">{r.group} / {r.run}</div>
                        <div className="text-slate-500">{r.cluster} · {r.status}</div>
                        {!scored && <div className="text-xs text-slate-500">{r.ranking?.reason}</div>}</td>
                    <td className="p-4 font-mono">{r.metric?.value?.toFixed(4) ?? '—'}</td>
                    <td className="p-4">{r.config.nodes} node(s), {r.config.ranks} ranks
                        <div className="text-xs text-slate-500">{hardware} · {r.config.gbpp} GB/rank</div></td>
                    <td className="p-4"><div className="flex flex-col gap-1">
                        {Object.entries(r.raw ?? {}).map(([name, url]) => <a key={name}
                            className="text-blue-700 underline" href={`${import.meta.env.BASE_URL}${url}`}>{name}</a>)}
                    </div></td>
                </tr>)}</tbody>
        </table>
    </div>;
    return <div className="space-y-6">
        <div><h1 className="text-3xl font-bold text-slate-900">MFC · Multi-component Flow Code</h1>
            <p className="mt-2 text-slate-600">Grind time measures nanoseconds per grid point, equation and right-hand-side evaluation. Lower is better.</p>
            <p className="mt-1 text-slate-600">Each pinned case is ranked separately by cluster and hardware. Custom simulations are unranked.</p></div>
        <div className="flex flex-wrap gap-4">
            <label>Hardware <select className="ml-2 rounded border p-2" value={hardware} onChange={e => setHardware(e.target.value)}>
                <option>GPU</option><option>CPU</option></select></label>
            <label>Case <select className="ml-2 rounded border p-2" value={caseFilter} onChange={e => setCaseFilter(e.target.value)}>
                <option value="all">All cases</option>{cases.map(c => <option key={c}>{c}</option>)}</select></label>
        </div>
        {loading && <p>Loading MFC results…</p>}
        {error && <p role="alert" className="text-red-700">Could not load results: {error}</p>}
        {!loading && !error && visible.length === 0 && <p>No MFC results for this selection yet.</p>}
        {[...groups].map(([key, items]) => <section key={key} className="rounded-xl border bg-white overflow-hidden">
            <h2 className="p-4 text-lg font-semibold">{key}</h2>{table(items, true)}</section>)}
        {demos.length > 0 && <section className="rounded-xl border bg-white overflow-hidden">
            <h2 className="p-4 text-lg font-semibold">Demos and unranked runs</h2>{table(demos, false)}</section>}
    </div>;
}
