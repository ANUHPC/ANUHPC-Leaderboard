#!/usr/bin/env bash



#SBATCH --job-name="mfc-anu-tgv-3d-a100"
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=4
#SBATCH --output="mfc-anu-tgv-3d-a100.out"
#SBATCH --error="mfc-anu-tgv-3d-a100.err"
#SBATCH --time=01:00:00
#SBATCH --hint=nomultithread
#SBATCH --partition=gpu
#SBATCH --gres=gpu:a100:4
#SBATCH --exclusive


    #>
    #> The MFC prologue prints a summary of the running job and starts a timer.
    #>

    . "/work/mfc/5.6.1-gcc13-ompi5/zen3/toolchain/util.sh"

    TABLE_FORMAT_LINE="| * %-14s $MAGENTA%-35s$COLOR_RESET * %-14s $MAGENTA%-35s$COLOR_RESET |\\n"
    TABLE_HEADER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_FOOTER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_TITLE_FORMAT="| %-105s |\\n"
    TABLE_CONTENT=$(cat <<-END
$(printf "$TABLE_FORMAT_LINE" "Start-time"   "$(date +%T)"                    "Start-date" "$(date +%T)")
$(printf "$TABLE_FORMAT_LINE" "Partition"    "gpu"          "Walltime"   "01:00:00")
$(printf "$TABLE_FORMAT_LINE" "Account"      "N/A"          "Nodes"      "2")
$(printf "$TABLE_FORMAT_LINE" "Job Name"     "mfc-anu-tgv-3d-a100"                        "Engine"     "batch")
$(printf "$TABLE_FORMAT_LINE" "QoS"          "N/A" "Binary"     "N/A")
$(printf "$TABLE_FORMAT_LINE" "Queue System" "SLURM"                "Email"      "N/A")
END
)

    printf "$TABLE_HEADER"
    printf "$TABLE_TITLE_FORMAT" "MFC case # mfc-anu-tgv-3d-a100 @ /scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/case.py:"
    printf "$TABLE_HEADER"
    printf "$TABLE_CONTENT\\n"
    printf "$TABLE_FOOTER\\n"


    t_start=$(date +%s)


. "/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/mfc-environment.sh" acc || exit 1


ulimit -l unlimited
ulimit -n 65536

echo "host        : $(hostname -s)"
echo "nodes/tasks : 2 x 4"
echo "mpirun      : $(command -v mpirun || echo NOT-FOUND)"
echo "fabric      : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"
echo

    
    ok ":) Running$MAGENTA syscheck$COLOR_RESET:\n"

    cd '/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100'

    t_syscheck_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 8                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-869e78ff84/bin/syscheck")

    
    code=$?

    t_syscheck_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-869e78ff84/bin/syscheck$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/zen3'

        cat >>'/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/summary.yaml' <<EOL
syscheck:
    exec:  $(echo "$t_syscheck_stop - $t_syscheck_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA pre_process$COLOR_RESET:\n"

    cd '/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100'

    t_pre_process_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 8                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-7d1e32e277/bin/pre_process")

    
    code=$?

    t_pre_process_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-7d1e32e277/bin/pre_process$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/zen3'

        cat >>'/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/summary.yaml' <<EOL
pre_process:
    exec:  $(echo "$t_pre_process_stop - $t_pre_process_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA simulation$COLOR_RESET:\n"

    cd '/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100'

    t_simulation_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 8                             --map-by ppr:4:node                     --bind-to core                                          "/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-c819d00b45/bin/simulation")

    
    code=$?

    t_simulation_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/work/mfc/5.6.1-gcc13-ompi5/zen3/build/install/gpu-acc-c819d00b45/bin/simulation$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/work/mfc/5.6.1-gcc13-ompi5/zen3'

        cat >>'/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/summary.yaml' <<EOL
simulation:
    exec:  $(echo "$t_simulation_stop - $t_simulation_start" | bc -l)
    grind: $(cat '/scratch/jobs/35219169188/MFC/benchmark/anu_tgv_3d-a100/time_data.dat' | tail -n 1 | awk '{print $NF}')
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
    printf "$TABLE_TITLE_FORMAT" "Finished mfc-anu-tgv-3d-a100:"
    printf "$TABLE_FORMAT_LINE"  "Total-time:" "$(expr $t_stop - $t_start)s" "Exit Code:" "$code"
    printf "$TABLE_FORMAT_LINE"  "End-time:"   "$(date +%T)"                 "End-date:"  "$(date +%T)"
    printf "$TABLE_FOOTER"

    exit $code

