/**
 * CNPJ do cliente → a conta de receita dos contratos dele (D136).
 *
 * Só entra cliente cujos contratos **todos** apontam para a mesma conta. Com duas contas
 * possíveis a camada não saberia escolher, e escolher errado é pior que não decidir — é a
 * mesma condição que o `vincular` já aplica quando cria regra para um segundo CNPJ.
 *
 * A conta sai de `contracts.category_id` quando preenchida e, quando nula, do tipo do
 * contrato: `3.01` para retainer, `3.02` para projeto. Essa é a regra do schema, não uma
 * invenção daqui.
 *
 * Compartilhado pelos três lugares que montam `EngineInput` fora da tela — o `recategorize`,
 * o `engine-preview` e quem mais vier. Duplicar esta consulta seria criar três verdades.
 */

import type { Sql } from "postgres";

export async function loadClientRevenueByTaxId(
  sql: Sql,
  entityId: string,
): Promise<Map<string, { clientId: string; categoryId: string }>> {
  const rows = await sql<{ doc: string; clientId: string; categoryId: string; contas: number }[]>`
    select regexp_replace(cl.tax_id, '\D', '', 'g') as doc,
           cl.id as "clientId",
           min(c.id::text) as "categoryId",
           count(distinct c.id)::int as contas
      from clients cl
      join contracts ct on ct.client_id = cl.id
      join categories c on c.id = coalesce(
        ct.category_id,
        (select c2.id from categories c2
          where c2.entity_id = ct.entity_id
            and c2.code = case ct.type when 'retainer' then '3.01' else '3.02' end
          limit 1))
     where cl.entity_id = ${entityId} and cl.tax_id is not null
     group by 1, 2
    having count(distinct c.id) = 1`;

  return new Map(rows.map((r) => [r.doc, { clientId: r.clientId, categoryId: r.categoryId }]));
}
