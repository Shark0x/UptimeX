# uptimeX — Deploy com Docker

Sobe **PostgreSQL + backend + site** com um comando. O banco nasce pronto no
primeiro boot: o container PostgreSQL cria o schema, as roles e as políticas de
segurança (RLS), e o backend semeia o usuário `admin`.

## ⚡ Instalação automática (recomendado)

Os scripts fazem tudo: verificam o Docker, criam o `.env` com senhas
aleatórias, sobem os containers, **inicializam o banco** e perguntam se você quer
restaurar os dados trazidos de casa (`backup-netmonitor.sql`).

```
# Linux
bash instalar.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File instalar.ps1
```

No fim, ele mostra o endereço de acesso e a senha inicial do admin.
Os passos manuais abaixo são o mesmo processo, pra quem preferir controlar.

## Pré-requisito
Docker instalado na máquina (Docker Desktop no Windows, ou `docker` + plugin
`compose` no Linux). Teste com: `docker compose version`

## Passo a passo (primeira vez)

1. Copie a pasta do projeto inteira pra máquina da empresa.

2. Na raiz do projeto (onde está o `docker-compose.yml`):
   ```
   cp .env.docker.example .env
   ```
   Edite o `.env` e troque **todos** os `troque_por_...` por valores fortes:
   as três senhas do Postgres (`POSTGRES_PASSWORD` do owner, `POSTGRES_APP_PASSWORD`
   da API e `POSTGRES_WORKER_PASSWORD` do motor), a chave `DATA_ENCRYPTION_KEY`
   (32+ caracteres, ex: `openssl rand -base64 48`) e `SEED_ADMIN_PASSWORD`
   (senha do admin, 12+ com maiúscula, minúscula e número).
   Se quiser os alertas, preencha também `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.
   O `MYSQL_ROOT_PASSWORD` só é usado se você for **migrar** dados de uma
   instalação MySQL antiga (veja a seção abaixo); numa instalação nova, ignore.
   (O `instalar.sh`/`instalar.ps1` gera todos esses segredos automaticamente.)

3. Suba tudo:
   ```
   docker compose up -d --build
   ```
   (a primeira vez demora alguns minutos baixando imagens e compilando)

4. Acompanhe o boot e confira a criação do admin:
   ```
   docker compose logs -f backend
   ```
   Procure por `conta admin inicial "admin" criada`. A senha é a que você
   colocou em `SEED_ADMIN_PASSWORD` (nunca aparece no log). O log também
   confirma "Alertas Telegram: ATIVOS".

5. Acesse: `http://IP_DA_MAQUINA:8080` (usuário `admin`).
   No celular, mesmo endereço — e dá pra "Adicionar à tela inicial".

## Levando os dados atuais (migração de uma instalação MySQL antiga)

Quem já rodava o sistema em **MySQL** leva os dados pro PostgreSQL com o
migrador dedicado, que **só lê** o MySQL e preenche o Postgres numa única
transação (preserva IDs, hashes bcrypt e timestamps). O MySQL entra em cena
apenas aqui — pelo profile `migration` do compose — e fica desligado no dia a dia.

1. Deixe o stack já no ar (passo 3) e preencha `MYSQL_ROOT_PASSWORD` no `.env`.

2. Suba o MySQL de migração e restaure o retrato de casa (`backup-netmonitor.sql`):
   ```
   docker compose --profile migration up -d mysql
   docker compose --profile migration exec -T mysql \
     sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS netmonitor"'
   docker compose --profile migration exec -T mysql \
     sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' < backup-netmonitor.sql
   ```

3. Rode o migrador uma única vez e desligue o MySQL:
   ```
   docker compose --profile migration run --rm postgres-migrator
   docker compose --profile migration stop mysql
   docker compose restart backend
   ```

O restart do backend faz o motor reconhecer os dispositivos migrados.
Importante: a migração traz também os USUÁRIOS de casa (kevin/admin com as
mesmas senhas) — o admin semeado no primeiro boot deixa de ser o único.
Detalhes e validação do migrador em `postgres/README.md`.

As fotos das empresas ficam em `backend/uploads/`. Pra levá-las pro volume:

```
docker compose cp backend/uploads/. backend:/app/uploads/
# O backend roda como usuario `node`; ajuste a propriedade do volume apos copiar
# arquivos de uma instalacao antiga (que normalmente pertencem a root).
docker run --rm -v uptimex_uploads_data:/data alpine:3.20 chown -R 1000:1000 /data
```

## Dia a dia

| Ação | Comando |
|---|---|
| Ver status | `docker compose ps` |
| Ver logs do backend | `docker compose logs -f backend` |
| Reiniciar tudo | `docker compose restart` |
| Parar | `docker compose down` (dados ficam salvos) |
| Atualizar após mudar o código | `docker compose up -d --build` |

## Backup do banco
```
docker compose exec -T postgres pg_dump -U uptimex_owner -d uptimex > backup-uptimex.sql
```
Guarde esse arquivo. Pra restaurar num banco vazio:
```
docker compose exec -T postgres psql -U uptimex_owner -d uptimex < backup-uptimex.sql
```

## Como funciona por dentro
- O site (nginx, porta 8080) serve o frontend e faz proxy de `/api`,
  `/socket.io` e `/uploads` pro backend — **uma porta só**, sem CORS.
- PostgreSQL e backend ficam na rede interna do Docker (não expostos pra fora).
  A API fala com o banco como `uptimex_app` (sujeita ao RLS por empresa) e o
  motor como `uptimex_worker` — nunca como owner.
- Dados persistem nos volumes `postgres_data` (banco) e `uploads_data` (fotos),
  sobrevivendo a rebuilds e reinícios.
- `restart: unless-stopped`: tudo volta sozinho se a máquina reiniciar.
