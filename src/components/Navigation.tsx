import React, { useEffect, useState } from 'react';
import { Cpu, Zap, Home, GitBranch, Server } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { BenchmarkSuite, SuiteInfo, ClusterInfo, SuiteMeta } from '../types';

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
    const [searchParams, setSearchParams] = useSearchParams();
    const activeCluster = searchParams.get('cluster') ?? 'all';

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

    // A suite tab keeps whichever cluster board you are on, so switching
    // HPL -> HPL NVIDIA compares CPU against GPU on the same cluster instead
    // of dropping you back to "All clusters".
    const suiteHref = (id: string) => {
        const q = activeCluster === 'all' ? '' : new URLSearchParams({cluster: activeCluster}).toString();
        return q ? `/${id}?${q}` : `/${id}`;
    };

    // On a specific cluster show that cluster's count; on "All clusters" the
    // total. A suite not offered here (HPL_NVIDIA needs GPUs) is dimmed.
    const countFor = (m?: SuiteMeta) =>
        !m ? 0
            : activeCluster === 'all' ? (m.count ?? 0)
            : (m.countByCluster?.[activeCluster] ?? 0);

    const offeredHere = (m?: SuiteMeta) =>
        !m || activeCluster === 'all' || !m.clusters?.length
            ? true
            : m.clusters.includes(activeCluster);

    // The suite currently open, and the clusters it is actually offered on.
    // HPL runs on both; MFC and HPL_NVIDIA only exist on Xenon -- Raijin has no
    // GPUs and no Fortran/MPI toolchain for MFC.
    const activeMeta = suites.find((s) => s.name === activeSuite);
    const suiteClusters = activeMeta?.clusters?.length ? activeMeta.clusters : null;

    // A board that exists on exactly one cluster has nothing to switch between,
    // so the picker is hidden rather than offering choices that are empty by
    // construction. It stays visible while the suite list is still loading, and
    // for any suite genuinely offered on more than one cluster.
    const showClusterTabs = clusters.length > 0 && (!suiteClusters || suiteClusters.length > 1);

    // Landing on a single-cluster board while ?cluster= still names another one
    // (you were on Raijin/HPL and clicked MFC) would show an empty table with no
    // visible control to fix it, because the picker is now hidden. Drop the
    // parameter instead; for a single-cluster suite it selects the same rows.
    useEffect(() => {
        if (!suiteClusters || suiteClusters.length !== 1) return;
        const current = searchParams.get('cluster');
        if (current && current !== suiteClusters[0]) {
            const next = new URLSearchParams(searchParams);
            next.delete('cluster');
            setSearchParams(next, { replace: true });
        }
    }, [suiteClusters, searchParams, setSearchParams]);

    const selectCluster = (name: string) => {
        const next = new URLSearchParams(searchParams);
        if (name === 'all') next.delete('cluster');
        else next.set('cluster', name);
        // The cluster is in the URL so a board is linkable and survives reload.
        setSearchParams(next, { replace: false });
    };

    return (
        <nav className="bg-gradient-to-r from-slate-900 to-slate-800 shadow-lg">
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
                    <div className="flex space-x-1 overflow-x-auto">
                        {tabs.map(({ id, meta, info }) => {
                            const offered = offeredHere(meta);
                            return (
                                <Link
                                    key={id}
                                    to={suiteHref(id)}
                                    title={
                                        !offered
                                            ? `Not run on ${activeCluster}`
                                            : meta?.available === false
                                              ? `Not runnable yet: ${(meta.missing ?? []).join(', ')}`
                                              : meta?.description || info?.description
                                    }
                                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                                        activeSuite === id
                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                                            : offered
                                              ? 'text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
                                              : 'text-slate-600 hover:text-slate-400 border border-transparent'
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
                        className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap text-slate-400 hover:text-white hover:bg-white/10 border border-transparent transition-all"
                    >
                        <Home className="w-5 h-5" />
                        <span>GitHub Org</span>
                    </a>
                </div>

                {/* Cluster tabs. Results are ranked per cluster because the two
                    measure different hardware, so this is a board switch rather
                    than a filter. */}
                {showClusterTabs && (
                    <div className="flex items-center gap-2 pb-3 border-t border-white/5 pt-3">
                        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 pr-1">
                            <Server className="w-3.5 h-3.5" />
                            Cluster
                        </span>
                        <div className="flex space-x-1 overflow-x-auto">
                            <button
                                onClick={() => selectCluster('all')}
                                className={tabClass(activeCluster === 'all')}
                            >
                                All clusters
                                <span className="ml-1.5 text-[11px] opacity-60">
                                    {clusters.reduce((n, c) => n + (c.count ?? 0), 0)}
                                </span>
                            </button>
                            {clusters.map((c) => (
                                <button
                                    key={c.name}
                                    onClick={() => selectCluster(c.name)}
                                    title={c.description || undefined}
                                    className={tabClass(activeCluster === c.name)}
                                >
                                    {c.label ?? c.name}
                                    <span className="ml-1.5 text-[11px] opacity-60">{c.count ?? 0}</span>
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