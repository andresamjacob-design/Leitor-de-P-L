/**
 * O que a tela de Emissão de NF precisa, lido do banco (D170).
 *
 * Mesmo acesso que o resto: cliente Supabase com o JWT do usuário, e a RLS decide (D16). A
 * conta é da `@/lib/inadimplencia`; aqui só se junta a cópia da planilha, os clientes e os
 * recebimentos de receita.
 */

import { listAccounts } from "@/lib/data/accounts";
import { listCashEntries } from "@/lib/data/cash-entries";
import { listCategories } from "@/lib/data/categories";
import { listClients } from "@/lib/data/clients";
import { loadPlanilha } from "@/lib/data/planilha";
import { periodOf, todayInSaoPaulo, type IsoDate, type Period } from "@/lib/dates";
import { avaliarInadimplencia, type Inadimplencia, type Recebimento } from "@/lib/inadimplencia";
import { notasDaCopia, type LinhaDeNf } from "@/lib/nf-da-planilha";

export type EmissaoDeNf = Inadimplencia & {
  periodos: Period[];
  linhas: LinhaDeNf[];
  hoje: IsoDate;
  desde: Period;
  arquivo: string | null;
  copiadaEm: string | null;
};

export async function loadEmissaoDeNf(entityId: string): Promise<EmissaoDeNf> {
  const hoje = todayInSaoPaulo();
  const [copia, clientes, contas, categorias] = await Promise.all([
    loadPlanilha(entityId, "nf"),
    listClients([entityId], { includeInactive: true }),
    listAccounts([entityId]),
    listCategories([entityId], { includeInactive: true }),
  ]);
  const { periodos, linhas } = notasDaCopia(copia.linhas);

  // O razão está completo a partir da abertura da conta corrente mais antiga: antes dela, o
  // pagamento de uma nota pode ter entrado e não estar aqui.
  const aberturas = contas.filter((c) => c.type === "bank").map((c) => c.openingDate).sort();
  const desde = periodOf(aberturas[0] ?? hoje);

  // Receita, ou entrada ainda sem categoria — transferência e resgate não pagam nota.
  const codigo = new Map(categorias.map((c) => [c.id, c.code]));
  const entradas = await listCashEntries({ entityIds: [entityId], direction: "in", from: desde, limit: 50_000 });
  const recebimentos: Recebimento[] = entradas
    .filter((e) => e.categoryId === null || (codigo.get(e.categoryId) ?? "").startsWith("3."))
    .map((e) => ({
      id: e.id,
      data: e.occurredOn,
      valor: e.amount,
      clientId: e.clientId,
      cnpj: e.counterpartyTaxId,
      descricao: e.description,
    }));

  const resultado = avaliarInadimplencia({
    linhas,
    clientes: clientes.map((c) => ({ id: c.id, name: c.name, taxId: c.taxId })),
    recebimentos,
    hoje,
    desde,
  });

  return { ...resultado, periodos, linhas, hoje, desde, arquivo: copia.arquivo, copiadaEm: copia.copiadaEm };
}
