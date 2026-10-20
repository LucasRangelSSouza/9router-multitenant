#!/bin/sh
# Backup consistente do SQLite do gateway (checkpoint do WAL + copia online), para o fluxo de backup existente.
# Uso: backup.sh [destino_no_host=/opt/rt/backups/llm-gateway]
# Restore: parar o container, copiar o arquivo para /app/data/db/data.sqlite (e apagar -wal/-shm), subir.
set -eu
DEST=${1:-/opt/rt/backups/llm-gateway}
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST"
chmod 700 "$DEST"
docker exec llm-gateway node -e "
const D=require('better-sqlite3');
const db=new D('/app/data/db/data.sqlite',{readonly:true});
db.backup('/tmp/gw-backup.sqlite').then(()=>{db.close();console.log('ok')}).catch(e=>{console.error(e);process.exit(1)});
"
docker cp llm-gateway:/tmp/gw-backup.sqlite "$DEST/data-$TS.sqlite"
docker exec llm-gateway rm -f /tmp/gw-backup.sqlite
chmod 600 "$DEST/data-$TS.sqlite"
# integridade antes de considerar o backup bom
docker run --rm -v "$DEST":/b:ro alpine:3 sh -c "apk add -q sqlite >/dev/null && sqlite3 /b/data-$TS.sqlite 'pragma integrity_check;'" | grep -qx ok
echo "backup ok: $DEST/data-$TS.sqlite"
# retencao: mantem os 14 mais recentes (so backups deste script; nada mais e tocado)
ls -1t "$DEST"/data-*.sqlite | tail -n +15 | xargs -r rm -f
