-- Link /30 "sem monitoramento" (PostgreSQL)
-- ------------------------------------------------------------------------
-- Adiciona a `links_dedicados` uma flag explícita de "sem monitoramento" e uma
-- associação OPCIONAL e EXPLÍCITA a um dispositivo (escolhido pelo operador).
-- Motivo: um link /30 não tem relação estrutural com o dispositivo pingado — o
-- motor pinga `dispositivos` (WHERE ativo = TRUE), não blocos. Para o toggle do
-- link realmente pausar o ping, o operador precisa indicar QUAL dispositivo o
-- link representa (sem heurística de IP∈CIDR, que casava só 1 de 25 blocos).
--
-- Idempotente e reversível. NÃO altera nenhum registro de ping, status, quedas
-- ou incidentes — apenas acrescenta colunas.

ALTER TABLE links_dedicados
  ADD COLUMN IF NOT EXISTS sem_monitoramento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispositivo_id bigint;

-- Associação tenant-safe: o dispositivo escolhido tem de pertencer à MESMA
-- empresa do link. A FK composta usa a UNIQUE (id, empresa_id) de dispositivos.
-- dispositivo_id é nullable (MATCH SIMPLE): link sem associação não dispara a
-- checagem. ON DELETE SET NULL (dispositivo_id): excluir o device só desfaz o
-- vínculo (zera apenas dispositivo_id, preservando empresa_id NOT NULL), sem
-- apagar o link nem seu histórico.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'links_dedicados_dispositivo_fk'
  ) THEN
    ALTER TABLE links_dedicados
      ADD CONSTRAINT links_dedicados_dispositivo_fk
      FOREIGN KEY (dispositivo_id, empresa_id)
      REFERENCES dispositivos(id, empresa_id)
      ON DELETE SET NULL (dispositivo_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_links_dispositivo ON links_dedicados(dispositivo_id);
