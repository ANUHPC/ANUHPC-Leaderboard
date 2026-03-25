import React from 'react';
import { Cpu, Zap, TreePine, Home } from 'lucide-react';
import { Link } from 'react-router';
import type { BenchmarkSuite, SuiteInfo } from '../types';

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
        id: 'IQTree',
        name: 'IQ-TREE (Phylogenetics)',
        description: 'Phylogenetic Tree Inference',
        type: 'Phylogenetics',
    },
];

const getIcon = (type: string) => {
    switch (type) {
        case 'CPU':
            return <Cpu className="w-5 h-5" />;
        case 'GPU':
            return <Zap className="w-5 h-5" />;
        case 'Phylogenetics':
            return <TreePine className="w-5 h-5" />;
        default:
            return <Cpu className="w-5 h-5" />;
    }
};

export const Navigation: React.FC<NavigationProps> = ({ activeSuite }) => {
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
            </div>
        </nav>
    );
};