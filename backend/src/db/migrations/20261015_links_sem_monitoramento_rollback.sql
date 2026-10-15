-- Rollback de 20261015_links_sem_monitoramento.sql (PostgreSQL)
-- Remove a flag e a associação opcional. Não toca em nenhum outro dado.
-- Observação: ao reverter, dispositivos que foram pausados por um link
-- permanecem com ativo=FALSE (o rollback não os reativa); reative-os pela tela
-- de dispositivos se necessário.

ALTER TABLE links_dedicados
  DROP CONSTRAINT IF EXISTS links_dedicados_dispositivo_fk;

DROP INDEX IF EXISTS idx_links_dispositivo;

ALTER TABLE links_dedicados
  DROP COLUMN IF EXISTS dispositivo_id,
  DROP COLUMN IF EXISTS sem_monitoramento;
