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
export OMPI_PREFIX=/apps/openmpi/5.0.10
export UCX_PREFIX=/apps/ucx/1.22.0
export PATH="$OMPI_PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$OMPI_PREFIX/lib:$UCX_PREFIX/lib:${'${LD_LIBRARY_PATH:-}'}"

## Pin MPI to the 56 Gb FDR fabric. Without this it silently falls back to the
## 1 GbE management network and every multi-node number is meaningless.
export UCX_NET_DEVICES=mlx5_0:1
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
echo "fabric      : ${'${UCX_NET_DEVICES}'}"
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
