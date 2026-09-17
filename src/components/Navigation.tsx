import React, { useEffect, useState } from 'react';
import { Cpu, Zap, Home, GitBranch, Server } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { BenchmarkSuite, SuiteInfo, ClusterInfo } from '../types';

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
        name: 'MFC (Multi-Flow Component)',
        description: 'Multi-Flow Component Benchmark',
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
    const [searchParams, setSearchParams] = useSearchParams();
    const activeCluster = searchParams.get('cluster') ?? 'all';

    useEffect(() => {
        fetch(`${import.meta.env.BASE_URL}data/index.json?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setClusters(d?.clusters ?? []))
            .catch(() => setClusters([]));
    }, []);

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
                        {suiteInfos.map((suite) => (
                            <Link
                                key={suite.id}
                                to={`/${suite.id}`}
                                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                                    activeSuite === suite.id
                                        ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                                        : 'text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
                                }`}
                            >
                                {getIcon(suite.type)}
                                <span>{suite.name}</span>
                            </Link>
                        ))}
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
                {clusters.length > 0 && (
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