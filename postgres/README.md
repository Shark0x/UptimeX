# Migração segura MySQL → PostgreSQL 17 com RLS

Esta estrutura deixa os dois bancos em paralelo. O MySQL permanece como origem e
rollback até o backend ser adaptado e homologado. Nenhuma porta de banco é publicada
no host.

## Modelo de segurança

- `uptimex_owner`: proprietário/migração; nunca deve ser usado pela API.
- `uptimex_app`: API HTTP, sem `SUPERUSER` e sem `BYPASSRLS`.
- `uptimex_worker`: coleta ICMP/SNMP, limitada às tabelas operacionais.
- `usuario_empresas`: associação N:N entre usuários e tenants.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` em todas as tabelas.
- FKs compostas impedem ligar dispositivo/nó/enlace de empresas diferentes.

O RLS usa uma variável local de transação:

```sql
BEGIN;
SELECT set_config('app.user_id', '42', true);
-- queries da requisição
COMMIT;
```

O terceiro argumento `true` torna o valor local à transação e evita vazamento de
contexto entre conexões reutilizadas pelo pool. Cada requisição autenticada deverá
usar uma transação. O login deverá chamar `auth_obter_usuario($1)`.

## Preparação

1. Instale/inicie Docker Desktop.
2. Copie `.env.docker.example` para `.env` e gere senhas diferentes e aleatórias.
3. Suba somente o PostgreSQL:

```powershell
docker compose up -d postgres
docker compose ps postgres
```

Os arquivos em `postgres/init` rodam apenas quando `postgres_data` está vazio.
Não apague um volume com dados sem backup e autorização explícita.

## Teste do RLS antes da migração

```powershell
Get-Content -Raw postgres/tests/rls-smoke.sql |
  docker compose exec -T postgres psql -U uptimex_owner -d uptimex
```

O teste usa uma transação e termina com `ROLLBACK`.

## Migração dos dados

Faça backup do MySQL e execute uma única vez:

```powershell
docker compose --profile migration run --rm postgres-migrator
```

O migrador:

- somente lê o MySQL;
- limpa e preenche o PostgreSQL dentro de uma única transação;
- preserva IDs, hashes bcrypt e timestamps;
- ajusta as sequences;
- vincula administradores ativos a todas as empresas;
- deixa visualizadores sem empresa por padrão;
- executa `ROLLBACK` integral se qualquer registro falhar.

## Validação

Compare contagens nos dois bancos e rode novamente o smoke test. Confira manualmente:

- empresas, dispositivos e históricos;
- nós e enlaces da topologia;
- links dedicados;
- usuários e associações em `usuario_empresas`;
- antenas e métricas;
- auditoria.

## Contrato para adaptação do backend

Antes do corte, o backend precisa:

1. usar o driver `pg` e placeholders `$1`, `$2`;
2. conectar a API como `uptimex_app`, nunca como owner;
3. conectar o monitor como `uptimex_worker` em pool separado;
4. abrir transação e definir `app.user_id` em toda requisição autenticada;
5. usar `auth_obter_usuario($1)` no login;
6. tratar o board de antenas como global admin-only (sem `empresa_id`);
7. não retornar `comunidade_snmp` em respostas comuns;
8. validar autorização também no Socket.IO — RLS não protege salas WebSocket;
9. manter o MySQL intacto até os testes de regressão e autorização passarem.

RLS protege contra queries que esquecem o filtro de tenant. Ele não substitui RBAC,
validação de entrada, autenticação, autorização do WebSocket ou criptografia de segredos.
