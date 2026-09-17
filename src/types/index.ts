export interface HplBest {
    gflops: number;
    N: number;
    NB: number;
    timeSec: number;
}

export interface BenchmarkRun {
    id: string;
    suite: string;
    group: string;
    run: string;
    cluster: string | null;
    best: HplBest | null;
    outSummary: {
        testsTotal: number | null;
        testsPassed: number | null;
        testsFailed: number | null;
        testsSkipped: number | null;
    };
    hasErr: boolean;
}

export interface ClusterInfo {
    name: string;
    label?: string;
    description?: string;
    status?: string;
    /** Node specs inferred from committed output rather than measured. */
    derived?: boolean;
    nodes?: number;
    partitions?: string[];
    count?: number;
}

export interface SuiteMeta {
    name: string;
    description?: string;
    metric?: { key: string; label?: string; unit?: string; direction?: 'higher' | 'lower'; precision?: number } | null;
    reference?: { device: string; [k: string]: unknown }[] | null;
    count?: number;
    /** Clusters this suite runs on. HPL_NVIDIA needs GPUs, so Xenon only. */
    clusters?: string[];
    /** false when the binaries are not published yet. */
    available?: boolean;
    missing?: string[] | null;
    /** Per-cluster run counts, for the suite tab badges. */
    countByCluster?: Record<string, number>;
}

export interface BenchmarkData {
    generatedAt: string;
    clusters?: ClusterInfo[];
    suites?: SuiteMeta[];
    runs: BenchmarkRun[];
}

export type BenchmarkSuite = 'HPL' | 'HPL_NVIDIA' | 'MFC';

export interface SuiteInfo {
    id: BenchmarkSuite;
    name: string;
    description: string;
    type: 'CPU' | 'GPU' | 'Multi-Flow';
}