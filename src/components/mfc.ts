import type { MfcRunData } from './MfcRunDetails';
export const repo = 'https://github.com/ANUHPC/ANUHPC-Leaderboard';
export const guide = (path: string) => `${repo}/tree/main/input/_TEMPLATES/MFC/${path}`;
export const hardware = (r: MfcRunData) => r.config?.gpu === 'acc' ? 'GPU' : r.config?.gpu === 'none' || r.config?.gpu === 'no' ? 'CPU' : 'Unknown hardware';
export const caseName = (r: MfcRunData) => String(r.config?.case ?? 'custom');
export const value = (v: unknown): string => v == null ? 'Unknown' : typeof v === 'boolean' ? (v ? 'On' : 'Off') : typeof v === 'object' ? 'Unknown' : String(v);
export const number = (v: unknown, digits = 4) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v.toLocaleString('en', { maximumSignificantDigits: digits }) : '—';
export const secondary = (r: MfcRunData, key: string) => r.secondary?.find(s => s.key === key)?.value;
export function statusLabel(r: MfcRunData) {
    if (r.status !== 'ok') return r.status === 'failed' ? 'Failed' : 'No verified result';
    const kind = r.verification?.kind;
    return kind === 'benchmark' || r.ranking?.eligible ? 'Verified benchmark' : kind === 'study' ? 'Verified study' : kind === 'custom' ? 'Verified custom run' : 'Unverified provenance';
}
export function artifactURL(path: unknown) {
    if (typeof path !== 'string' || !path.startsWith('raw/')) return undefined;
    const parts = path.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[%\\?#]/.test(p) || [...p].some(c => c.charCodeAt(0) < 32))) return undefined;
    return import.meta.env.BASE_URL + parts.map(encodeURIComponent).join('/');
}
export function validRun(r: unknown): r is MfcRunData {
    if (!r || typeof r !== 'object') return false;
    const x = r as MfcRunData;
    const record = (v: unknown) => v != null && typeof v === 'object' && !Array.isArray(v);
    const text = (v: unknown) => v == null || typeof v === 'string';
    if (!['id', 'run', 'group', 'cluster', 'status'].every(k => typeof x[k as keyof MfcRunData] === 'string') ||
        x.id.split('/').some(p => !p || p === '.' || p === '..') ||
        (x.secondary != null && (!Array.isArray(x.secondary) || !x.secondary.every(s => s && typeof s.key === 'string' && typeof s.value === 'number'))) ||
        (x.metric != null && (!record(x.metric) || typeof x.metric.value !== 'number')) ||
        (x.config != null && !record(x.config)) ||
        (x.parameters != null && (!record(x.parameters) || !Object.values(x.parameters).every(v => v == null || ['string','number','boolean'].includes(typeof v)))) ||
        (x.verification != null && (!record(x.verification) || !text(x.verification.kind) || !text(x.verification.reason))) ||
        (x.ranking != null && (!record(x.ranking) || typeof x.ranking.eligible !== 'boolean' || !text(x.ranking.reason) || !text(x.ranking.group))) ||
        (x.raw != null && (!record(x.raw) || !Object.values(x.raw).every(v => typeof v === 'string'))) ||
        (x.submitter != null && (!record(x.submitter) || !text(x.submitter.name) || !text(x.submitter.by))) ||
        !text(x.date) || (x.notes != null && (!Array.isArray(x.notes) || !x.notes.every(v => typeof v === 'string')))) return false;
    // Details are loaded separately: reject malformed nested logs rather than
    // losing the entire page to a render exception. The index remains usable.
    const d = x.detail;
    if (d != null) {
        if (!record(d)) return false;
        for (const f of [d.case, d.script, d.err]) if (f && (!record(f) || typeof f.file !== 'string' || !text(f.raw))) return false;
        if (d.timeData != null && (!Array.isArray(d.timeData) || !d.timeData.every(v => v && [v.ranks,v.sPerStep,v.grind].every(n => typeof n === 'number')))) return false;
        const out = d.out;
        if (out != null) {
            if (!record(out) || typeof out.file !== 'string') return false;
            const e = out.excerpt;
            if (e && (!Array.isArray(e.head) || !Array.isArray(e.tail) || ![...e.head,...e.tail].every(v => typeof v === 'string'))) return false;
            const p = out.parsed;
            if (p != null && (!record(p) || p.steps != null && (!Array.isArray(p.steps) || !p.steps.every(s => s && typeof s.perStep === 'number')) ||
                p.banner != null && (!record(p.banner) || !Object.values(p.banner).every(text)) ||
                p.env != null && (!record(p.env) || !Object.values(p.env).every(text)))) return false;
        }
    }
    return true;
}
export function comparableGrind(runs: MfcRunData[]) {
    if (!runs.length) return false;
    const key = (r: MfcRunData) => JSON.stringify([r.cluster, hardware(r), r.ranking?.group,
        ...['equations','modelEqns','numFluids','wenoOrder','wenoEps','riemann','timeStepper','viscous','surfaceTension','bubbles'].map(k => r.parameters?.[k])]);
    return runs.every(r => r.status === 'ok' && r.ranking?.eligible && Number.isFinite(r.metric?.value) &&
        typeof r.parameters?.equations === 'number' && r.parameters.equations > 0 && key(r) === key(runs[0]));
}
export const settingFields = [
    ['grid', 'Grid (cells)'], ['cells', 'Total cells'], ['dt', 'Time step (s)'], ['steps', 'Steps'],
    ['wenoOrder', 'WENO order'], ['wenoEps', 'WENO epsilon'], ['riemann', 'Riemann solver'], ['timeStepper', 'Time integration'],
    ['viscous', 'Viscosity'], ['surfaceTension', 'Surface tension'], ['bubbles', 'Eulerian bubbles'], ['equations', 'Equations'],
] as const;
