# Practice Task 1 — build and run the test suite

> Set up your compiler environment and execute the built-in test suite
> (`./mfc.sh test`) on CPUs and GPUs to verify that the software builds
> properly and all automated tests pass.

There is nothing to submit. This task verifies the build; it produces a
pass/fail and a log, with no timing to rank. Run it with the helper script:

```bash
suites/MFC/run-tests.sh cpu --smoke     # 17 tests, about 5 minutes
suites/MFC/run-tests.sh cpu             # all 686, about an hour
suites/MFC/run-tests.sh gpu --smoke
suites/MFC/run-tests.sh gpu             # on 4 A100s, 35-60 minutes
```

The exit code is the **number of failed tests** — that is `./mfc.sh test`'s
own convention, and 0 means everything passed.

## What the suite is

720 cases, of which **686 run by default** (34 convergence cases are skipped
unless asked for by name). Each one runs `pre_process` and `simulation` on a
small grid, packs the output, and compares it against a checked-in
`golden.txt` with a per-case tolerance — 1e-12 normally, looser for the
bubble, hypoelastic and immersed-boundary families. Some also restart from a
midpoint and check they land in the same place.

It compiles before it runs. Most cases share one binary; only those with
chemistry or analytic initial conditions need their own. Builds are additive,
so nothing existing is replaced.

## Why there is a script instead of a `job.yml`

Three reasons, all specific to this cluster:

**The flags are not optional and are not obvious.** MFC's default template
picks its launcher from `jsrun srun mpirun mpiexec`, and `srun` wins here —
which is a disaster. Measured: **317 seconds per test with `srun` against 42
with `mpirun`**, because Slurm serialises step creation. It also invents
failures, since concurrent `execve()` of the same NFS-hosted binary gives
`Text file busy` — 6 of 34 tests in one sample, none for a numerical reason.
On GPU it does not merely slow down: NVHPC's HPC-X is not built with Slurm's
PMI, so **all 17 GPU tests failed** with `OPAL ERROR: Unreachable` until
forced onto `mpirun`. The script passes `--binary mpirun`,
`--ntasks-per-node` and `--max-attempts 3` for you.

**One flag would corrupt the installation for everyone.** `./mfc.sh test
--generate` rewrites the `golden.txt` files that every later test is compared
against, in a checkout shared by all of us. Nothing would notice — the commit
pin still matches, because the goldens are separate files. The script refuses
that flag outright.

**It would block the queue.** Submissions are serialised, and a full run is
about an hour, so routing it through the pipeline would park everyone's
benchmark behind it.

## Reading the result

The summary panel prints passed / failed / skipped. On failure you also get
`tests/failed_uuids.txt` in the MFC tree, and one directory per failed test
holding its `case.py`, the generated script, the full stdout and the
`golden.txt` it was compared against:

```
ls /work/mfc/current/haswell/tests/<UUID>/
```

## Measured on Xenon

| what | where | result |
|---|---|---|
| `--only 1D --shard 1/10`, `-j 8` | cpu-node2 | 17/17 pass, 4m58 (3m23 of it compiling) |
| `--percent 10`, `-j 32` | cpu, mpirun | 66 pass, 2 fail, 9m06 |
| `--only 1D --shard 1/10` | gpu-node2, 4×A100 | 17/17 pass, 4m05 |
| `--percent 3`, `-j 4` | gpu-node2 | 20/20 pass, 1m02 |

Full-suite figures in the script's header are extrapolated from those
samples, not measured directly.
