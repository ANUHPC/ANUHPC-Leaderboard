// HPL on the A100 nodes.
//
// The parsing is identical to the CPU suite: suites/HPL/collect.mjs already
// sniffs the NVIDIA output format (the "--- DEVICE INFO ---" banner and the
// per-GPU Gflops column) and picks parseOutNvidia over parseOutCpu. Reuse it
// rather than forking a second copy that would drift.
//
// Only the suite name differs, which is what puts GPU runs on their own board
// so they are never ranked against CPU runs.
export { collect } from "../HPL/collect.mjs";
export const name = "HPL_NVIDIA";
