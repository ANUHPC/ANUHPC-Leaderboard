# Xenon jobs

Put your run in your own folder:

```
input/xenon/<suite>/<your-name>/<run-name>/
```

Copy a template to start, then rename the run script for this cluster:

```bash
cp -r input/_TEMPLATES/HPL input/xenon/HPL/<your-name>/<run-name>
cd input/xenon/HPL/<your-name>/<run-name>
mv run.xenon.sh run.sh && rm -f run.raijin.sh
```

The templates ship one `run.*.sh` per cluster because they are not
interchangeable — `run.raijin.sh` asks for `--partition=batch`, which does not
exist here, and forces MPI over Ethernet instead of the 56 Gb fabric.

## Suites

| Suite | Board | Hardware | Status |
|-------|-------|----------|--------|
| `HPL` | CPU | `cpu` partition, 36 physical cores | ready |
| `HPL_NVIDIA` | GPU | `gpu` partition, 4-8 x A100-SXM4-40GB | needs a GPU HPL binary |
| `MFC` | — | `cpu` or `gpu` | being built into /apps |

`HPL` and `HPL_NVIDIA` are **separate boards**, not one board with a filter.
GFLOP/s from 4 x A100 and from 36 Haswell cores are not the same measurement,
so ranking them together would bury every CPU entry.

Pushing to `main` under `input/xenon/` triggers `submit-xenon.yml`, which runs
on cpu-node2 and commits results to `output/xenon/`. Nothing else needs doing.

| Partition | Nodes | Per node |
|-----------|-------|----------|
| `cpu` | cpu-node2 | 72 threads (36 physical cores), 500 GB |
| `gpu` | gpu-node1, gpu-node2 | 64 threads, 2 TB, 4x A100-SXM4-40GB |
| `all` | all three | |

Xenon and Raijin are ranked separately — they measure different hardware.

Don't copy a `run.sh` from `input/raijin/`: it will pin `--nodelist=hpc-0N`,
which are Raijin node names and do not exist here.
