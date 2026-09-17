# Practice Task 4 — remote visualisation with ParaView

> Establish a client-server connection to render high-resolution simulation
> files on the remote machine, without transferring large datasets to your
> local computer.

This is the one task with nothing to submit. There is no `job.yml`: you run a
server on a compute node and drive it from ParaView on your laptop. The data
never moves — the largest MFC run here is **129 GB** of Silo, which is the
whole point.

## Before you start

Your laptop needs **ParaView 5.11.2 specifically** —
[paraview.org/download](https://www.paraview.org/download/) (`.dmg` for macOS,
`.msi` for Windows). The client-server protocol is version-locked, so 5.12 or
6.0 will refuse to connect. The server side is already installed at
`/work/pv-5.11.2`.

## The connection

Compute nodes are on a private network and are **not reachable from your
laptop**, so the tunnel goes through the login node in two hops.

**1. On the cluster — claim a node and start the server**

```bash
salloc -p cpu -N1 -n1 -t 120
srun --pty /work/pv-5.11.2/pvserver-xenon --server-port=11111
```

It prints the node it landed on:

```
Connection URL: cs://cpu-node1:11111
```

Pick a port nobody else is using — the default collides.

**2. On your laptop — tunnel to that node through the login node**

```bash
ssh -N -L 11111:cpu-node1:11111 <you>@<xenon-login>
```

Use whichever node step 1 reported.

**3. In ParaView on your laptop**

`File → Connect → Add Server`, type `Client/Server`, host `localhost`, port
`11111`. Connect, then `File → Open` and browse the **remote** filesystem:

```
/scratch/jobs/visualizations/<Actions-run-ID>/MFC/<group>/<run>/silo_hdf5/collection.silo.series
```

Use the preserved path from the Actions summary and the GitHub Actions run ID,
not a Slurm job ID. The temporary staging directory is cleaned after harvesting.

Open the `.silo.series` for the animation, or `collection_*.silo` for one
step. Tick the variables you want in the Properties panel — they are off by
default.

## What you can open

A finished run leaves its Silo database on `/scratch`; only small artifacts
are committed to the repository. One real example is 129 GB across 8 rank
directories and 61 timesteps, with a 23 KB index file that is the thing you
actually open.

Fields MFC writes: `alpha1`, `alpha_rho1`, `E`, `pres`, `vel1`, `vel2`,
`vel3`, and `ib_markers` where an immersed boundary is used.

## Two things that will waste your afternoon

**Use 5.11.2, not the ParaView already on `/work/paraview`.** That one is
5.13.2, and its Silo reader loads MFC's geometry with **no field arrays** —
you get a mesh and nothing to colour it by. Verified on this cluster. 5.11.2
reads all eight natively.

**Rendering is software, on CPU.** These nodes have no GPU libraries at all —
no `libGL`, no `libEGL`. The server renders with llvmpipe, which is correct
but slow: expect sluggish interaction on 35 million cells. Start with a
smaller run or a single timestep. The A100 nodes do have the GPU libraries
and would render in hardware, but that path is untested here.

Both CPU nodes are shared and `OverSubscribe=NO`, so an interactive
allocation takes a whole node. Release it (`exit` twice) when you are done.

## If you only want a picture

You do not need any of this to see your results. Set `visualize: true` and
`preview: alpha1` in a `job.yml` and the pipeline renders an MP4 and a PNG
server-side and commits them with the run. Client-server is for exploring
interactively — different variables, different timesteps, slicing — without
downloading 129 GB to do it.
