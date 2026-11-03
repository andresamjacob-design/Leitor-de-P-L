-- Extrato lido de prints da tela do banco (D168). O BS2 da GSJacob não exporta pdf nem xlsx.
-- Só acrescenta um valor ao enum: nenhuma linha existente muda.
--
-- O gerador também quis criar `acessos_pendentes`, que a 0007 (escrita à mão) já criou — o
-- snapshot dele estava atrasado. Fica só o enum.
ALTER TYPE "public"."import_format" ADD VALUE IF NOT EXISTS 'image';
