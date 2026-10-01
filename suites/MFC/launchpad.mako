#!/usr/bin/env bash
##
## MFC batch template for launchpad (scc-connect-03-gpu01).
## 1 node, 2x Xeon Gold 6548Y+, 2x H100 NVL. render.sh picks this when CLUSTER=launchpad.
##
## Keep the helpers.* macros, run_epilogue writes summary.yaml.
##
<%namespace name="helpers" file="helpers.mako"/>
<%! import os %>

% if engine == 'batch':
#SBATCH --job-name="${name}"
#SBATCH --nodes=${nodes}
#SBATCH --ntasks-per-node=${tasks_per_node}
#SBATCH --output="${name}.out"
#SBATCH --error="${name}.err"
#SBATCH --time=${walltime}
#SBATCH --hint=nomultithread
#SBATCH --exclusive
% if partition:
#SBATCH --partition=${partition}
% endif
% if gpu_enabled:
#SBATCH --gres=gpu:${tasks_per_node}
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

. "${os.path.dirname(input)}/mfc-environment.sh" ${'acc' if gpu_enabled else 'none'} launchpad || exit 1

ulimit -l unlimited
ulimit -n 65536

echo "host        : $(hostname -s)"
echo "nodes/tasks : ${nodes} x ${tasks_per_node}"
echo "mpirun      : $(command -v mpirun || echo NOT-FOUND)"
echo "UCX_TLS     : ${'${UCX_TLS}'}"
% if gpu_enabled:
nvidia-smi --query-gpu=index,name,memory.used --format=csv,noheader
% endif
echo

% for target in targets:
    ${helpers.run_prologue(target)}

    % if not mpi:
        (set -x; ${profiler} "${target.get_install_binpath(case)}")
    % else:
## GPU: both H100s are on NUMA 0, so pack ranks onto cores there.
## CPU: spread ranks across both sockets.
        (set -x; ${profiler}                            \
            mpirun -np ${nodes*tasks_per_node}          \
% if gpu_enabled:
                   --map-by core                        \
% else:
                   --map-by socket                      \
% endif
                   --bind-to core                       \
                   "${target.get_install_binpath(case)}")
    % endif

    ${helpers.run_epilogue(target)}

    echo
% endfor

${helpers.template_epilogue()}
