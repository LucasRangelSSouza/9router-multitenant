#!/bin/sh
# Egress do llm-gateway: o container precisa falar com a internet (provedores de LLM),
# mas NAO com a rede interna da VPS (Chatwoot, bancos, Redis, MinIO, metadata, host).
# Rodar como root na VPS DEPOIS de subir a rede llm-gw-net. Idempotente. Reversivel: --remove.
# Complementa o anti-SSRF da aplicacao (src/lib/urlGuard.js), que nao cobre DNS rebinding.
set -eu
NET=llm-gw-net
CHAIN=LLM-GW-EGRESS

subnet=$(docker network inspect "$NET" -f '{{(index .IPAM.Config 0).Subnet}}')

if [ "${1:-}" = "--remove" ]; then
  iptables -D DOCKER-USER -s "$subnet" -j "$CHAIN" 2>/dev/null || true
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
  echo "regras removidas"
  exit 0
fi

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
# trafego dentro da propria rede (consumidores -> gateway) e respostas
iptables -A "$CHAIN" -d "$subnet" -j RETURN
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# nunca para faixas privadas/reservadas/metadata
for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 127.0.0.0/8 100.64.0.0/10 0.0.0.0/8 224.0.0.0/4; do
  iptables -A "$CHAIN" -d "$cidr" -j DROP
done
iptables -A "$CHAIN" -j RETURN
iptables -C DOCKER-USER -s "$subnet" -j "$CHAIN" 2>/dev/null || iptables -I DOCKER-USER 1 -s "$subnet" -j "$CHAIN"
echo "egress de $NET ($subnet) restrito a enderecos publicos"
