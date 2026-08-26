-- Patch idempotente: anchor por ponta, formato "raio" (wireless) e toggle de rotulos.
-- Aplica no banco JA existente (o initdb so roda em banco novo). Rode como owner
-- da tabela (uptimex_owner), por ex.:
--
--   docker compose exec -T postgres psql -U uptimex_owner -d uptimex \
--     < postgres/migration/patch-enlaces-anchor-raio-labels.sql
--
-- Todas as colunas sao nullable/tem default, entao enlaces antigos seguem iguais
-- (origem_lado/destino_lado NULL = auto; formato NULL = derivado de curvo).

ALTER TABLE antenas_enlaces
  ADD COLUMN IF NOT EXISTS origem_lado  varchar(10),
  ADD COLUMN IF NOT EXISTS destino_lado varchar(10),
  ADD COLUMN IF NOT EXISTS formato      varchar(20),
  ADD COLUMN IF NOT EXISTS mostrar_label boolean NOT NULL DEFAULT true;

ALTER TABLE antenas_viewport
  ADD COLUMN IF NOT EXISTS ocultar_labels boolean NOT NULL DEFAULT false;
