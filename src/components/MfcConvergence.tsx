import type { MfcRunData } from './MfcRunDetails';
import { guide, hardware, number, value } from './mfc';

type Norm = 'L1' | 'L2' | 'Linf';
export function MfcConvergence({ runs, norm, onNorm, onOpen }: { runs: MfcRunData[]; norm: Norm; onNorm: (n: Norm) => void; onOpen: (r: MfcRunData) => void }) {
    const groups = new Map<string, MfcRunData[]>();
    for (const r of runs) {
        const c = r.convergence;
        if (r.status !== 'ok' || !c || !c.series || !(c.N > 0) || !Number.isFinite(c[norm]) || c[norm] < 0) continue;
        const k = JSON.stringify([r.cluster, hardware(r), r.config?.toolchain, r.config?.mfc_sha, c.series]);
        groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return <section className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-xl font-semibold">Task 2 · Accuracy under refinement</h2>
            <p className="mt-2 text-sm text-slate-600">Measured error versus grid size. Lower error means higher accuracy.</p>
            <details className="mt-2 text-sm text-slate-600"><summary className="cursor-pointer text-blue-800">How to read the plot</summary><div className="mt-2 space-y-2"><p>Error compares initial and final volume fraction after one periodic return. Each line keeps the case, CFL, solver settings and hardware fixed.</p><p>Observed order = log(error coarse / error fine) ÷ log(N fine / N coarse). RK3 time error can limit WENO5 to third order; use a low CFL to examine spatial accuracy.</p><p>WENO epsilon and smooth extrema also affect observed order. The task guide explains the expected trends.</p></div></details>
            <label className="mt-3 inline-flex items-center gap-2 text-sm">Error norm <select className="rounded border p-2" value={norm} onChange={e => onNorm(e.target.value as Norm)}><option>L1</option><option>L2</option><option>Linf</option></select></label>
            <a className="ml-4 text-sm text-blue-700 underline" href={guide('practice-task2')}>Run a sweep ↗</a>
        </div>
        {!groups.size && <p className="rounded-xl border border-slate-200 bg-white p-6">No error measurements yet. Submit a Task 2 run to add a point.</p>}
        {[...groups].map(([key, items]) => {
            const rows = [...items].sort((a, b) => a.convergence!.N - b.convergence!.N);
            const positive = rows.filter(r => r.convergence![norm] > 0);
            const duplicate = new Set(rows.map(r => r.convergence!.N)).size !== rows.length;
            const xs = positive.map(r => Math.log10(r.convergence!.N));
            const ys = positive.map(r => Math.log10(r.convergence![norm]));
            const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
            const x = (n: number) => 75 + 490 * (Math.log10(n) - xlo) / (xhi - xlo || 1);
            const y = (e: number) => 230 - 190 * (Math.log10(e) - ylo) / (yhi - ylo || 1);
            const first = rows[0];
            return <div key={key} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">WENO {value(first.parameters?.wenoOrder)} · {first.cluster} · {hardware(first)}</h3>
                <p className="mt-1 break-words text-xs text-slate-500">Series arguments (N varies): {Array.isArray(first.config?.args) ? first.config.args.filter((v, i, a) => v !== '-N' && a[i-1] !== '-N' && !String(v).startsWith('-N=')).join(' ') || 'Case defaults' : 'Unknown'} · epsilon {value(first.parameters?.wenoEps)} · {value(first.parameters?.timeStepper)}</p>
                {duplicate && <p className="mt-2 text-sm text-amber-800">Repeated resolutions: filter to one sweep to show lines and order.</p>}
                {positive.length > 0 && <svg viewBox="0 0 640 285" className="mt-3 w-full max-w-3xl" role="img" aria-label={`${norm} error versus grid cells on logarithmic axes`}>
                    <path d="M75 30V230H580" fill="none" stroke="#64748b" />
                    {[0, .5, 1].map(t => <g key={t}><text x={65} y={234 - 190 * t} textAnchor="end" fontSize="11">{(10 ** (ylo + (yhi - ylo) * t)).toExponential(1)}</text><path d={`M75 ${230 - 190*t}H580`} stroke="#e2e8f0" /></g>)}
                    {!duplicate && positive.length > 1 && <polyline points={positive.map(r => `${x(r.convergence!.N)},${y(r.convergence![norm])}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" />}
                    {positive.map(r => <g key={r.id}><circle cx={x(r.convergence!.N)} cy={y(r.convergence![norm])} r="4" fill="#2563eb"><title>{r.run}: N={r.convergence!.N}, {norm}={r.convergence![norm]}</title></circle><text x={x(r.convergence!.N)} y="250" textAnchor="middle" fontSize="11">{r.convergence!.N}</text></g>)}
                    <text x="325" y="277" textAnchor="middle" fontSize="12">Grid cells N (log scale)</text><text x="12" y="130" transform="rotate(-90 12 130)" textAnchor="middle" fontSize="12">{norm} error (log scale)</text>
                </svg>}
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Measured errors and observed order</caption><thead><tr>{['Run', 'N', norm, 'Observed order'].map(v => <th className="p-2" key={v}>{v}</th>)}</tr></thead><tbody>
                    {rows.map((r, i) => { const c = r.convergence!, prev = rows[i-1]?.convergence;
                        const order = !duplicate && prev && c.N > prev.N && c[norm] > 0 && prev[norm] > 0 ? Math.log(prev[norm] / c[norm]) / Math.log(c.N / prev.N) : null;
                        return <tr key={r.id} className="border-t"><td className="p-2"><button className="text-blue-700 underline" onClick={() => onOpen(r)}>{r.run}</button></td><td className="p-2">{c.N}</td><td className="p-2 font-mono">{c[norm].toExponential(4)}</td><td className="p-2">{order != null && Number.isFinite(order) ? order.toFixed(3) : '—'}</td></tr>; })}
                </tbody></table></div>
                <p className="mt-2 text-xs text-slate-500">{positive.length < rows.length ? 'Zero errors remain in the table and are omitted from the log plot. ' : ''}{number(rows.length)} measured points.</p>
            </div>;
        })}
    </section>;
}
