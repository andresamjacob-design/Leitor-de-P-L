/**
 * Os papéis de acesso a uma empresa (D155), sem nada de servidor: o formulário de Acessos
 * roda no navegador e precisa dos rótulos, e `@/lib/data/acessos` puxa os cookies do servidor.
 */

export type Papel = "viewer" | "member" | "owner";

export const PAPEL_LABEL: Record<Papel, string> = {
  viewer: "Ver",
  member: "Ver e editar",
  owner: "Administrador",
};

export const PAPEL_DESCRICAO: Record<Papel, string> = {
  viewer: "vê fluxo, DRE e lançamentos; não muda nada",
  member: "vê e edita: envia extratos, categoriza, corrige",
  owner: "vê, edita e libera outras pessoas",
};
