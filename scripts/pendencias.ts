/**
 * O que falta decidir, do maior para o menor.
 *
 * O motor levou a categorização até onde regra e histórico alcançam. O que sobra não é
 * falta de esforço do sistema: é dinheiro cuja natureza só quem tocou o negócio sabe —
 * um lote de fornecedores sem contraparte, um recebimento de uma empresa que não está na
 * planilha, um estorno que pode ou não abater o custo que o gerou.
 *
 * Este relatório existe para que isso deixe de ser um saldo opaco e vire uma lista com
 * ordem: agrupa por contraparte quando há documento e por descrição quando não há, ordena
 * por dinheiro, e diz de cada grupo o que o sistema já sabe. Uma linha respondida aqui
 * costuma resolver várias, porque uma regra por documento pega todo o histórico daquela
 * contraparte de uma vez.
 *
 * Só lê.
 *
 *   npm run pendencias
 *   npm run pendencias -- 40      # quantos grupos mostrar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatTaxId } from "@/lib/tax-id";

loadEnvLocal();

const LIMIT = Number(process.argv[2] ?? 30);

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

/** Só os últimos dígitos: o relatório vai para terminal e transcrição. */
function mask(taxId: string | null): string {
  if (!taxId) return "sem documento";
  const formatted = formatTaxId(taxId);
  return `${"•".repeat(Math.max(formatted.length - 6, 0))}${formatted.slice(-6)}`;
}

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");

  const [totals] = await sql<{ total: number; sem: number; valor: string }[]>`
    select count(*)::int as total,
           count(*) filter (where category_id is null)::int as sem,
           coalesce(sum(amount) filter (where category_id is null), 0)::text as valor
    from cash_entries where entity_id = ${entity.id}`;

  const decided = (totals?.total ?? 0) - (totals?.sem ?? 0);
  console.log(
    `\n${BOLD}${decided} de ${totals?.total} lançamentos decididos` +
      ` (${(((decided) / (totals?.total ?? 1)) * 100).toFixed(1)}%)${RESET}. ` +
      `Faltam ${totals?.sem}, somando ${formatMoney(parseMoney(totals?.valor ?? "0", { decimalSeparator: "." }))}.\n`,
  );

  /**
   * Agrupa por documento quando existe, e pela descrição quando não.
   *
   * A distinção não é cosmética: um grupo com documento se resolve com uma regra por
   * contraparte, que é a camada mais forte do motor (D40). Um grupo sem documento só se
   * resolve por texto, ou não se resolve.
   */
  const groups = await sql<
    {
      chave: string;
      documento: string | null;
      rotulo: string;
      linhas: number;
      valor: string;
      entradas: number;
      saidas: number;
      de: string;
      ate: string;
      cliente: string | null;
      pessoa: string | null;
    }[]
  >`
    select
      coalesce(regexp_replace(e.counterparty_tax_id, '\\D', '', 'g'),
               'texto:' || substring(upper(e.description) from '^[A-Z0-9 /*.&-]+')) as chave,
      max(regexp_replace(e.counterparty_tax_id, '\\D', '', 'g'))                     as documento,
      max(coalesce(e.counterparty_name, e.description))                              as rotulo,
      count(*)::int                                                                  as linhas,
      sum(e.amount)::text                                                            as valor,
      count(*) filter (where e.direction = 'in')::int                                as entradas,
      count(*) filter (where e.direction = 'out')::int                               as saidas,
      min(e.occurred_on)::text                                                       as de,
      max(e.occurred_on)::text                                                       as ate,
      max(c.name)                                                                    as cliente,
      max(p.name)                                                                    as pessoa
    from cash_entries e
    left join clients c
      on regexp_replace(c.tax_id, '\\D', '', 'g') = regexp_replace(e.counterparty_tax_id, '\\D', '', 'g')
    left join people p
      on regexp_replace(p.tax_id, '\\D', '', 'g') = regexp_replace(e.counterparty_tax_id, '\\D', '', 'g')
    where e.entity_id = ${entity.id} and e.category_id is null
    group by 1
    order by sum(e.amount) desc`;

  const shown = groups.slice(0, LIMIT);
  const rest = groups.slice(LIMIT);

  console.log(
    `${BOLD}${groups.length} grupos a decidir${RESET} ` +
      `${DIM}(mostrando ${shown.length}; documento agrupa por contraparte, o resto por descrição)${RESET}\n`,
  );

  for (const group of shown) {
    const value = parseMoney(group.valor, { decimalSeparator: "." });
    const flow =
      group.entradas > 0 && group.saidas > 0
        ? `${group.entradas}e/${group.saidas}s`
        : group.entradas > 0
          ? "entrada"
          : "saída";

    // O que o sistema já sabe sobre a contraparte é a dica mais útil que ele tem a dar.
    const known = group.cliente
      ? `${GREEN}cliente ${group.cliente}${RESET}`
      : group.pessoa
        ? `${GREEN}pessoa ${group.pessoa}${RESET}`
        : group.documento
          ? `${YELLOW}não cadastrada${RESET}`
          : `${DIM}sem contraparte no extrato${RESET}`;

    console.log(
      `${formatMoney(value).padStart(14)}  ${String(group.linhas).padStart(3)}× ${flow.padEnd(8)} ` +
        `${group.rotulo.slice(0, 38).padEnd(38)} ${DIM}${mask(group.documento).padEnd(16)}${RESET}` +
        `${known}`,
    );
    console.log(`${" ".repeat(16)}${DIM}${group.de} a ${group.ate}${RESET}`);
  }

  if (rest.length > 0) {
    const tail = rest.reduce(
      (sum, group) => sum + parseMoney(group.valor, { decimalSeparator: "." }),
      0n,
    );
    console.log(`\n${DIM}… e mais ${rest.length} grupos, somando ${formatMoney(tail)}.${RESET}`);
  }

  const semDoc = groups.filter((group) => group.documento === null);
  const semDocValor = semDoc.reduce(
    (sum, group) => sum + parseMoney(group.valor, { decimalSeparator: "." }),
    0n,
  );
  console.log(
    `\n${BOLD}${semDoc.length} grupos não têm documento nenhum${RESET} — ` +
      `${formatMoney(semDocValor)}. Esses só se resolvem por texto, ou olhando o lote no banco.\n`,
  );
} finally {
  await sql.end();
}
