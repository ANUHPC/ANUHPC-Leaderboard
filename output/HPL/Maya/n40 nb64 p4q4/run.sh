mpirun --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core --report-bindings -x OMP_NUM_THREADS -x OMP_PROC_BIND -x OMP_PLACES -x OPENBLAS_NUM_THREADS ./xhpl
