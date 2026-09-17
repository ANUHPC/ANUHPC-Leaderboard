# MFC entry template

Copy this directory, edit `job.yml`, push.

Unlike HPL you do **not** supply a batch script. MFC generates its own from
`suites/MFC/xenon.mako`; a `.sh` file here is rejected by validation rather than
silently ignored.

You also do not supply `case.py` — it comes from the pinned MFC checkout in
`/apps/mfc`, so everyone runs byte-identical physics. Name the case you want in
`job.yml`.

| | |
|---|---|
| Metric | grind time, ns/gp/eq/rhs |
| Direction | **lower is better** |
| Reference | GH200 0.32 · H100 SXM5 0.38 |

What you can tune: `nodes`, `tasks_per_node`, `gbpp`, `gpu`, `toolchain`,
`case_optimization`.
