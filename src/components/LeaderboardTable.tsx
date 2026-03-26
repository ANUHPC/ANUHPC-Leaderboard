import React, { useState } from 'react';
import {
    ChevronUp,
    ChevronDown,
    Trophy,
    Medal,
    Award,
    Eye,
} from 'lucide-react';
import type { BenchmarkRun } from '../types';
import { RunDetailsModal } from './RunDetailsModal';
import { useNavigate, useParams } from "react-router";

interface LeaderboardTableProps {
    runs: BenchmarkRun[];
    suite: string;
}

type SortField = 'gflops' | 'group' | 'run' | 'timeSec' | 'cluster';
type SortDirection = 'asc' | 'desc';

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({ runs, suite }) => {
    const navigate = useNavigate();
    const { suiteId } = useParams();

    const [sortField, setSortField] = useState<SortField>('gflops');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [, setSelectedRun] = useState<BenchmarkRun | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [runDetails, setRunDetails] = useState<any>(null);
    const [loadingDetails, ] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);

    const [showBestPerGroup, setShowBestPerGroup] = useState(true);

    const closeModal = () => {
        setModalOpen(false);
        setSelectedRun(null);
        setRunDetails(null);
        setDetailsError(null);
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection(field === 'gflops' ? 'desc' : 'asc');
        }
    };

    const getPrimaryMetric = (run: BenchmarkRun): number => {
        if (!run.best) return -Infinity;
        // IQTree: higher log-likelihood is better
        if ('logL' in run.best) return run.best.logL ?? -Infinity;
        if ('gflops' in run.best) return run.best.gflops ?? -Infinity;
        return -Infinity;
    };

    // Get best run per group
    const bestPerGroupRuns = Object.values(
        runs.reduce<Record<string, BenchmarkRun>>((acc, run) => {
            if (!acc[run.group] || getPrimaryMetric(run) > getPrimaryMetric(acc[run.group])) {
                acc[run.group] = run;
            }
            return acc;
        }, {})
    );

    // decide which runs to display
    const runsToDisplay = showBestPerGroup ? bestPerGroupRuns : runs;

    const sortedRuns = [...runsToDisplay].sort((a, b) => {
        let aValue: string | number;
        let bValue: string | number;

        switch (sortField) {
            case 'gflops':
                aValue = getPrimaryMetric(a);
                bValue = getPrimaryMetric(b);
                break;
            case 'timeSec':
                aValue = (a.best && 'timeSec' in a.best ? a.best.timeSec : null) ?? 0;
                bValue = (b.best && 'timeSec' in b.best ? b.best.timeSec : null) ?? 0;
                break;
            case 'group':
                aValue = a.group;
                bValue = b.group;
                break;
            case 'run':
                aValue = a.run;
                bValue = b.run;
                break;
            case 'cluster':
                aValue = a.cluster ?? '';
                bValue = b.cluster ?? '';
                break;
            default:
                aValue = getPrimaryMetric(a);
                bValue = getPrimaryMetric(b);
        }

        if (typeof aValue === 'string' && typeof bValue === 'string') {
            return sortDirection === 'asc'
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        }

        return sortDirection === 'asc'
            ? (aValue as number) - (bValue as number)
            : (bValue as number) - (aValue as number);
    });

    const getRankIcon = (index: number) => {
        switch (index) {
            case 0: return <Trophy className="w-5 h-5 text-yellow-500" />;
            case 1: return <Medal className="w-5 h-5 text-gray-400" />;
            case 2: return <Award className="w-5 h-5 text-amber-600" />;
            default: return <span className="w-5 h-5 flex items-center justify-center text-sm font-bold text-gray-500">#{index + 1}</span>;
        }
    };

    const CLUSTER_STYLES: Record<string, string> = {
        Xenon:  'bg-blue-100 text-blue-800',
        Raijin: 'bg-orange-100 text-orange-800',
    };

    const clusterBadge = (cluster: string | null) => {
        if (!cluster) return null;
        const cls = CLUSTER_STYLES[cluster] ?? 'bg-gray-100 text-gray-700';
        return (
            <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${cls}`}>
                {cluster}
            </span>
        );
    };

    const formatGflops = (gflops: number) => {
        if (gflops >= 1000) {
            return `${(gflops / 1000).toFixed(2)}T`;
        }
        return gflops.toFixed(3);
    };

    const renderPrimaryMetric = (run: BenchmarkRun) => {
        if (!run.best) return <span className="text-gray-400">N/A</span>;
        if ('logL' in run.best) {
            return (
                <>
                    <div className="text-sm font-bold text-purple-600">
                        lnL = {run.best.logL?.toFixed(2) ?? 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">
                        {run.best.model ?? ''}
                    </div>
                </>
            );
        }
        const best = run.best as import('../types').HplBest;
        return (
            <>
                <div className="text-lg font-bold text-blue-600">
                    {formatGflops(best.gflops)}
                </div>
                <div className="text-xs text-gray-500">
                    {best.gflops.toLocaleString()} GFLOPS
                </div>
            </>
        );
    };

    const renderSizeColumn = (run: BenchmarkRun) => {
        if (!run.best) return <span className="text-gray-400">N/A</span>;
        if ('logL' in run.best) {
            const b = run.best as import('../types').IqtreeBest;
            return (
                <>
                    <div className="text-sm text-gray-900">{b.numTaxa ?? '?'} taxa</div>
                    <div className="text-xs text-gray-500">{b.numSites ?? '?'} sites</div>
                </>
            );
        }
        const b = run.best as import('../types').HplBest;
        return (
            <>
                <div className="text-sm text-gray-900">N={b.N?.toLocaleString() ?? '?'}</div>
                <div className="text-xs text-gray-500">NB={b.NB ?? '?'}</div>
            </>
        );
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) {
            return <div className="w-4 h-4" />;
        }
        return sortDirection === 'asc' ? (
            <ChevronUp className="w-4 h-4" />
        ) : (
            <ChevronDown className="w-4 h-4" />
        );
    };

    return (
        <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-900 tracking-tight">
                        {suite} Leaderboard
                        <span className="ml-2 text-sm font-normal text-gray-400">
                            {runsToDisplay.length} {showBestPerGroup ? 'groups' : 'runs'}
                        </span>
                    </h2>
                    <button
                        onClick={() => setShowBestPerGroup((prev) => !prev)}
                        className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
                    >
                        {showBestPerGroup ? 'Show All Runs' : 'Best Per Group'}
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Rank
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('cluster')}
                            >
                                <div className="flex items-center space-x-1">
                                    <span>Cluster</span>
                                    <SortIcon field="cluster" />
                                </div>
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('group')}
                            >
                                <div className="flex items-center space-x-1">
                                    <span>Group</span>
                                    <SortIcon field="group" />
                                </div>
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('run')}
                            >
                                <div className="flex items-center space-x-1">
                                    <span>Run</span>
                                    <SortIcon field="run" />
                                </div>
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('gflops')}
                            >
                                <div className="flex items-center space-x-1">
                                    <span>Performance</span>
                                    <SortIcon field="gflops" />
                                </div>
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('timeSec')}
                            >
                                <div className="flex items-center space-x-1">
                                    <span>Time (sec)</span>
                                    <SortIcon field="timeSec" />
                                </div>
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Matrix Size
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                        {sortedRuns.map((run, index) => (
                            <tr
                                key={run.id}
                                className={`transition-colors hover:bg-gray-50/80 ${
                                    index === 0 ? 'bg-gradient-to-r from-amber-50/60 to-transparent' :
                                    index < 3 ? 'bg-gradient-to-r from-blue-50/40 to-transparent' : ''
                                }`}
                            >
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">{getRankIcon(index)}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {clusterBadge(run.cluster)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">
                                        {run.group}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{run.run}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {renderPrimaryMetric(run)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">
                                        {run.best && 'timeSec' in run.best && (run.best.timeSec ?? 0) > 0
                                            ? `${run.best.timeSec}s`
                                            : 'N/A'}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {renderSizeColumn(run)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <button
                                        onClick={() =>
                                            navigate(`/${suiteId}/${run.group}/${run.run}`)
                                        }
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 text-sm font-medium rounded-xl transition-all"
                                    >
                                        <Eye className="w-4 h-4" />
                                        <span>Details</span>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>

                {runsToDisplay.length === 0 && (
                    <div className="text-center py-12">
                        <div className="text-gray-500">No benchmark runs available</div>
                    </div>
                )}
            </div>
            <RunDetailsModal
                isOpen={modalOpen}
                onClose={closeModal}
                runData={runDetails}
                loading={loadingDetails}
                error={detailsError}
            />
        </>
    );
};