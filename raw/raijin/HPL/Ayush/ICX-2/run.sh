#!/bin/bash
#SBATCH --nodelist=hpc-02,hpc-03,hpc-04,hpc-05,hpc-06,hpc-07
#SBATCH --job-name=hpl-7node
#SBATCH --nodes=6
#SBATCH --ntasks-per-node=16
#SBATCH --cpus-per-task=1
#SBATCH --partition=batch
#SBATCH --time=02:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err
set -o pipefail

# =========================================================
# 7 NODES: hpc-01 (head) + hpc-02..hpc-07 (SLURM), 16 ranks each = 112.
#
# SLURM only manages hpc-02..07, so sbatch reserves those six (preventing a
# teammate's job landing on top of this run) and hpc-01 is appended to the
# hostfile by hand.
#
# All nodes are addressed by their -ib names (10.0.0.0/24, /etc/hosts), NOT
# their ethernet names. Two reasons:
#   1. "hpc-01" on the management LAN routes through the external bastion via
#      the ProxyJump entry in the NFS-shared ~/.ssh/config, which fails from
#      inside the cluster.
#   2. 192.168.2.105 is contested: a BMC holds the same address as hpc-05's
#      host NIC, so `ssh hpc-05` from hpc-02/03/04/06 reaches the BMC's
#      OpenSSH 5.5 instead of the node and fails host-key negotiation.
# The IB fabric has no such conflict - verified 49/49 IPoIB paths, and
# `ssh 10.0.0.5` returns the genuine hpc-05 from every node.
# =========================================================
HEAD_IB=hpc-01-ib
RPN=16

# =========================================================
# BLAS: OpenBLAS, NOT MKL. Measured on this hardware (E5-2670, Sandy Bridge,
# AVX but no AVX2/FMA):
#   OpenBLAS 0.3.26  24.07 GF/s/core  -> Sandybridge AVX kernel
#   MKL 2026.1       12.50 GF/s/core  -> dispatches SSE4.2, no AVX path exists
# MKL_ENABLE_INSTRUCTIONS=AVX does not help. MKL costs ~46% here.
# =========================================================
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export OMP_PLACES=cores
export OMP_PROC_BIND=close

# =========================================================
# Transport: UCX over InfiniBand (confirmed on rc_verbs/ibp176s0, not TCP).
# Measured in HPL itself, 6 nodes N=80000, back-to-back, same governor:
#   pml=ucx    1.4921e+03 GF/s
#   btl=openib 1.3999e+03 GF/s   -> UCX +6.6%
# (8MB pingpong said ucx 47.3 / openib 37.1 / tcp 0.94 Gbit/s, but pingpong
#  is a poor predictor here - HPL is dominated by many medium messages, not
#  one big stream. The HPL A/B above is the number that decided this.)
# tree-spawn off: node->node ssh would hit the broken hpc-01 ProxyJump entry.
#
# DO NOT pin UCX_NET_DEVICES to a single name. The IB device is named
# inconsistently across this cluster (same MT4099 hardware, same firmware
# 2.40.5000, different udev naming):
#     ibp176s0 -> hpc-01, hpc-02, hpc-04, hpc-06, hpc-07
#     mlx4_0   -> hpc-03, hpc-05
# The common tuning snippet UCX_NET_DEVICES=ibp176s0:1 silently breaks the two
# mlx4_0 nodes. Leaving it unset lets UCX autodetect, which also benchmarked
# fastest (47.3 vs 42.7 Gbit/s when pinned). If you ever must pin it, set BOTH:
#     UCX_NET_DEVICES=ibp176s0:1,mlx4_0:1
# The preflight below verifies any value you do set exists on every node.
# =========================================================
export OMPI_MCA_pml=ucx
export OMPI_MCA_osc=ucx
export OMPI_MCA_btl='^openib,tcp'

# =========================================================
# Transparent Huge Pages MUST stay at "madvise" (the Ubuntu default).
# Setting THP=always with defrag=always was measured to HURT, and worse as
# the matrix grows - the kernel synchronously compacts memory for the huge
# allocations and khugepaged keeps rescanning a footprint that reaches
# 47.6 GiB/node at N=207168:
#   6 nodes N=80000  madvise 1.5012e+03 (74.3% of DGEMM ceiling)
#   6 nodes N=80000  always  1.4264e+03 (70.6%)
#   6 nodes N=120000 always  1.2678e+03 (62.8%)   <- efficiency falling with N
# HPL never calls madvise(MADV_HUGEPAGE), so "madvise" simply means 4K pages.
# =========================================================

ulimit -l unlimited
ulimit -n 65536

# ---------- build hostfile: hpc-01 first, then the SLURM allocation ----------
HOSTFILE=$(mktemp "${TMPDIR:-/tmp}/hpl_hosts.XXXXXX")
trap 'rm -f "$HOSTFILE"' EXIT
echo "$HEAD_IB slots=$RPN" > "$HOSTFILE"
scontrol show hostnames "$SLURM_JOB_NODELIST" | awk -v s="$RPN" '{print $1"-ib slots="s}' >> "$HOSTFILE"
NNODES=$(wc -l < "$HOSTFILE")
NP=$(( NNODES * RPN ))

# ---------- preflight ----------
fail=0
echo "== preflight =="

if ! ldd ./xhpl 2>/dev/null | grep -qi openblas; then
  echo "  FAIL: ./xhpl is not linked against OpenBLAS"; ldd ./xhpl; fail=1
else
  echo "  ok   xhpl -> $(ldd ./xhpl | awk '/openblas/{print $3}')"
fi

# grid must match rank count
P=$(awk 'NR==11{print $1}' HPL.dat); Q=$(awk 'NR==12{print $1}' HPL.dat)
N=$(awk 'NR==6{print $1}' HPL.dat);  NB=$(awk 'NR==8{print $1}' HPL.dat)
if [ $((P*Q)) -ne "$NP" ]; then
  echo "  FAIL: HPL.dat P*Q = $((P*Q)) but launching $NP ranks"; fail=1
else
  echo "  ok   grid ${P}x${Q} = $NP ranks over $NNODES nodes"
fi

# per-node memory: HPL distributes UNIFORMLY, so the smallest node caps N.
# hpc-03/hpc-06 have 128GB but the surplus is unusable.
NEED=$(python3 -c "
N=$N;P=$P;Q=$Q;NB=$NB;rpn=$RPN
lr=-(-N//P); lc=-(-N//Q)
print(round(((lr*(lc+1)*8)+2*(lr*NB*8+NB*lc*8+NB*NB*8))*rpn/2**30,1))")
echo "  need ${NEED} GiB/node (N=$N NB=$NB, uniform across all $NNODES nodes)"
while read -r h _; do
  info=$(ssh -n -o BatchMode=yes -o StrictHostKeyChecking=no "$h" '
      awk "/MemAvailable/{printf \"%.1f \", \$2/1048576}" /proc/meminfo
      d=$(ls /sys/class/infiniband/ 2>/dev/null | head -1)
      printf "%s %s %s %s" "${d:-NONE}" \
        "$(cat /sys/class/infiniband/$d/ports/1/state 2>/dev/null | awk "{print \$2}")" \
        "$(cat /sys/class/infiniband/$d/ports/1/rate 2>/dev/null | awk "{print \$1}")" \
        "$(pgrep -c xhpl)"' 2>/dev/null)
  set -- $info; avail=$1; ibdev=$2; ibstate=$3; ibrate=$4; nxhpl=$5

  if [ -z "$avail" ]; then echo "  FAIL: $h unreachable"; fail=1; continue; fi
  if awk -v a="$avail" -v n="$NEED" 'BEGIN{exit !(a < n*1.05)}'; then
    echo "  FAIL: $h ${avail} GiB avail, needs ${NEED} (+5% margin)"; fail=1; continue
  fi
  if [ "$ibdev" = NONE ] || [ "$ibstate" != ACTIVE ]; then
    echo "  FAIL: $h InfiniBand not ACTIVE (dev=$ibdev state=$ibstate)"; fail=1; continue
  fi
  if [ "${ibrate:-0}" -lt 56 ] 2>/dev/null; then
    echo "  WARN: $h IB rate ${ibrate} Gb/s, expected 56"
  fi
  if [ "${nxhpl:-0}" -gt 0 ]; then
    echo "  FAIL: $h already has $nxhpl xhpl processes running"; fail=1; continue
  fi
  # if UCX_NET_DEVICES is pinned, it must name a device that exists on THIS node
  if [ -n "$UCX_NET_DEVICES" ] && ! echo "$UCX_NET_DEVICES" | grep -q "$ibdev"; then
    echo "  FAIL: $h has $ibdev but UCX_NET_DEVICES='$UCX_NET_DEVICES' omits it"; fail=1; continue
  fi
  thp=$(ssh -n -o BatchMode=yes "$h" 'cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null' 2>/dev/null)
  case "$thp" in *"[always]"*) echo "  WARN: $h has THP=always - measured ~20% slower at large N, set it to madvise";; esac
  echo "  ok   $h ${avail} GiB, $ibdev $ibstate ${ibrate}Gb/s, no stray ranks"
done < "$HOSTFILE"

[ "$fail" -ne 0 ] && { echo "PREFLIGHT FAILED - aborting"; exit 1; }

echo "== launching =="
echo "  hostfile:"; sed 's/^/    /' "$HOSTFILE"

# --mca ras ^slurm: OpenMPI otherwise takes its node list from the SLURM
# allocation and REJECTS hpc-01 as "not present in the allocation". Disabling
# the slurm RAS module makes it honour the hostfile verbatim; plm rsh then
# launches over ssh to all seven.
mpirun --hostfile "$HOSTFILE" -np "$NP" \
  --map-by core --bind-to core \
  --mca ras ^slurm \
  --mca plm rsh --mca plm_rsh_no_tree_spawn 1 \
  -x OMP_NUM_THREADS -x OPENBLAS_NUM_THREADS \
  -x OMP_PLACES -x OMP_PROC_BIND \
  -x LD_LIBRARY_PATH \
  ./xhpl
