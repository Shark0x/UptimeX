#!/usr/bin/env bash
# ============================================================
#  Instalador do uptimeX (Docker) — Linux
#  Uso: bash instalar.sh
# ============================================================
set -euo pipefail

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
falha() { printf '\033[31mERRO: %s\033[0m\n' "$*"; exit 1; }

# ---- 1. pre-requisitos ----
command -v docker >/dev/null 2>&1 || falha "Docker nao encontrado. Instale: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || falha "Plugin 'docker compose' nao encontrado (instale o docker-compose-plugin)."
[ -f docker-compose.yml ] || falha "Execute este script na raiz do projeto (onde esta o docker-compose.yml)."

# ---- 2. .env com senhas geradas ----
if [ ! -f .env ]; then
  gerar() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
  MYSQL_PASS="$(gerar 24)"
  JWT="$(gerar 48)"
  sed -e "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_PASS}|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" \
      .env.docker.example > .env
  verde ".env criado com senhas aleatorias (MYSQL_ROOT_PASSWORD e JWT_SECRET)."
  echo "   Quer alertas no Telegram? Edite o .env depois e rode: docker compose restart backend"
else
  echo ".env ja existe — mantendo o atual."
fi

# ---- 3. build + subir ----
verde "Construindo e subindo os containers (a primeira vez demora alguns minutos)..."
docker compose up -d --build

# ---- 4. aguardar o backend (que tambem cria/migra o banco) ----
printf 'Aguardando backend e banco'
ok=""
for i in $(seq 1 60); do
  if docker compose logs backend 2>/dev/null | grep -q "rodando na porta 4000"; then ok=1; break; fi
  printf '.'; sleep 2
done
echo
[ -n "$ok" ] || falha "Backend nao subiu em 120s. Investigue com: docker compose logs backend"
verde "Backend no ar — banco criado e migrado."

# ---- 5. restaurar dados trazidos de casa (opcional) ----
if [ -f backup-netmonitor.sql ]; then
  printf 'Restaurar os dados do backup-netmonitor.sql (empresas, dispositivos, usuarios)? [S/n] '
  read -r resp || resp=S
  case "${resp:-S}" in
    n|N) echo "Backup ignorado — banco comeca vazio." ;;
    *)
      docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' < backup-netmonitor.sql
      docker compose restart backend >/dev/null
      verde "Dados restaurados! Use os mesmos logins de casa."
      if [ -d backend/uploads ] && [ -n "$(ls -A backend/uploads 2>/dev/null)" ]; then
        docker compose cp backend/uploads/. backend:/app/uploads/ >/dev/null && verde "Fotos das empresas copiadas."
      fi
      ;;
  esac
fi

# ---- 6. resumo ----
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORTA="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
verde "============================================"
verde " uptimeX instalado e rodando!"
echo  " Acesse:  http://${IP:-IP_DA_MAQUINA}:${PORTA:-8080}"
echo  " Status:  docker compose ps"
echo  " Logs:    docker compose logs -f backend"
if docker compose logs backend 2>/dev/null | grep -q "CONTA ADMIN"; then
  echo " Senha inicial do admin (anote, aparece so uma vez):"
  docker compose logs backend | grep -B1 -A3 "CONTA ADMIN" | tail -5
fi
verde "============================================"
