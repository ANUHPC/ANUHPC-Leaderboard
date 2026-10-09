#!/usr/bin/env bash



#SBATCH --job-name="mfc-h100-hllc-01"
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --output="mfc-h100-hllc-01.out"
#SBATCH --error="mfc-h100-hllc-01.err"
#SBATCH --time=01:00:00
#SBATCH --hint=nomultithread
#SBATCH --exclusive
#SBATCH --partition=all
#SBATCH --gres=gpu:2


    #>
    #> The MFC prologue prints a summary of the running job and starts a timer.
    #>

    . "/data/mfc/current/emr-acc/toolchain/util.sh"

    TABLE_FORMAT_LINE="| * %-14s $MAGENTA%-35s$COLOR_RESET * %-14s $MAGENTA%-35s$COLOR_RESET |\\n"
    TABLE_HEADER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_FOOTER="+-----------------------------------------------------------------------------------------------------------+ \\n"
    TABLE_TITLE_FORMAT="| %-105s |\\n"
    TABLE_CONTENT=$(cat <<-END
$(printf "$TABLE_FORMAT_LINE" "Start-time"   "$(date +%T)"                    "Start-date" "$(date +%T)")
$(printf "$TABLE_FORMAT_LINE" "Partition"    "all"          "Walltime"   "01:00:00")
$(printf "$TABLE_FORMAT_LINE" "Account"      "N/A"          "Nodes"      "1")
$(printf "$TABLE_FORMAT_LINE" "Job Name"     "mfc-h100-hllc-01"                        "Engine"     "batch")
$(printf "$TABLE_FORMAT_LINE" "QoS"          "N/A" "Binary"     "N/A")
$(printf "$TABLE_FORMAT_LINE" "Queue System" "SLURM"                "Email"      "N/A")
END
)

    printf "$TABLE_HEADER"
    printf "$TABLE_TITLE_FORMAT" "MFC case # mfc-h100-hllc-01 @ /data/jobs/36817096579/MFC/Ayush/h100-hllc-01/case.py:"
    printf "$TABLE_HEADER"
    printf "$TABLE_CONTENT\\n"
    printf "$TABLE_FOOTER\\n"


    t_start=$(date +%s)


. "/data/jobs/36817096579/MFC/Ayush/h100-hllc-01/mfc-environment.sh" acc launchpad || exit 1

ulimit -l unlimited
ulimit -n 65536

echo "host        : $(hostname -s)"
echo "nodes/tasks : 1 x 2"
echo "mpirun      : $(command -v mpirun || echo NOT-FOUND)"
echo "UCX_TLS     : ${UCX_TLS}"
nvidia-smi --query-gpu=index,name,memory.used --format=csv,noheader
echo

    
    ok ":) Running$MAGENTA syscheck$COLOR_RESET:\n"

    cd '/data/jobs/36817096579/MFC/Ayush/h100-hllc-01'

    t_syscheck_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 2                             --map-by core                                           --bind-to core                                          "/data/mfc/current/emr-acc/build/install/gpu-acc-869e78ff84/bin/syscheck")

    
    code=$?

    t_syscheck_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/data/mfc/current/emr-acc/build/install/gpu-acc-869e78ff84/bin/syscheck$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/data/mfc/current/emr-acc'

        cat >>'/data/jobs/36817096579/MFC/Ayush/h100-hllc-01/summary.yaml' <<EOL
syscheck:
    exec:  $(echo "$t_syscheck_stop - $t_syscheck_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA pre_process$COLOR_RESET:\n"

    cd '/data/jobs/36817096579/MFC/Ayush/h100-hllc-01'

    t_pre_process_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 2                             --map-by core                                           --bind-to core                                          "/data/mfc/current/emr-acc/build/install/gpu-acc-7d1e32e277/bin/pre_process")

    
    code=$?

    t_pre_process_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/data/mfc/current/emr-acc/build/install/gpu-acc-7d1e32e277/bin/pre_process$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/data/mfc/current/emr-acc'

        cat >>'/data/jobs/36817096579/MFC/Ayush/h100-hllc-01/summary.yaml' <<EOL
pre_process:
    exec:  $(echo "$t_pre_process_stop - $t_pre_process_start" | bc -l)
EOL

        cd - > /dev/null



    echo
    
    ok ":) Running$MAGENTA simulation$COLOR_RESET:\n"

    cd '/data/jobs/36817096579/MFC/Ayush/h100-hllc-01'

    t_simulation_start=$(python3 -c 'import time; print(time.time())')


        (set -x;                                         mpirun -np 2                             --map-by core                                           --bind-to core                                          "/data/mfc/current/emr-acc/build/install/gpu-acc-c819d00b45/bin/simulation")

    
    code=$?

    t_simulation_stop=$(python3 -c 'import time; print(time.time())')


    if [ $code -eq 22 ]; then
        echo
        error "$YELLOW CASE FILE ERROR$COLOR_RESET > $YELLOW Case file has prohibited conditions as stated above.$COLOR_RESET"
    fi

    if [ $code -ne 0 ]; then
        echo
        error ":( $MAGENTA/data/mfc/current/emr-acc/build/install/gpu-acc-c819d00b45/bin/simulation$COLOR_RESET failed with exit code $MAGENTA$code$COLOR_RESET."
        echo
        exit 1
    fi


        cd '/data/mfc/current/emr-acc'

        cat >>'/data/jobs/36817096579/MFC/Ayush/h100-hllc-01/summary.yaml' <<EOL
simulation:
    exec:  $(echo "$t_simulation_stop - $t_simulation_start" | bc -l)
    grind: $(cat '/data/jobs/36817096579/MFC/Ayush/h100-hllc-01/time_data.dat' | tail -n 1 | awk '{print $NF}')
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
    printf "$TABLE_TITLE_FORMAT" "Finished mfc-h100-hllc-01:"
    printf "$TABLE_FORMAT_LINE"  "Total-time:" "$(expr $t_stop - $t_start)s" "Exit Code:" "$code"
    printf "$TABLE_FORMAT_LINE"  "End-time:"   "$(date +%T)"                 "End-date:"  "$(date +%T)"
    printf "$TABLE_FOOTER"

    exit $code

