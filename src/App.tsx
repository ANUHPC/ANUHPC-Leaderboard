import { Routes, Route, Navigate, useParams } from 'react-router';
import { Navigation } from './components/Navigation';
import { BenchmarkPage } from './components/BenchmarkPage';
import { MfcPage } from './components/MfcPage';
import type { BenchmarkSuite } from './types';
import { RunDetailsOverlay } from './components/RunDetailsOverlay';
import { Outlet } from "react-router";

const suiteDetails = {
    HPL: {
        name: 'HPL (CPU)',
        description: 'High Performance Linpack benchmark measuring CPU floating-point performance using dense linear algebra operations.',
        background:"bg-red-50",
    },
    HPL_NVIDIA: {
        name: 'HPL NVIDIA (GPU)',
        description: 'GPU-accelerated High Performance Linpack benchmark leveraging NVIDIA CUDA cores for maximum computational throughput.',
        background:"bg-green-50",
    },
    MFC: {
        name: 'MFC (Multi-component Flow Code)',
        description: 'Multiphase compressible flow simulations on CPUs and GPUs.',
        background:"bg-amber-50",
    }
};

function SuiteWrapper() {
    const { suiteId } = useParams<{ suiteId: BenchmarkSuite }>();
    const suite = suiteId && suiteDetails[suiteId];

    if (!suite) {
        return <Navigate to="/HPL" replace />;
    }

    return (
        <div className={`min-h-screen ${suite.background}`}>
            <Navigation activeSuite={suiteId!} />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {suiteId === 'MFC' ? <MfcPage /> : <BenchmarkPage
                    suite={suiteId!}
                    suiteName={suite.name}
                    description={suite.description}
                />}
            </main>

            <Outlet />

            <footer className="bg-slate-900 border-t border-slate-700 mt-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="text-center text-sm text-slate-400">
                        ANUHPC Leaderboard &middot; ANU High Performance Computing
                    </div>
                </div>
            </footer>
        </div>
    );
}

function App() {
    return (
        <Routes>
            {/* Default route */}
            <Route path="/" element={<Navigate to="/HPL" replace />} />
            {/* Dynamic suite route */}
            <Route path="/:suiteId" element={<SuiteWrapper />}>
                <Route path=":cluster/:group/*" element={<RunDetailsOverlay />} />
            </Route>
        </Routes>
    );
}

export default App;
