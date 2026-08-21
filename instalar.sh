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

# ---- 2. .env com TODOS os segredos gerados ----
# O compose exige (com :?) as 3 senhas do Postgres (owner/app/worker), a chave de
# criptografia e a senha do admin. Geramos todas aleatorias — sem placeholders.
# MYSQL_ROOT_PASSWORD so e usado na migracao opcional (profile 'migration').
if [ ! -f .env ]; then
  [ -f .env.docker.example ] || falha "Falta o .env.docker.example (modelo do .env)."
  # so letras+numeros: seguro pra passar pelo sed sem escapar caracteres especiais
  gerar() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
  # senha do admin com maiuscula+minuscula+numero garantidos (regra de senha forte)
  gerar_admin() { printf 'Ax7%s' "$(gerar 21)"; }

  MYSQL_ROOT_PASSWORD="$(gerar 28)"
  POSTGRES_PASSWORD="$(gerar 28)"
  POSTGRES_APP_PASSWORD="$(gerar 28)"
  POSTGRES_WORKER_PASSWORD="$(gerar 28)"
  DATA_ENCRYPTION_KEY="$(gerar 48)"
  SEED_ADMIN_PASSWORD="$(gerar_admin)"

  sed -e "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
      -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=${POSTGRES_APP_PASSWORD}|" \
      -e "s|^POSTGRES_WORKER_PASSWORD=.*|POSTGRES_WORKER_PASSWORD=${POSTGRES_WORKER_PASSWORD}|" \
      -e "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=${DATA_ENCRYPTION_KEY}|" \
      -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}|" \
      .env.docker.example > .env
  chmod 600 .env 2>/dev/null || true

  # Confere que nenhum "troque_por" sobrou (evita subir com placeholder inseguro)
  if grep -q 'troque_por' .env; then
    falha "Sobrou algum placeholder no .env. Confira o .env.docker.example e rode de novo."
  fi
  verde ".env criado com TODOS os segredos aleatorios (Postgres, criptografia, admin)."
  echo "   Guarde a senha do admin mostrada no final desta instalacao."
  echo "   Quer alertas no Telegram? Edite o .env depois e rode: docker compose restart backend"
else
  echo ".env ja existe — mantendo o atual (nenhum segredo foi sobrescrito)."
fi

# ---- 3. build + subir ----
verde "Construindo e subindo os containers (a primeira vez demora alguns minutos)..."
docker compose up -d --build

# ---- 4. aguardar o backend (o schema/RLS vem do container Postgres) ----
printf 'Aguardando backend e banco'
ok=""
for i in $(seq 1 60); do
  if docker compose logs backend 2>/dev/null | grep -q "backend rodando em"; then ok=1; break; fi
  printf '.'; sleep 2
done
echo
[ -n "$ok" ] || falha "Backend nao subiu em 120s. Investigue com: docker compose logs backend"
verde "Backend no ar — schema/RLS criados pelo container Postgres e admin semeado."

# ---- 5. dados de uma instalacao MySQL antiga (opcional) ----
if [ -f backup-netmonitor.sql ]; then
  echo
  verde "Encontrei backup-netmonitor.sql (dados de uma instalacao MySQL antiga)."
  echo "   A migracao MySQL -> PostgreSQL roda pelo migrador dedicado (profile 'migration'),"
  echo "   nao por este instalador. Passo a passo em DEPLOY.md, secao \"Levando os dados atuais\":"
  echo "     1) preencha MYSQL_ROOT_PASSWORD no .env"
  echo "     2) docker compose --profile migration up -d mysql  (e restaure o dump nele)"
  echo "     3) docker compose --profile migration run --rm postgres-migrator"
fi

# ---- 6. resumo ----
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORTA="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
ADMIN_PASS="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2- || true)"
verde "============================================"
verde " uptimeX instalado e rodando!"
echo  " Acesse:  http://${IP:-IP_DA_MAQUINA}:${PORTA:-8080}"
echo  " Status:  docker compose ps"
echo  " Logs:    docker compose logs -f backend"
echo
if docker compose logs backend 2>/dev/null | grep -qi "admin ja existente"; then
  echo " Banco ja tinha um admin — use o login de sempre."
else
  echo " Login inicial:"
  echo "   usuario: admin"
  echo "   senha:   ${ADMIN_PASS:-veja SEED_ADMIN_PASSWORD no .env}"
  echo "   (troque a senha no menu de perfil apos o primeiro login)"
fi
verde "============================================"
