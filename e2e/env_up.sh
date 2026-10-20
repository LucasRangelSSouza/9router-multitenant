#!/bin/bash
# Sobe o ambiente local de teste do gateway: rede g-net, 5 mocks de modelo e o gateway.
# Uso: g_env_up.sh <imagem> [nome=g-gw] [porta=22140] ; segredos so em variaveis de ambiente do processo.
export MSYS_NO_PATHCONV=1
IMG=${1:-g-gw:patched}; NAME=${2:-g-gw}; PORT=${3:-22140}
TOKEN_FILE=${G_TOKEN_FILE:-$(dirname "$0")/.admin_token}
[ -f "$TOKEN_FILE" ] || python -c "import secrets;print(secrets.token_urlsafe(48))" > "$TOKEN_FILE"
TOKEN=$(cat "$TOKEN_FILE")
docker network create g-net >/dev/null 2>&1
for i in 1 2 3 4 5; do
  docker rm -f g-mock-$i >/dev/null 2>&1
  docker run -d --name g-mock-$i --network g-net -e MOCK_ID=$i -e LATENCY=${LATENCY:-0.2} g-mock:local >/dev/null
done
docker rm -f $NAME >/dev/null 2>&1
docker volume rm ${NAME}-data >/dev/null 2>&1
docker run -d --name $NAME --network g-net -p 127.0.0.1:$PORT:20128 --memory 768m --cpus 1.5 \
  -e INITIAL_PASSWORD=gpass123 -e DATA_DIR=/app/data -e PORT=20128 -e HOSTNAME=0.0.0.0 -e NODE_ENV=production \
  -e MT_STRICT=1 -e MT_ADMIN_TOKEN="$TOKEN" -e MT_ALLOW_PRIVATE_URLS=${MT_ALLOW_PRIVATE_URLS:-1} \
  -v ${NAME}-data:/app/data $IMG >/dev/null
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/api/health | grep -q 200 && echo "gateway up ($NAME $IMG :$PORT)" && exit 0
  sleep 2
done
echo "gateway nao subiu"; docker logs $NAME | tail -20; exit 1
