import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { RunDetailsModal } from './RunDetailsModal';

export function RunDetailsOverlay() {
    const { suiteId, cluster, group, "*": runPath } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [loading, setLoading] = useState(true);
    const [runData, setRunData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // A link in the pre-cluster shape (/HPL/Ayush/ICX-2) parses as
        // cluster=Ayush, group=ICX-2, runPath="" -- say so instead of
        // leaving the modal on its spinner forever.
        if (!suiteId || !cluster || !group || !runPath) {
            setLoading(false);
            setError('That link is missing the cluster; open the run from the table again.');
            return;
        }

        const controller = new AbortController();
        const fetchRun = async () => {
            setLoading(true);
            setError(null);
            setRunData(null);
            try {
                const res = await fetch(
                    // collect.mjs writes data/runs/<cluster>/<suite>/<group>/<run>/run.json
                    `${import.meta.env.BASE_URL}data/runs/${[cluster, suiteId, group, ...runPath.split('/')].map(encodeURIComponent).join('/')}/run.json`,
                    { signal: controller.signal }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                setRunData(await res.json());
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Error loading run');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };

        fetchRun();
        return () => controller.abort();
    }, [suiteId, cluster, group, runPath]);

    const handleClose = () => {
        // go back to suite root
        if (suiteId) navigate(`/${suiteId}${location.search}`);
    };

    return (
        <RunDetailsModal
            isOpen={true}
            onClose={handleClose}
            runData={runData}
            loading={loading}
            error={error}
        />
    );
}