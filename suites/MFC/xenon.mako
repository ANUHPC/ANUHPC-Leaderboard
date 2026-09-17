#!/usr/bin/env bash
##
## MFC batch template for the ANU Xenon cluster.
##
## Selected by passing this file's PATH to MFC:
##     ./mfc.sh run <case.py> -e batch -c suites/MFC/xenon.mako ...
##
## MFC resolves --computer against its built-in template names first, then
## against the filesystem (toolchain/mfc/run/run.py :: __get_template), so this
## lives in the leaderboard repo and needs no fork of MFC.
##
## The helpers.* macros below are NOT optional. run_epilogue is what appends
## exec and grind to summary.yaml; without it the job runs and produces no
## result at all.
##
<%namespace name="helpers" file="helpers.mako"/>

% if engine == 'batch':
#SBATCH --job-name="${name}"
#SBATCH --nodes=${nodes}
#SBATCH --ntasks-per-node=${tasks_per_node}
#SBATCH --output="${name}.out"
#SBATCH --error="${name}.err"
#SBATCH --time=${walltime}
% if partition:
#SBATCH --partition=${partition}
% endif
% if not gpu_enabled:
## Physical cores, and the whole node.
##
## Without --hint=nomultithread Slurm hands out hardware threads, so
## --ntasks-per-node=4 can land on 2 physical cores and the mpirun below fails
## outright with "Procs mapped: 0" -- --bind-to core cannot find 4 distinct
## cores. --exclusive keeps another job off the node, which a benchmark needs
## anyway: a shared node makes the grind time meaningless.
#SBATCH --exclusive
#SBATCH --hint=nomultithread
% endif
% if gpu_enabled:
## gpu-node1 and gpu-node2 carry 4x A100-SXM4-40GB each; one rank per device.
#SBATCH --gres=gpu:a100:${tasks_per_node}
#SBATCH --exclusive
% endif
% if account:
#SBATCH --account=${account}
% endif
% if email:
#SBATCH --mail-user=${email}
#SBATCH --mail-type="END,FAIL"
% endif
% endif

${helpers.template_prologue()}

## ---------------------------------------------------------------------------
## Environment.
##
## There is no module command on this cluster yet (no Lmod, no
## environment-modules), so the toolchain is added to PATH directly. When a
## module system is installed, replace this block with the matching
## `module load` lines from cluster/toolchains.yml.
## ---------------------------------------------------------------------------
## /work, not /apps. The /apps build of OpenMPI 5.0.10 has no Fortran at all
## ("Fort compiler: none", no mpifort), because it was configured before
## gfortran was installed. MFC is Fortran, so its binaries are linked against
## the /work rebuild instead -- and LD_LIBRARY_PATH wins over the RUNPATH baked
## into them, so naming the wrong prefix here would load an MPI with no
## libmpi_mpifh and fail at startup.
export OMPI_PREFIX=/work/openmpi/5.0.10
export UCX_PREFIX=/apps/ucx/1.22.0
export PATH="$OMPI_PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$OMPI_PREFIX/lib:$UCX_PREFIX/lib:${'${LD_LIBRARY_PATH:-}'}"

## Force MPI onto the 56 Gb FDR fabric. UCX_TLS is what does this: with rc
## (RDMA) and no tcp in the list, UCX fails loudly rather than silently
## dropping to the 1 GbE management network and reporting a meaningless number.
##
## Do NOT add UCX_NET_DEVICES. The IB device is named for its PCI slot and the
## name differs by node type (ibp129s0 on cpu, ibp161s0 on gpu), so any single
## value is wrong on half the cluster. Autodetect also benchmarked faster on
## Raijin. If you ever must pin it, name every device: ibp129s0:1,ibp161s0:1
export UCX_TLS=rc,sm,self
export OMPI_MCA_pml=ucx

ulimit -l unlimited
ulimit -n 65536

% if gpu_enabled:
export MFC_GPU=1
## One rank per visible device; MFC's OpenACC path assumes this mapping.
export UCX_MEMTYPE_CACHE=n
% endif

echo "host        : $(hostname -s)"
echo "nodes/tasks : ${nodes} x ${tasks_per_node}"
echo "mpirun      : $(command -v mpirun || echo NOT-FOUND)"
echo "fabric      : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${'${UCX_TLS}'})"
echo

% for target in targets:
    ${helpers.run_prologue(target)}

    % if not mpi:
        (set -x; ${profiler} "${target.get_install_binpath(case)}")
    % else:
        (set -x; ${profiler}                            \
            mpirun -np ${nodes*tasks_per_node}          \
                   --map-by ppr:${tasks_per_node}:node  \
                   --bind-to core                       \
                   "${target.get_install_binpath(case)}")
    % endif

    ${helpers.run_epilogue(target)}

    echo
% endfor

${helpers.template_epilogue()}
