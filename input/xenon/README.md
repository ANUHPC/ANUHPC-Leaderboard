# Xenon jobs

Put your run in your own folder:

```
input/xenon/<suite>/<your-name>/<run-name>/
```

For HPL, copy a template and rename its run script for this cluster.
For MFC, use [the MFC instructions](../_TEMPLATES/MFC/README.md); it needs
`job.yml` and optionally `case.py`, not a run script.

HPL example:

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
| `MFC` | CPU / GPU | `cpu` or `gpu` | prebuilt; [GitHub templates](../_TEMPLATES/MFC/README.md) |

`HPL` and `HPL_NVIDIA` are **separate boards**, not one board with a filter.
GFLOP/s from 4 x A100 and from 36 Haswell cores are not the same measurement,
so ranking them together would bury every CPU entry.

Pushing to `main` under `input/xenon/` triggers `submit-xenon.yml`, which runs
on cpu-node2 and commits results to `output/xenon/`. Nothing else needs doing.

| Partition | Nodes | Per node |
|-----------|-------|----------|
| `cpu` | cpu-node1, cpu-node2 | 34 / 36 available physical cores, 500 GB each |
| `gpu` | gpu-node1, gpu-node2 | 32 physical cores, 4x A100-SXM4-40GB each |
| `all` | all four | Not supported for MFC: mixed CPU architectures |

Xenon and Raijin are ranked separately — they measure different hardware.

Don't copy a `run.sh` from `input/raijin/`: it will pin `--nodelist=hpc-0N`,
which are Raijin node names and do not exist here.
