import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { BenchmarkRun } from '../types';

interface Point {
    x: number;
    y: number;
    runs: BenchmarkRun[];
    key: string;
}
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const tickLabel = (value: number) => value.toLocaleString('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1,
});

// Rounded integer ticks, including a useful range when there is only one point.
function scale(values: number[], count: number) {
    const min = Math.min(...values), max = Math.max(...values);
    const padding = Math.max((max - min) * 0.08, min === max ? max * 0.04 : 0, 1);
    const low = Math.max(0, min - padding), high = max + padding;
    const rough = (high - low) / count;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = Math.max(1, ([1, 2, 5, 10].find(n => n * power >= rough) ?? 10) * power);
    const lo = Math.floor(low / step) * step, hi = Math.ceil(high / step) * step;
    const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
    return { lo, hi, ticks };
}

function RunPlot({ runs, axis }: { runs: BenchmarkRun[]; axis: 'N' | 'NB' }) {
    const container = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(560);
    const [selected, setSelected] = useState<string | null>(null);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
    const [pinned, setPinned] = useState(false);
    const location = useLocation();
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const points = useMemo(() => {
        const grouped = new Map<string, Point>();
        for (const run of runs) {
            const x = run.best?.[axis], y = run.best?.gflops;
            if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) continue;
            const key = `${x}/${y}`;
            const point = grouped.get(key) ?? { key, x, y, runs: [] };
            point.runs.push(run);
            grouped.set(key, point);
        }
        return [...grouped.values()];
    }, [runs, axis]);
    const title = axis === 'N' ? 'Performance vs matrix size' : 'Performance vs block size';
    const active = points.find(point => point.key === selected);
    const height = 280, left = 58, right = width - 16, top = 26, bottom = height - 42;
    const xs = scale(points.length ? points.map(p => p.x) : [1], width < 400 ? 2 : 4);
    const ys = scale(points.length ? points.map(p => p.y) : [1], 4);
    const xPixel = (x: number) => left + (x - xs.lo) / (xs.hi - xs.lo) * (right - left);
    const yPixel = (y: number) => bottom - (y - ys.lo) / (ys.hi - ys.lo) * (bottom - top);
    const cross = active ? { x: xPixel(active.x), y: yPixel(active.y) } : cursor;
    const color = axis === 'N' ? '#2563eb' : '#047857';
    const clear = () => { setSelected(null); setCursor(null); setPinned(false); };
    const track = (event: React.PointerEvent<SVGSVGElement>, pin = false) => {
        if (pinned && !pin) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) * width / bounds.width;
        const y = (event.clientY - bounds.top) * height / bounds.height;
        if (x < left || x > right || y < top || y > bottom) {
            if (!pinned) { setSelected(null); setCursor(null); }
            return;
        }
        // Use both screen coordinates: points sharing N or NB remain individually selectable.
        const nearest = points.reduce<{ point: Point | null; distance: number }>((best, point) => {
            const distance = Math.hypot(xPixel(point.x) - x, yPixel(point.y) - y);
            return distance < best.distance ? { point, distance } : best;
        }, { point: null, distance: 24 });
        setSelected(nearest.point?.key ?? null);
        setCursor({ x, y });
        if (pin) setPinned(Boolean(nearest.point));
    };

    return <section aria-label={title} className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5"
        onPointerLeave={() => { if (!pinned) { setSelected(null); setCursor(null); } }}>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <div ref={container} className="mt-2 min-w-0">
            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-label={`${title}, interactive scatter plot`}
                onPointerMove={track} onPointerDown={event => track(event, true)} onKeyDown={event => { if (event.key === 'Escape') clear(); }}>
                <text x={left} y={14} fontSize={12} fill="#475569">GFLOP/s</text>
                {ys.ticks.map(value => <g key={value}>
                    <line x1={left} x2={right} y1={yPixel(value)} y2={yPixel(value)} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <text x={left - 8} y={yPixel(value) + 4} textAnchor="end" fontSize={12} fill="#475569">{tickLabel(value)}</text>
                </g>)}
                {xs.ticks.map(value => <g key={value}>
                    <line x1={xPixel(value)} x2={xPixel(value)} y1={top} y2={bottom} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <text x={xPixel(value)} y={bottom + 18} textAnchor="middle" fontSize={12} fill="#475569">{tickLabel(value)}</text>
                </g>)}
                <text x={(left + right) / 2} y={height - 3} textAnchor="middle" fontSize={12} fill="#475569">{axis === 'N' ? 'Matrix size (N)' : 'Block size (NB)'}</text>
                {cross && <g data-testid="chart-crosshair" pointerEvents="none">
                    <line x1={cross.x} x2={cross.x} y1={top} y2={bottom} stroke={color} strokeDasharray="4 3" />
                    <line x1={left} x2={right} y1={cross.y} y2={cross.y} stroke={color} strokeDasharray="4 3" />
                </g>}
                {points.map(point => <g key={point.key}>
                    <circle data-point={point.key} cx={xPixel(point.x)} cy={yPixel(point.y)} r={12} fill="transparent"
                        role="button" tabIndex={0} aria-label={`${point.runs.map(r => `${r.cluster}: ${r.group}/${r.run}`).join('; ')}; ${axis} ${point.x}; ${point.y} GFLOP/s`}
                        aria-pressed={pinned && selected === point.key}
                        // Pointer selection uses XY distance, even when another circle overlaps.
                        // Prevent browser focus from overriding it with the topmost SVG target.
                        onPointerDown={event => event.preventDefault()}
                        onFocus={() => { setSelected(point.key); setPinned(true); }}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(point.key); setPinned(true); } }}
                        className="cursor-pointer outline-none focus:stroke-slate-900 focus:stroke-2" />
                    <circle cx={xPixel(point.x)} cy={yPixel(point.y)} r={active?.key === point.key ? 7 : 5} fill={color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
                    {point.runs.length > 1 && <text x={xPixel(point.x) + 9} y={yPixel(point.y) - 9} fontSize={11} fill={color} pointerEvents="none">{point.runs.length}</text>}
                </g>)}
            </svg>
        </div>
        <div className="min-h-24 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
            {active ? <>
                <div className="flex items-center justify-between gap-2 font-medium text-slate-800">
                    <span>{axis} {number(active.x)} · {number(active.y)} GFLOP/s</span>
                    {pinned && <button className="text-xs text-blue-700 underline" onClick={clear}>Clear</button>}
                </div>
                <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {active.runs.map(run => <li key={run.id} className="break-words">
                        <Link className="text-blue-700 underline" to={`/${[run.suite, run.cluster ?? '', run.group, run.run].map(encodeURIComponent).join('/')}${location.search}`}>
                            {run.cluster} · {run.group}/{run.run}
                        </Link>
                        <span className="ml-2 text-xs text-slate-500">N {number(run.best!.N)} · NB {number(run.best!.NB)}</span>
                    </li>)}
                </ul>
            </> : <p className="text-slate-500">{cursor
                ? `${axis} ≈ ${number(xs.lo + (cursor.x - left) / (right - left) * (xs.hi - xs.lo))} · ${number(ys.lo + (bottom - cursor.y) / (bottom - top) * (ys.hi - ys.lo))} GFLOP/s`
                : 'Hover or tap a point. Select a run to open its details.'}</p>}
        </div>
    </section>;
}

export function GflopsCharts({ runs }: { runs: BenchmarkRun[] }) {
    // Reset hover/pinning when filters or application change, even if coordinates coincide.
    const version = runs.map(r => `${r.id}:${r.best?.N}:${r.best?.NB}:${r.best?.gflops}`).join('|');
    return <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RunPlot key={`N:${version}`} runs={runs} axis="N" />
        <RunPlot key={`NB:${version}`} runs={runs} axis="NB" />
    </div>;
}
