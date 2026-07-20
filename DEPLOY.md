# uptimeX — Deploy com Docker

Sobe **MySQL + backend + site** com um comando. O banco é criado e migrado
sozinho no primeiro boot (tabelas + usuário `admin`).

## ⚡ Instalação automática (recomendado)

Os scripts fazem tudo: verificam o Docker, criam o `.env` com senhas
aleatórias, sobem os containers, **instalam o banco** e perguntam se você quer
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
   Edite o `.env` e preencha `MYSQL_ROOT_PASSWORD`, `JWT_SECRET` e, se quiser
   os alertas, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.
   Dica: defina `SEED_ADMIN_PASSWORD` pra escolher a senha do admin.

3. Suba tudo:
   ```
   docker compose up -d --build
   ```
   (a primeira vez demora alguns minutos baixando imagens e compilando)

4. Acompanhe o boot e pegue a senha do admin (se não definiu no .env):
   ```
   docker compose logs -f backend
   ```
   Procure por "CONTA ADMIN INICIAL CRIADA" e **anote a senha** — ela não
   aparece de novo. O log também confirma "Alertas Telegram: ATIVOS".

5. Acesse: `http://IP_DA_MAQUINA:8080` (usuário `admin`).
   No celular, mesmo endereço — e dá pra "Adicionar à tela inicial".

## Levando os dados atuais (migração do PC de casa)

O arquivo `backup-netmonitor.sql` (na raiz do projeto) tem o retrato do banco
local: empresas, dispositivos, links dedicados, histórico e usuários. Depois do
`docker compose up -d --build` (passo 3), restaure com:

```
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' < backup-netmonitor.sql
docker compose restart backend
```

O restart do backend faz o motor reconhecer os dispositivos restaurados.
Importante: o restore traz também os USUÁRIOS de casa (kevin/admin com as
mesmas senhas) — a senha exibida nos logs do primeiro boot deixa de valer.

As fotos das empresas ficam em `backend/uploads/`. Pra levá-las pro volume:

```
docker compose cp backend/uploads/. backend:/app/uploads/
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
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' > backup-netmonitor.sql
```
Guarde esse arquivo. Pra restaurar:
```
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' < backup-netmonitor.sql
```

## Como funciona por dentro
- O site (nginx, porta 8080) serve o frontend e faz proxy de `/api`,
  `/socket.io` e `/uploads` pro backend — **uma porta só**, sem CORS.
- MySQL e backend ficam na rede interna do Docker (não expostos pra fora).
- Dados persistem nos volumes `mysql_data` (banco) e `uploads_data` (fotos),
  sobrevivendo a rebuilds e reinícios.
- `restart: unless-stopped`: tudo volta sozinho se a máquina reiniciar.
