import type { ClusterInfo, SuiteMeta } from './types';

// Availability comes from the suite manifest, including clusters with no runs yet.
export function supportedClusters(meta: SuiteMeta | undefined, clusters: ClusterInfo[]): ClusterInfo[] {
    if (!meta) return [];
    if (!Array.isArray(meta.clusters)) return clusters;
    return meta.clusters.filter((name): name is string => typeof name === 'string')
        .filter((name, index, names) => names.indexOf(name) === index)
        .map(name => clusters.find(cluster => cluster.name === name) ?? { name });
}

export function validCluster(requested: string, offered: ClusterInfo[]): string {
    if (offered.length === 1) return offered[0].name;
    return requested === 'all' || offered.some(cluster => cluster.name === requested) ? requested : 'all';
}
