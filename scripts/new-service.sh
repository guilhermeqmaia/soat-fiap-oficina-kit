#!/usr/bin/env bash
# Gera um microsservico a partir de templates/service/ (US-F4-01 / US-F4-04).
#   scripts/new-service.sh <servico> <destino> [porta] [nodePort] ["descricao"]
#   ex.: scripts/new-service.sh billing ../soat-fiap-oficina-billing-service 3001 30081 "Orcamento, aprovacao e pagamento"
set -euo pipefail
SERVICE=${1:?servico (ex.: billing)}; DEST=${2:?destino}; PORT=${3:-3000}; NODE_PORT=${4:-30080}; DESC=${5:-"Microsservico $SERVICE"}
REPO="soat-fiap-oficina-${SERVICE}-service"; NAME="oficina-${SERVICE}-service"; DB="oficina_${SERVICE}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/templates/service"
[ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null | grep -v '^\.git$' || true)" ] && { echo "destino nao vazio: $DEST" >&2; exit 1; }
mkdir -p "$DEST" && cp -R "$SRC"/. "$DEST"/
# substituicao de placeholders (ordem importa: __SERVICE_NAME__ antes de __SERVICE__)
find "$DEST" -type f ! -path '*/.git/*' -print0 | xargs -0 sed -i.bak \
  -e "s|__SERVICE_NAME__|$NAME|g" -e "s|__SERVICE__|$SERVICE|g" -e "s|__REPO__|$REPO|g" \
  -e "s|__DB_NAME__|$DB|g" -e "s|__PORT__|$PORT|g" -e "s|__NODE_PORT__|$NODE_PORT|g" -e "s|__DESCRICAO__|$DESC|g"
find "$DEST" -name '*.bak' -delete
# nomes reais sao mais longos que os placeholders: reformata com o prettier do kit (mesma config)
KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -x "$KIT_ROOT/node_modules/.bin/prettier" ] && "$KIT_ROOT/node_modules/.bin/prettier" --config "$KIT_ROOT/.prettierrc" --write "$DEST" --log-level warn
echo "gerado: $DEST ($NAME · porta $PORT · NodePort $NODE_PORT · banco $DB)"
echo "proximos passos: cd $DEST && npm install && npx prisma generate && npm run typecheck && npm test"
