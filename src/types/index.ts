export interface HplBest {
    gflops: number;
    N: number;
    NB: number;
    timeSec: number;
}

export interface IqtreeBest {
    logL: number;
    BIC: number | null;
    model: string | null;
    numTaxa: number | null;
    numSites: number | null;
    timeSec: number;
}

export interface BenchmarkRun {
    id: string;
    suite: string;
    group: string;
    run: string;
    cluster: string | null;
    best: HplBest | IqtreeBest | null;
    outSummary: {
        testsTotal: number | null;
        testsPassed: number | null;
        testsFailed: number | null;
        testsSkipped: number | null;
    };
    hasErr: boolean;
}

export interface BenchmarkData {
    generatedAt: string;
    runs: BenchmarkRun[];
}

export type BenchmarkSuite = 'HPL' | 'HPL_NVIDIA' | 'IQTree';

export interface SuiteInfo {
    id: BenchmarkSuite;
    name: string;
    description: string;
    type: 'CPU' | 'GPU' | 'Phylogenetics';
}