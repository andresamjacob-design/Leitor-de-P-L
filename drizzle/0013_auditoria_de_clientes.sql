-- Cliente também entra na auditoria (D171).
--
-- Renomear ou apagar um cliente muda a quem cada recebimento pertence — na Emissão de NF
-- (D170), o nome do cliente é o que casa com a linha da planilha. A 0001 só auditava o razão,
-- e a mudança de nome da ORC precisou ser registrada à mão. O gatilho é o mesmo dos outros.
CREATE TRIGGER "clients_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "clients"
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
