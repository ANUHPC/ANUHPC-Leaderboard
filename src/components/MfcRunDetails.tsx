import { useEffect, useMemo, useState } from 'react';
import { Activity, Check, Copy, Cpu, FileText, Server, X } from 'lucide-react';

// Details for one MFC run.
//
// HPL's modal renders HPL concepts -- residual, P x Q, device info -- so MFC
// needs its own rather than a shared one bent to fit both. What MFC has that
// HPL does not: a per-step timing series, its own machine-written summary, a
// pinned-case provenance record, and sometimes a rendered video.
//
// The collector parses MFC's stdout instead of embedding it: a 3000-step run
// prints one progress line per step, 399 KB at the largest measured, and
// carrying that raw would add megabytes to every page load. What arrives here
// is the parsed banner, the environment line, a downsampled series, and a
// head/tail excerpt of the real text.

interface Step { step: number; total: number; avg: number; perStep: number }

interface MfcDetail {
    summary?: Record<string, unknown> | null;
    timeData?: { ranks: number; sPerStep: number; grind: number }[];
    case?: { file: string; raw: string } | null;
    script?: { file: string; raw: string } | null;
    out?: {
        file: string; size: number;
        parsed?: {
            banner?: Record<string, string>;
            env?: { host?: string | null; nodesTasks?: string | null; mpirun?: string | null; fabric?: string | null };
            steps?: Step[]; stepCount?: number; performance?: number | null;
            totalTimeSec?: number | null; exitCode?: number | null; lines?: number;
        };
        excerpt?: { head: string[]; tail: string[]; elided: number };
    } | null;
    err?: { file: string; size: number; raw?: string } | null;
}

export interface MfcRunData {
    id: string; cluster: string; group: string; run: string; status: string;
    metric?: { value: number; unit?: string } | null;
    secondary?: { key: string; value: number }[];
    config?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
    ranking?: { eligible: boolean; reason: string; group: string };
    notes?: string[];
    detail?: MfcDetail;
    raw?: Record<string, string>;
    // Summaries carried in index.json so a board row needs no extra fetch.
    wallSec?: number | null;
    hasMedia?: boolean;
    // When it ran, and who entered it. dateSource is "run" when the run
    // timestamped itself and "git" when the date comes from the commit that
    // added its results -- worth surfacing, because the two mean slightly
    // different things and only one is the run's own claim.
    date?: string | null;
    dateSource?: 'run' | 'git' | null;
    submittedAt?: string | null;
    submitter?: { name: string | null; house: boolean; by: string | null } | null;
}

const base = import.meta.env.BASE_URL;

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
    return (
        <div className={`rounded-xl border p-4 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`mt-1 font-mono ${accent ? 'text-2xl font-semibold text-blue-700' : 'text-lg text-slate-900'}`}>{value}</div>
            {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
        </div>
    );
}

// Time per step, drawn as an inline sparkline. The shape is the point: a flat
// line means the run settled, a rising one means it did not.
function StepChart({ steps }: { steps: Step[] }) {
    const { path, lo, hi } = useMemo(() => {
        const ys = steps.map((s) => s.perStep).filter((v) => Number.isFinite(v) && v > 0);
        if (ys.length < 2) return { path: '', lo: 0, hi: 0 };
        const lo = Math.min(...ys), hi = Math.max(...ys);
        const span = hi - lo || 1;
        const d = ys.map((y, i) => {
            const x = (i / (ys.length - 1)) * 100;
            const yy = 100 - ((y - lo) / span) * 92 - 4;
            return `${i ? 'L' : 'M'}${x.toFixed(2)},${yy.toFixed(2)}`;
        }).join(' ');
        return { path: d, lo, hi };
    }, [steps]);

    if (!path) return null;
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Activity className="h-4 w-4 text-slate-400" /> Time per step
                <span className="font-normal text-slate-500">
                    {steps.length} sample{steps.length === 1 ? '' : 's'} · {lo.toFixed(3)}–{hi.toFixed(3)} s
                </span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full" role="img"
                 aria-label={`Time per step, ${lo.toFixed(3)} to ${hi.toFixed(3)} seconds`}>
                <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            </svg>
        </div>
    );
}

function FileBlock({ name, text, note }: { name: string; text: string; note?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <span className="font-mono">{name}</span>
                    {note && <span className="font-normal text-slate-500">{note}</span>}
                </div>
                <button
                    onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="max-h-80 overflow-auto px-4 py-3 text-xs leading-relaxed text-slate-800">{text}</pre>
        </div>
    );
}

export function MfcRunDetails({ run, onClose }: { run: MfcRunData; onClose: () => void }) {
    const [tab, setTab] = useState('overview');
    const [full, setFull] = useState<MfcRunData | null>(null);
    const [loadErr, setLoadErr] = useState('');

    // index.json deliberately carries no detail: it holds every run on the
    // site, and MFC's parsed output and embedded case file are tens of KB
    // each. The full record is fetched when the modal opens, which is what
    // HPL's overlay does too.
    useEffect(() => {
        let alive = true;
        fetch(`${base}data/runs/${run.id}/run.json?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((j) => { if (alive) setFull(j); })
            .catch((e) => { if (alive) setLoadErr(String(e)); });
        return () => { alive = false; };
    }, [run.id]);

    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', k);
        return () => window.removeEventListener('keydown', k);
    }, [onClose]);

    const data = full ?? run;
    const d = data.detail ?? {};
    const parsed = d.out?.parsed;
    const env = parsed?.env ?? {};
    const cfg = (data.config ?? {}) as Record<string, string | number | null>;
    const sec = Object.fromEntries((data.secondary ?? []).map((s) => [s.key, s.value]));
    const media = Object.entries(data.raw ?? run.raw ?? {}).filter(([n]) => /\.(mp4|png)$/i.test(n));

    const outText = d.out?.excerpt
        ? [...d.out.excerpt.head,
           ...(d.out.excerpt.elided ? [``, `… ${d.out.excerpt.elided} lines not shown — open ${d.out.file} for the full log …`, ``] : []),
           ...d.out.excerpt.tail].join('\n')
        : '';

    const tabs = [
        ['overview', 'Overview'],
        d.case && ['case', 'case.py'],
        d.out && ['out', 'Output'],
        d.script && ['script', 'run.sh'],
        (d.err?.raw ?? '').trim() && ['err', 'Errors'],
        media.length && ['media', 'Video'],
    ].filter(Boolean) as [string, string][];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" style={{ margin: 0 }} onClick={onClose}>
            <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-slate-200 bg-white px-6 py-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-slate-900">{run.group} / {run.run}</h2>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                run.ranking?.eligible ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {run.ranking?.eligible ? 'Ranked' : 'Unranked'}
                            </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                            {run.cluster} · {String(cfg.case ?? 'custom case')} · {cfg.gpu === 'acc' ? 'GPU (OpenACC)' : 'CPU'}
                            {run.ranking && !run.ranking.eligible && <> · {run.ranking.reason}</>}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex gap-1 border-b border-slate-200 bg-white px-4">
                    {tabs.map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id)}
                                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                    tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                            {label}
                        </button>
                    ))}
                </div>

                <div className="max-h-[calc(92vh-132px)] space-y-4 overflow-y-auto p-6">
                    {loadErr && (
                        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            Could not load the full record ({loadErr}); showing what the board already had.
                        </p>)}
                    {!full && !loadErr && <p className="text-sm text-slate-500">Loading run details…</p>}
                    {tab === 'overview' && <>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Stat accent label="Grind time" value={data.metric?.value != null ? data.metric.value.toFixed(4) : '—'} hint="ns/gp/eq/rhs · lower is better" />
                            <Stat label="Seconds / step" value={sec.s_step != null ? Number(sec.s_step).toFixed(4) : '—'} />
                            <Stat label="Ranks" value={String(cfg.ranks ?? sec.ranks ?? '—')} hint={`${cfg.nodes ?? '—'} node(s)`} />
                            <Stat label="Wall time" value={parsed?.totalTimeSec != null ? `${parsed.totalTimeSec}s` : '—'}
                                  hint={parsed?.exitCode != null ? `exit ${parsed.exitCode}` : undefined} />
                        </div>

                        {parsed?.steps?.length ? <StepChart steps={parsed.steps} /> : null}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                                    <Server className="h-4 w-4 text-slate-400" /> Where it ran
                                </div>
                                <dl className="space-y-1 text-sm">
                                    {[['Host', env.host], ['Nodes × tasks', env.nodesTasks],
                                      ['Partition', parsed?.banner?.partition], ['Fabric', env.fabric],
                                      ['MPI', env.mpirun?.replace(/^.*\/(?=[^/]*\/bin\/)/, '…/')]]
                                        .filter(([, v]) => v).map(([k, v]) => (
                                        <div key={k} className="flex gap-2">
                                            <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
                                            <dd className="break-all font-mono text-xs text-slate-800">{v}</dd>
                                        </div>))}
                                </dl>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                                    <Cpu className="h-4 w-4 text-slate-400" /> How it was built
                                </div>
                                <dl className="space-y-1 text-sm">
                                    {[['Toolchain', cfg.toolchain], ['GPU mode', cfg.gpu],
                                      ['GB / rank', cfg.gbpp], ['MFC commit', String(cfg.mfc_sha ?? '').slice(0, 12) || null],
                                      ['Case source', (data.provenance as Record<string, string>)?.case_source]]
                                        .filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                                        <div key={k} className="flex gap-2">
                                            <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
                                            <dd className="break-all font-mono text-xs text-slate-800">{String(v)}</dd>
                                        </div>))}
                                </dl>
                            </div>
                        </div>

                        {d.timeData && d.timeData.length > 0 && (
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="mb-2 text-sm font-medium text-slate-700">time_data.dat</div>
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                                        <tr><th className="pb-1">Ranks</th><th className="pb-1">s / step</th><th className="pb-1">ns/gp/eq/rhs</th></tr>
                                    </thead>
                                    <tbody className="font-mono">
                                        {d.timeData.map((r, i) => (
                                            <tr key={i} className="border-t border-slate-100">
                                                <td className="py-1">{r.ranks}</td><td>{r.sPerStep}</td><td>{r.grind}</td>
                                            </tr>))}
                                    </tbody>
                                </table>
                                {d.timeData.length > 1 && (
                                    <p className="mt-2 text-xs text-amber-700">
                                        More than one row: MFC appends to this file, so the directory was reused.
                                        The last row is the one scored.
                                    </p>)}
                            </div>)}

                        {data.notes?.length ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                                {data.notes.map((n, i) => <p key={i}>{n}</p>)}
                            </div>) : null}

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="mb-2 text-sm font-medium text-slate-700">Files</div>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(data.raw ?? run.raw ?? {}).map(([n, url]) => (
                                    <a key={n} href={`${base}${url}`}
                                       className="rounded-lg border border-slate-200 px-2.5 py-1 font-mono text-xs text-blue-700 hover:border-blue-300 hover:bg-blue-50">
                                        {n}
                                    </a>))}
                            </div>
                        </div>
                    </>}

                    {tab === 'case' && d.case && <FileBlock name={d.case.file} text={d.case.raw} note="the simulation this run measured" />}
                    {tab === 'script' && d.script && <FileBlock name={d.script.file} text={d.script.raw} note="generated by MFC from the batch template" />}
                    {tab === 'out' && d.out && (
                        <FileBlock name={d.out.file} text={outText}
                                   note={`${(d.out.size / 1024).toFixed(1)} KB · ${d.out.parsed?.lines ?? '?'} lines · ${d.out.parsed?.stepCount ?? 0} steps`} />)}
                    {tab === 'err' && d.err?.raw && <FileBlock name={d.err.file} text={d.err.raw} note={`${(d.err.size / 1024).toFixed(1)} KB`} />}
                    {tab === 'media' && (
                        <div className="space-y-3">
                            {media.map(([n, url]) => /\.mp4$/i.test(n)
                                ? <video key={n} controls loop className="w-full rounded-xl border border-slate-200 bg-black" src={`${base}${url}`} />
                                : <img key={n} className="w-full rounded-xl border border-slate-200" src={`${base}${url}`} alt={n} />)}
                        </div>)}
                </div>
            </div>
        </div>
    );
}
