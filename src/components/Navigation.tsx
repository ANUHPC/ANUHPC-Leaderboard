import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Zap, Home, GitBranch, Server } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { BenchmarkSuite, SuiteInfo, ClusterInfo, SuiteMeta } from '../types';
import { supportedClusters, validCluster } from '../suiteAvailability';

interface NavigationProps {
    activeSuite: BenchmarkSuite;
}

const suiteInfos: SuiteInfo[] = [
    {
        id: 'HPL',
        name: 'HPL (CPU)',
        description: 'High Performance Linpack - CPU Performance',
        type: 'CPU',
    },
    {
        id: 'HPL_NVIDIA',
        name: 'HPL NVIDIA (GPU)',
        description: 'High Performance Linpack - GPU Accelerated',
        type: 'GPU',
    },
    {
        id: 'MFC',
        name: 'MFC (Multi-component Flow Code)',
        description: 'Multiphase compressible flow',
        type: 'Multi-Flow',
    },
];

const getIcon = (type: string) => {
    switch (type) {
        case 'CPU':
            return <Cpu className="w-5 h-5" />;
        case 'GPU':
            return <Zap className="w-5 h-5" />;
        case 'Multi-Flow':
            return <GitBranch className="w-5 h-5" />;
        default:
            return <Cpu className="w-5 h-5" />;
    }
};

export const Navigation: React.FC<NavigationProps> = ({ activeSuite }) => {
    // Clusters come from the data, not a hardcoded list: adding a third cluster
    // should need no change here.
    const [clusters, setClusters] = useState<ClusterInfo[]>([]);
    const [suites, setSuites] = useState<SuiteMeta[]>([]);
    const suiteTabs = useRef<HTMLDivElement>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedCluster = searchParams.get('cluster') ?? 'all';
    const activeMeta = suites.find(s => s.name === activeSuite);
    const suiteClusters = supportedClusters(activeMeta, clusters);
    const activeCluster = activeMeta ? validCluster(requestedCluster, suiteClusters) : requestedCluster;

    useEffect(() => {
        const container = suiteTabs.current;
        if (!container) return;
        const revealActive = () => {
            const selected = container.querySelector('[aria-current="page"]');
            if (!selected) return;
            const tab = selected.getBoundingClientRect();
            const area = container.getBoundingClientRect();
            if (tab.left < area.left) container.scrollLeft -= area.left - tab.left;
            else if (tab.right > area.right) container.scrollLeft += tab.right - area.right;
        };
        revealActive();
        const observer = new ResizeObserver(revealActive);
        observer.observe(container);
        return () => observer.disconnect();
    }, [activeSuite, suites]);

    useEffect(() => {
        fetch(`${import.meta.env.BASE_URL}data/index.json?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                setClusters(Array.isArray(d?.clusters) ? d.clusters.filter((c: ClusterInfo | null) => c && typeof c.name === 'string') : []);
                setSuites(Array.isArray(d?.suites) ? d.suites.filter((s: SuiteMeta | null) => s && typeof s.name === 'string') : []);
            })
            .catch(() => {
                setClusters([]);
                setSuites([]);
            });
    }, []);

    // Suites come from the data, like the clusters do. The table below only
    // supplies the display name and icon; a suite the collector does not know
    // about is not a board anyone can open.
    const tabs = (suites.length ? suites.map((s) => s.name) : suiteInfos.map((s) => s.id))
        .map((id) => ({
            id,
            meta: suites.find((s) => s.name === id),
            info: suiteInfos.find((s) => s.id === id),
        }));

    // Resolve the destination before navigation so an unsupported board never flashes.
    const targetCluster = (meta?: SuiteMeta) => meta
        ? validCluster(activeCluster, supportedClusters(meta, clusters)) : 'all';
    const suiteHref = (id: string, meta?: SuiteMeta) => {
        const cluster = targetCluster(meta);
        const q = cluster === 'all' ? '' : new URLSearchParams({ cluster }).toString();
        return q ? `/${id}?${q}` : `/${id}`;
    };
    const countFor = (meta?: SuiteMeta) => targetCluster(meta) === 'all'
        ? meta?.count ?? 0 : meta?.countByCluster?.[targetCluster(meta)] ?? 0;
    const showClusterTabs = suiteClusters.length > 1;

    // Repair bookmarks too, preserving the page's other filters and browser history.
    useEffect(() => {
        if (!activeMeta || requestedCluster === activeCluster) return;
        const next = new URLSearchParams(searchParams);
        if (activeCluster === 'all') next.delete('cluster');
        else next.set('cluster', activeCluster);
        setSearchParams(next, { replace: true });
    }, [activeMeta, requestedCluster, activeCluster, searchParams, setSearchParams]);

    const selectCluster = (name: string) => {
        const next = new URLSearchParams(searchParams);
        if (name === 'all') next.delete('cluster');
        else next.set('cluster', name);
        // The cluster is in the URL so a board is linkable and survives reload.
        setSearchParams(next, { replace: false });
    };

    return (
        <nav aria-label="Leaderboard navigation" className="bg-gradient-to-r from-slate-900 to-slate-800 shadow-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex justify-between items-center py-4">
                    <a href="https://github.com/ANUHPC/ANUHPC-Leaderboard" target="_blank" rel="noopener noreferrer" className="flex items-center space-x-3 group">
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 rounded-xl shadow-md group-hover:shadow-blue-500/25 transition-shadow">
                            <Zap className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">
                                ANUHPC Leaderboard
                            </h1>
                            <p className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
                                ANU High Performance Computing
                            </p>
                        </div>
                    </a>
                </div>

                {/* Suite Navigation */}
                <div className="flex justify-between items-center pb-3">
                    <div ref={suiteTabs} className="flex min-w-0 space-x-1 overflow-x-auto">
                        {tabs.map(({ id, meta, info }) => {
                            return (
                                <Link
                                    key={id}
                                    to={suiteHref(id, meta)}
                                    aria-current={activeSuite === id ? 'page' : undefined}
                                    title={
                                        meta?.available === false
                                              ? `Not runnable yet: ${(meta.missing ?? []).join(', ')}`
                                              : meta?.description || info?.description
                                    }
                                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                                        activeSuite === id
                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                                            : 'text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
                                    }`}
                                >
                                    {getIcon(info?.type ?? 'CPU')}
                                    <span>{info?.name ?? id}</span>
                                    <span className="text-[11px] opacity-60">{countFor(meta)}</span>
                                    {meta?.available === false && (
                                        <span
                                            className="text-[10px] px-1 py-0.5 rounded bg-amber-400/15 text-amber-300"
                                            title={`Not runnable yet: ${(meta.missing ?? []).join(', ')}`}
                                        >
                                            soon
                                        </span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>

                    <a
                        href="https://github.com/ANUHPC"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub organisation"
                        className="shrink-0 flex items-center space-x-2 px-2 sm:px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap text-slate-400 hover:text-white hover:bg-white/10 border border-transparent transition-all"
                    >
                        <Home className="w-5 h-5" />
                        <span className="hidden lg:inline">GitHub Org</span>
                    </a>
                </div>

                {/* Cluster tabs. Results are ranked per cluster because the two
                    measure different hardware, so this is a board switch rather
                    than a filter. */}
                {suiteClusters.length === 1 && (
                    <div aria-label="Available cluster" className="pb-3 text-xs text-slate-400 flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5" aria-hidden="true" />
                        {suiteClusters[0].label ?? suiteClusters[0].name}
                    </div>
                )}
                {showClusterTabs && (
                    <div className="flex items-center gap-2 pb-3 border-t border-white/5 pt-3">
                        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 pr-1">
                            <Server className="w-3.5 h-3.5" />
                            Cluster
                        </span>
                        <div className="flex min-w-0 space-x-1 overflow-x-auto">
                            <button
                                aria-pressed={activeCluster === 'all'}
                                onClick={() => selectCluster('all')}
                                className={tabClass(activeCluster === 'all')}
                            >
                                All clusters
                                <span className="ml-1.5 text-[11px] opacity-60">
                                    {activeMeta?.count ?? 0}
                                </span>
                            </button>
                            {suiteClusters.map((c) => (
                                <button
                                    key={c.name}
                                    aria-pressed={activeCluster === c.name}
                                    onClick={() => selectCluster(c.name)}
                                    title={c.description || undefined}
                                    className={tabClass(activeCluster === c.name)}
                                >
                                    {c.label ?? c.name}
                                    <span className="ml-1.5 text-[11px] opacity-60">{activeMeta?.countByCluster?.[c.name] ?? 0}</span>
                                    {c.derived && (
                                        <span
                                            className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-amber-400/15 text-amber-300"
                                            title="Node specs inferred from past runs, not measured"
                                        >
                                            est
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
};

const tabClass = (active: boolean) =>
    `flex items-center px-3 py-1.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
        active
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
            : 'text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
    }`;
