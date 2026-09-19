import type { ClusterInfo, SuiteMeta } from './types';

// The cluster row describes recorded runs for this application, not hardware
// support or activity in other applications. Hide clusters until their first run.
export function recordedClusters(meta: SuiteMeta | undefined, clusters: ClusterInfo[]): ClusterInfo[] {
    return Object.entries(meta?.countByCluster ?? {})
        .filter(([, count]) => Number.isFinite(count) && count > 0)
        .map(([name]) => clusters.find(cluster => cluster.name === name) ?? { name });
}

export function validCluster(requested: string, offered: ClusterInfo[]): string {
    if (offered.length === 1) return offered[0].name;
    return requested === 'all' || offered.some(cluster => cluster.name === requested) ? requested : 'all';
}
