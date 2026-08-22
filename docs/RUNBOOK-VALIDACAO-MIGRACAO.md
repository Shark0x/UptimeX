# Runbook — validar a migração MySQL → PostgreSQL antes de tocar na produção

Objetivo: provar, numa **máquina de teste com Docker**, que o código novo
(commit `7ae2b40`+) sobe, migra os dados reais de casa e funciona — **sem
arriscar o servidor de produção**, que hoje roda em MySQL.

Regra de ouro: **nada disto roda na produção**, exceto o passo 0 (backup, que só
lê). O servidor de produção permanece intacto e é o rollback.

---

## Pré-requisitos

- Uma máquina de teste (pode ser seu PC) com **Docker** + plugin `compose`
  (`docker compose version` funciona).
- O repositório atualizado nessa máquina (`git pull`, commit `7ae2b40` ou mais novo).
- Um **dump do MySQL de produção** (`backup-netmonitor.sql`) copiado para a raiz
  do projeto na máquina de teste.

---

## Passo 0 — Backup da produção (no servidor, só-leitura)

`mysqldump` apenas lê; não altera nada. Ajuste o nome do serviço/DB se o seu
compose antigo usava outro (o banco é `netmonitor`).

```bash
# no servidor de produção (compose ANTIGO, MySQL)
docker compose exec -T mysql sh -c \
  'mysqldump --single-transaction --quick --routines --triggers --events \
  -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor' > backup-netmonitor.sql
```

Copie `backup-netmonitor.sql` para a máquina de teste (raiz do projeto).
Use somente um dump do banco `netmonitor`, como o produzido acima. Antes de
seguir, confirme que ele não tenta trocar para um schema de sistema do MySQL:

```bash
# Linux — esperado: nenhuma saída
grep -nEi '^(CREATE DATABASE|USE) .*`?(mysql|sys|performance_schema|information_schema)`?' backup-netmonitor.sql

# Windows (PowerShell) — esperado: nenhuma saída
Select-String -Path .\backup-netmonitor.sql -Pattern '^(CREATE DATABASE|USE) .*`?(mysql|sys|performance_schema|information_schema)`?'
```

Se qualquer comando listar uma linha, **pare**: esse é um dump amplo do servidor,
não o dump isolado esperado por este runbook.

Anote as contagens de referência da produção para comparar depois:

```bash
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor -e "
  SELECT \"empresas\", COUNT(*) FROM empresas
  UNION ALL SELECT \"dispositivos\", COUNT(*) FROM dispositivos
  UNION ALL SELECT \"usuarios\", COUNT(*) FROM usuarios
  UNION ALL SELECT \"ping_metricas\", COUNT(*) FROM ping_metricas
  UNION ALL SELECT \"status_eventos\", COUNT(*) FROM status_eventos
  UNION ALL SELECT \"topologia_nodes\", COUNT(*) FROM topologia_nodes
  UNION ALL SELECT \"topologia_viewport\", COUNT(*) FROM topologia_viewport
  UNION ALL SELECT \"topologia_edges\", COUNT(*) FROM topologia_edges
  UNION ALL SELECT \"links_dedicados\", COUNT(*) FROM links_dedicados
  UNION ALL SELECT \"auditoria\", COUNT(*) FROM auditoria;"'
```

Tabelas criadas em versões mais novas, como `usuario_empresas` e `antenas*`, podem
não existir no MySQL antigo. Isso é esperado: o migrador cria os vínculos dos
admins e deixa os módulos ausentes vazios no PostgreSQL.

---

## Passo 1 — Subir o stack novo (Postgres) na máquina de teste

Gere o `.env` com todos os segredos e suba tudo:

```bash
# Linux
bash instalar.sh
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File instalar.ps1
```

O instalador cria o `.env` (senhas do Postgres owner/app/worker, chave de
criptografia, senha do admin e um `MYSQL_ROOT_PASSWORD` aleatório para o MySQL de
migração), builda e sobe os containers.

Confira o boot do backend (schema/RLS vêm do container Postgres; admin é semeado):

```bash
docker compose logs -f backend
# esperado: bootstrap do admin OK e "backend rodando em ..."
```

Depois de ver a mensagem esperada, pressione `Ctrl+C`; isso encerra somente o
acompanhamento dos logs, não os containers.

Abra `http://localhost:8080` — deve carregar a tela de login (banco ainda vazio,
só com o admin semeado). Ainda **não** valide as telas aqui; primeiro migre os dados.

---

## Passo 2 — Teste de RLS (isolamento multi-tenant)

Roda numa transação e termina em ROLLBACK (não suja o banco):

```bash
# Linux
docker compose exec -T postgres psql -U uptimex_owner -d uptimex < postgres/tests/rls-smoke.sql
# Windows (PowerShell)
Get-Content -Raw postgres/tests/rls-smoke.sql | docker compose exec -T postgres psql -U uptimex_owner -d uptimex
```

Esperado: um não-admin só enxerga as próprias empresas; admin enxerga tudo; a role
`uptimex_app` não lê sessão/usuário de outro. Qualquer FAIL aqui é bloqueador.

---

## Passo 3 — Migrar o dump de produção

O MySQL de migração é um container **separado** (profile `migration`); você
restaura o dump nele e roda o migrador, que só lê o MySQL e preenche o Postgres
numa única transação (preserva IDs, hashes bcrypt e timestamps).

**Atenção:** o migrador executa `TRUNCATE` nas tabelas do PostgreSQL de destino
antes da importação. Neste runbook, o destino deve ser exclusivamente o stack
descartável da máquina de teste criado no Passo 1.

```bash
# 1) sobe o MySQL de migração e espera o healthcheck
docker compose --profile migration up -d --wait mysql

# 2) copia o dump para o container, cria o database e restaura
#    (o mesmo fluxo funciona em Linux e Windows/PowerShell)
docker compose --profile migration cp backup-netmonitor.sql mysql:/tmp/backup-netmonitor.sql

#    Linux:
printf 'CREATE DATABASE IF NOT EXISTS netmonitor;\n' |
  docker compose --profile migration exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'

#    Windows (PowerShell):
'CREATE DATABASE IF NOT EXISTS netmonitor;' |
  docker compose --profile migration exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'

#    restaura (igual nos dois sistemas):
docker compose --profile migration exec -T mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" netmonitor < /tmp/backup-netmonitor.sql'
docker compose --profile migration exec -T mysql rm -f /tmp/backup-netmonitor.sql

# 3) roda o migrador (ROLLBACK total se qualquer registro falhar)
docker compose --profile migration run --rm postgres-migrator

# 4) desliga o MySQL de migração e reinicia o backend (reconhece os dispositivos)
docker compose --profile migration stop mysql
docker compose restart backend
```

Se o migrador abortar, ele não deixa lixo (transação única). Leia o erro, corrija e
rode de novo.

---

## Passo 4 — Conferir as contagens (produção vs migrado)

```bash
docker compose exec -T postgres psql -U uptimex_owner -d uptimex -c "
  SELECT 'empresas' t, COUNT(*) FROM empresas
  UNION ALL SELECT 'dispositivos', COUNT(*) FROM dispositivos
  UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
  UNION ALL SELECT 'ping_metricas', COUNT(*) FROM ping_metricas
  UNION ALL SELECT 'status_eventos', COUNT(*) FROM status_eventos
  UNION ALL SELECT 'topologia_nodes', COUNT(*) FROM topologia_nodes
  UNION ALL SELECT 'topologia_viewport', COUNT(*) FROM topologia_viewport
  UNION ALL SELECT 'topologia_edges', COUNT(*) FROM topologia_edges
  UNION ALL SELECT 'links_dedicados', COUNT(*) FROM links_dedicados
  UNION ALL SELECT 'auditoria', COUNT(*) FROM auditoria
  ORDER BY t;"
```

As contagens devem bater com as anotadas no Passo 0.

Rode novamente o smoke test de RLS agora que os dados reais estão presentes:

```bash
# Linux
docker compose exec -T postgres psql -U uptimex_owner -d uptimex < postgres/tests/rls-smoke.sql
# Windows (PowerShell)
Get-Content -Raw postgres/tests/rls-smoke.sql | docker compose exec -T postgres psql -U uptimex_owner -d uptimex
```

O esperado continua sendo `RLS smoke test: OK`.

Fotos das empresas (se quiser validar imagens): depois de copiar a pasta
`backend/uploads/` da produção para a máquina de teste, envie-a ao volume:

```bash
docker compose cp backend/uploads/. backend:/app/uploads/
# O backend roda como usuario `node`; ajuste a propriedade apos importar fotos
# de uma instalacao antiga, que normalmente pertencem a root.
docker run --rm -v uptimex_uploads_data:/data alpine:3.20 chown -R 1000:1000 /data
```

---

## Passo 5 — Regressão no navegador (`http://localhost:8080`)

Logue com um **usuário do dump** (mesma senha da produção — os hashes são
preservados). Passe por tudo, olhando o **console do navegador** (zero erro):

- [ ] Login como **admin** e como **não-admin** (visão restrita às empresas dele).
- [ ] Configuração: CRUD de empresas e dispositivos.
- [ ] Visão Macro e Mapa TV (radar das empresas).
- [ ] Antenas: board global (só admin), editor e Mapa TV de antenas.
- [ ] Admin: usuários, alertas, chaves MCP, log de acessos.
- [ ] Perfil/avatar e troca de senha.
- [ ] Histórico de ping abrindo num dispositivo.
- [ ] Motor gravando ping/status (deixe rodar alguns minutos; sem erro de
      permissão nos `docker compose logs backend`).

---

## GO / NO-GO

**GO** (pode planejar a produção) somente se **tudo** abaixo passou:

- Passo 2 (RLS) sem FAIL.
- Passo 3 migrou sem abortar.
- Passo 4 com contagens idênticas às da produção.
- Smoke test de RLS repetido após a migração com resultado OK.
- Passo 5 com todas as telas OK e console limpo.

**NO-GO**: qualquer FAIL. Anote o erro/tela e me mande — ajusto o código antes de
qualquer coisa em produção.

---

## Depois do GO — produção (janela de manutenção, runbook à parte)

Só depois de tudo verde: backup fresco da produção → `git pull` no servidor →
preencher as novas variáveis Postgres no `.env` → subir o stack novo → migrar o
dump → validar → manter o MySQL antigo desligado como rollback. Peça o runbook de
produção quando chegar a hora.
