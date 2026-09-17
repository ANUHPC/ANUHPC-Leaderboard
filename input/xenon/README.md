# Xenon jobs

Put your run in your own folder:

```
input/xenon/<suite>/<your-name>/<run-name>/
```

Copy a template to start:

```bash
cp -r input/_TEMPLATES/HPL input/xenon/HPL/<your-name>/<run-name>
```

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
