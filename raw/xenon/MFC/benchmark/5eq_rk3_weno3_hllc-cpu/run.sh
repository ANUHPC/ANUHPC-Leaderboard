#!/usr/bin/env bash



#SBATCH --job-name="mfc-5eq-rk3-weno3-hllc-cpu"
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=4
#SBATCH --output="mfc-5eq-rk3-weno3-hllc-cpu.out"
#SBATCH --error="mfc-5eq-rk3-weno3-hllc-cpu.err"
#SBATCH --time=01:00:00
#SBATCH --hint=nomultithread
#SBATCH --partition=cpu
#SBATCH --exclusive


    #>
    #> The MFC prologue prints a summary of the running job and starts a timer.
    #>

    . "/work/mfc/5.6.1-gcc13-ompi5/haswell/toolchain/util.sh"

    TABLE_FORMAT_LINE="| * %-14s $MAGENTA%-35s$COLOR_RESET * %-14s $MAGENTA%-35s$COLOR_RESET |\\n"
    TABLE_HEADER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_FOOTER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_TITLE_FORMAT="| %-105s |\\n"
    TABLE_CONTENT=$(cat <<-END
$(printf "$TABLE_FORMAT_LINE" "Start-time"   "$(date +%T)"                    "Start-date" "$(date +%T)")
$(printf "$TABLE_FORMAT_LINE" "Partition"    "cpu"          "Walltime"   "01:00:00")
$(printf "$TABLE_FORMAT_LINE" "Account"      "N/A"          "Nodes"      "1")
$(printf "$TABLE_FORMAT_LINE" "Job Name"     "mfc-5eq-rk3-weno3-hllc-cpu"                        "Engine"     "batch")
$(printf "$TABLE_FORMAT_LINE" "QoS"          "N/A" "Binary"     "N/A")
$(printf "$TABLE_FORMAT_LINE" "Queue System" "SLURM"                "Email"      "N/A")
END
)

    printf "$TABLE_HEADER"
    printf "$TABLE_TITLE_FORMAT" "MFC case # mfc-5eq-rk3-weno3-hllc-cpu @ /scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/case.py:"
    printf "$TABLE_HEADER"
    printf "$TABLE_CONTENT\\n"
    printf "$TABLE_FOOTER\\n"


    t_start=$(date +%s)


. "/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/mfc-environment.sh" none || exit 1


ulimit -l unlimited
ulimit -n 65536

echo "host        : $(hostname -s)"
echo "nodes/tasks : 1 x 4"
echo "mpirun      : $(command -v mpirun || echo NOT-FOUND)"
echo "fabric      : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"
echo

    
    ok ":) Running$MAGENTA syscheck$COLOR_RESET:\n"

    cd '/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu'

    t_syscheck_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 4                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-ccca43eb0a/bin/syscheck")

    
    code=$?

    t_syscheck_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-ccca43eb0a/bin/syscheck$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/haswell'

        cat >>'/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/summary.yaml' <<EOL
syscheck:
    exec:  $(echo "$t_syscheck_stop - $t_syscheck_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA pre_process$COLOR_RESET:\n"

    cd '/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu'

    t_pre_process_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 4                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-77ad0e446d/bin/pre_process")

    
    code=$?

    t_pre_process_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-77ad0e446d/bin/pre_process$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/haswell'

        cat >>'/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/summary.yaml' <<EOL
pre_process:
    exec:  $(echo "$t_pre_process_stop - $t_pre_process_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA simulation$COLOR_RESET:\n"

    cd '/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu'

    t_simulation_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 4                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-503a859d02/bin/simulation")

    
    code=$?

    t_simulation_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/haswell/build/install/cpu-503a859d02/bin/simulation$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/haswell'

        cat >>'/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/summary.yaml' <<EOL
simulation:
    exec:  $(echo "$t_simulation_stop - $t_simulation_start" | bc -l)
    grind: $(cat '/scratch/jobs/35187881911/MFC/benchmark/5eq_rk3_weno3_hllc-cpu/time_data.dat' | tail -n 1 | awk '{print $NF}')
EOL

        cd - > /dev/null



    echo


    #>
    #> The MFC epilogue stops the timer and prints the execution summary. It also
    #> performs some cleanup and housekeeping tasks before exiting.
    #>

    code=$?

    t_stop="$(date +%s)"

    printf "$TABLE_HEADER"
    printf "$TABLE_TITLE_FORMAT" "Finished mfc-5eq-rk3-weno3-hllc-cpu:"
    printf "$TABLE_FORMAT_LINE"  "Total-time:" "$(expr $t_stop - $t_start)s" "Exit Code:" "$code"
    printf "$TABLE_FORMAT_LINE"  "End-time:"   "$(date +%T)"                 "End-date:"  "$(date +%T)"
    printf "$TABLE_FOOTER"

    exit $code

