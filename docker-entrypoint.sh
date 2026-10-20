#!/bin/sh
# Entrypoint do container: ajusta permissao do volume e le segredos de arquivo (Docker secrets).
#   MT_ADMIN_TOKEN_FILE=/run/secrets/x  =>  MT_ADMIN_TOKEN=<conteudo>
#   INITIAL_PASSWORD_FILE=...           =>  INITIAL_PASSWORD=<conteudo>
chown -R node:node /app/data /app/data-home 2>/dev/null
chmod 700 /app/data 2>/dev/null
for v in MT_ADMIN_TOKEN INITIAL_PASSWORD; do
  eval "f=\${${v}_FILE}"
  if [ -n "$f" ] && [ -r "$f" ]; then
    export "$v=$(cat "$f")"
  fi
done
exec su-exec node "$@"
