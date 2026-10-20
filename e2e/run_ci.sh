#!/bin/bash
# e2e adversarial no CI: sobe 5 mocks + o gateway (imagem $1) e roda G-0 e G-11 com 2 e 5 tenants.
# Uso: bash e2e/run_ci.sh <imagem> [simultaneas_por_tenant=200]
set -eu
export MSYS_NO_PATHCONV=1
IMG=${1:?imagem}
PER=${2:-200}
cd "$(dirname "$0")"
docker build -q -t g-mock:local -f Dockerfile.mock . >/dev/null
export G_URL=http://127.0.0.1:22140
export G_GW_CONTAINER=g-gw
bash env_up.sh "$IMG" g-gw 22140
python g0_spike.py > g0_result.log || true
grep -cE "RESULT .* (FAIL|GAP) " g0_result.log | grep -qx 0 || { cat g0_result.log; echo "G-0 com FAIL"; exit 1; }
for n in 2 5; do
  bash env_up.sh "$IMG" g-gw 22140          # banco limpo a cada rodada
  python g11_isolamento.py "$n" "$PER" | tee "g11_result_${n}.log"
done
