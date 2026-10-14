-- A auditoria só nasce dos gatilhos (D156).
--
-- A 0008 restringiu a inserção manual em `audit_log` a quem escreve, mas um `member` ainda
-- poderia forjar registro — inclusive com outro autor no campo `actor`. Ninguém precisa
-- inserir à mão: os gatilhos `write_audit_log` são SECURITY DEFINER, do dono da tabela, e não
-- passam por política. Sem política de INSERT, o RLS recusa qualquer inserção pela API.
DROP POLICY IF EXISTS "audit_log_insert" ON "audit_log";
