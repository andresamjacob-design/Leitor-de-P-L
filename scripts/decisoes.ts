/**
 * As decisões que sobraram, cada uma com a evidência do lado.
 *
 * `pendencias` ordena o que falta por dinheiro; este script faz a pergunta seguinte, que
 * é a que custa tempo: **o que o sistema já sabe sobre cada caso, para você responder sem
 * abrir o extrato?**
 *
 * São duas famílias, e elas pedem respostas de natureza diferente:
 *
 *   1. **CNPJ sem dono.** Dinheiro entrou, o documento identifica uma empresa, e nenhum
 *      cliente cadastrado tem esse documento. A pergunta não é só "quem é" — é "é cliente
 *      novo, ou é um dos 41 clientes que já existem sem documento?". Duplicar cliente
 *      estraga a margem por cliente em silêncio (D87), então o script mostra os candidatos
 *      e não escolhe.
 *   2. **Cliente com dois contratos.** Hold Beauty, PDG IT, Hogrefe e CSO têm projeto *e*
 *      retainer, que alcançam contas de receita diferentes. Aqui a evidência é a série de
 *      recebimentos contra o cronograma dos contratos: cadência e valor costumam dizer
 *      qual é qual sem que ninguém precise lembrar.
 *
 * Duas checagens que mudam a pergunta quando dão positivo, e por isso vêm antes da
 * resposta:
 *
 *   - **A contraparte também recebe pagamento da DD Group?** Aí é fornecedor *e* cliente —
 *     o problema documentado da Salesforce e da Ciclo — e a regra vai precisar de
 *     `direction` para não repetir a D83.
 *   - **A cadência é mensal e de valor fixo?** É a assinatura de um retainer. Não é prova,
 *     é evidência, e vai impressa como evidência.
 *
 * Só lê. Nunca escreve.
 *
 *   npm run decisoes
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Máscara: os últimos dígitos bastam para distinguir dois, e isto vai para o terminal. */
const mask = (doc: string) => `…${doc.slice(-6, -2)}-${doc.slice(-2)}`;

/** Tokens distintivos de um nome, para sugerir candidatos sem decidir nada. */
function tokens(label: string): string[] {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 4 &&
        !["LTDA", "SERVICOS", "COMERCIO", "TECNOLOGIA", "BRASIL", "EMPRESA", "SOLUCOES"].includes(
          token,
        ),
    );
}

try {
  // ---- 1. CNPJs sem dono ---------------------------------------------------
  const semDono = await sql<
    {
      doc: string;
      nome: string;
      entradas: string;
      total_entrada: string;
      primeira: string;
      ultima: string;
      valores: string[];
      saidas: string;
      total_saida: string;
    }[]
  >`
    with mov as (
      select regexp_replace(e.counterparty_tax_id, '\D', '', 'g') as doc,
             e.counterparty_name, e.direction, e.amount, e.occurred_on
      from cash_entries e
      join accounts a on a.id = e.account_id
      where a.type in ('bank', 'cash', 'investment')
        and e.counterparty_tax_id is not null
        and length(regexp_replace(e.counterparty_tax_id, '\D', '', 'g')) = 14
    ),
    alvo as (
      select distinct doc from mov m
      join cash_entries e2 on regexp_replace(coalesce(e2.counterparty_tax_id,''),'\D','','g') = m.doc
      where m.direction = 'in' and e2.category_id is null and e2.direction = 'in'
        and not exists (
          select 1 from clients c
          where regexp_replace(coalesce(c.tax_id,''), '\D', '', 'g') = m.doc
        )
    )
    select m.doc,
           max(m.counterparty_name) as nome,
           count(*) filter (where m.direction = 'in')                    as entradas,
           coalesce(sum(m.amount) filter (where m.direction = 'in'), 0)  as total_entrada,
           min(m.occurred_on) filter (where m.direction = 'in')          as primeira,
           max(m.occurred_on) filter (where m.direction = 'in')          as ultima,
           array_agg(m.amount::text order by m.occurred_on)
             filter (where m.direction = 'in')                           as valores,
           count(*) filter (where m.direction = 'out')                   as saidas,
           coalesce(sum(m.amount) filter (where m.direction = 'out'), 0) as total_saida
    from mov m
    join alvo on alvo.doc = m.doc
    group by m.doc
    order by 4 desc`;

  const candidatos = await sql<{ id: string; name: string }[]>`
    select id, name from clients where tax_id is null or tax_id = '' order by name`;

  console.log(
    `\n${BOLD}════ 1. ${semDono.length} CNPJs que mandaram dinheiro e não têm cliente ════${RESET}`,
  );
  console.log(
    `${DIM}Para cada um: é cliente novo, ou é um dos ${candidatos.length} clientes que já existem\n` +
      `sem documento? Cadastrar por semelhança de nome duplica cliente (D87), então aqui\n` +
      `vão candidatos, não escolhas.${RESET}\n`,
  );

  for (const row of semDono) {
    const valores = (row.valores ?? []).map((v) => fromNumeric(v));
    const distintos = new Set(valores.map(String));
    const fixo = distintos.size === 1 && valores.length >= 2;
    const total = fromNumeric(row.total_entrada);

    console.log(
      `${BOLD}${row.nome.slice(0, 52)}${RESET} ${DIM}${mask(row.doc)}${RESET}`,
    );
    console.log(
      `   ${row.entradas}× entrando, ${formatBRL(total)}   ${DIM}${iso(row.primeira)} → ${iso(row.ultima)}${RESET}`,
    );

    if (fixo) {
      console.log(
        `   ${GREEN}cadência fixa${RESET}: ${valores.length}× ${formatBRL(valores[0]!)} — ${DIM}tem cara de retainer mensal${RESET}`,
      );
    } else if (valores.length > 1) {
      console.log(
        `   ${DIM}valores variam: ${[...distintos].slice(0, 5).map((v) => formatBRL(BigInt(v))).join(", ")}${
          distintos.size > 5 ? "…" : ""
        } — tem cara de projeto por entrega${RESET}`,
      );
    }

    if (Number(row.saidas) > 0) {
      console.log(
        `   ${RED}⚠ também RECEBE pagamento da DD Group${RESET}: ${row.saidas}× ${formatBRL(fromNumeric(row.total_saida))}`,
      );
      console.log(
        `   ${DIM}  fornecedor e cliente ao mesmo tempo — a regra vai precisar de \`direction\` (D83)${RESET}`,
      );
    }

    const meus = tokens(row.nome);
    const parecidos = candidatos.filter((candidate) => {
      const alvo = tokens(candidate.name);
      return (
        alvo.length > 0 &&
        alvo.some((token) => meus.some((mine) => mine.startsWith(token) || token.startsWith(mine)))
      );
    });
    if (parecidos.length > 0) {
      console.log(
        `   ${YELLOW}candidatos entre os clientes sem documento${RESET}: ${parecidos
          .map((candidate) => candidate.name)
          .join(", ")}`,
      );
      console.log(`   ${DIM}  se for um deles, o certo é pôr o CNPJ nele, não criar outro${RESET}`);
    }
    console.log("");
  }

  // ---- 2. Clientes com dois contratos --------------------------------------
  const ambiguos = await sql<
    { client_id: string; cliente: string; contas: string }[]
  >`
    select cl.id as client_id, cl.name as cliente,
           count(distinct coalesce(
             ct.category_id,
             (select c.id from categories c
               where c.entity_id = ct.entity_id
                 and c.code = case ct.type when 'retainer' then '3.01' else '3.02' end
               limit 1))) as contas
    from clients cl
    join contracts ct on ct.client_id = cl.id
    join cash_entries e on e.client_id = cl.id and e.category_id is null and e.direction = 'in'
    group by 1, 2
    having count(distinct coalesce(
      ct.category_id,
      (select c.id from categories c
        where c.entity_id = ct.entity_id
          and c.code = case ct.type when 'retainer' then '3.01' else '3.02' end
        limit 1))) > 1
    order by 2`;

  console.log(
    `${BOLD}════ 2. ${ambiguos.length} clientes cujo recebimento não sabe em qual contrato cair ════${RESET}`,
  );
  console.log(
    `${DIM}Cada um tem contratos que alcançam contas de receita diferentes. A evidência é a\n` +
      `série de recebimentos contra o cronograma dos contratos.${RESET}\n`,
  );

  for (const alvo of ambiguos) {
    const contratos = await sql<
      {
        nome: string;
        type: string;
        status: string;
        monthly_value: string | null;
        total_value: string | null;
        start_date: string | null;
        end_date: string | null;
        conta: string;
      }[]
    >`
      select ct.name as nome, ct.type, ct.status, ct.monthly_value, ct.total_value,
             ct.start_date, ct.end_date,
             (select c.code || ' ' || c.name from categories c where c.id = coalesce(
                ct.category_id,
                (select c2.id from categories c2
                  where c2.entity_id = ct.entity_id
                    and c2.code = case ct.type when 'retainer' then '3.01' else '3.02' end
                  limit 1))) as conta
      from contracts ct where ct.client_id = ${alvo.client_id} order by ct.type`;

    const recebimentos = await sql<{ occurred_on: string; amount: string; description: string }[]>`
      select occurred_on, amount, description from cash_entries
      where client_id = ${alvo.client_id} and category_id is null and direction = 'in'
      order by occurred_on`;

    console.log(`${BOLD}${alvo.cliente}${RESET}`);
    console.log(`   ${DIM}contratos:${RESET}`);
    for (const contract of contratos) {
      const mensal = contract.monthly_value ? formatBRL(fromNumeric(contract.monthly_value)) : "—";
      const total = contract.total_value ? formatBRL(fromNumeric(contract.total_value)) : "—";
      console.log(
        `     ${contract.type.padEnd(9)} ${contract.status.padEnd(10)} mensal ${mensal.padStart(13)}  total ${total.padStart(14)}` +
          `  ${DIM}${contract.start_date ? iso(contract.start_date) : "?"} → ${contract.end_date ? iso(contract.end_date) : "aberto"}${RESET}`,
      );
      console.log(`       ${DIM}↳ ${contract.conta}${RESET}`);

      // Quanto já foi recebido nessa conta. Um contrato já quitado não recebe mais, e é
      // isso que costuma decidir o que a vigência sozinha não decidiu.
      const [recebido] = await sql<{ total: string | null }[]>`
        select sum(e.amount) as total from cash_entries e
        join categories c on c.id = e.category_id
        where e.client_id = ${alvo.client_id} and e.direction = 'in'
          and c.code = ${contract.conta.split(" ")[0] ?? ""}`;
      const jaRecebido = fromNumeric(recebido?.total ?? "0");
      if (contract.total_value) {
        const alvoTotal = fromNumeric(contract.total_value);
        const falta = alvoTotal - jaRecebido;
        const marca = falta === 0n ? `${GREEN}quitado${RESET}` : `faltam ${formatBRL(falta)}`;
        console.log(
          `       ${DIM}já recebido nessa conta: ${formatBRL(jaRecebido)} de ${formatBRL(alvoTotal)} — ${RESET}${marca}`,
        );
      }
    }

    console.log(`   ${DIM}recebimentos sem conta:${RESET}`);
    const porValor = new Map<string, number>();
    for (const receipt of recebimentos) {
      const key = receipt.amount;
      porValor.set(key, (porValor.get(key) ?? 0) + 1);
      console.log(
        `     ${iso(receipt.occurred_on)} ${formatBRL(fromNumeric(receipt.amount)).padStart(13)}  ${DIM}${receipt.description.slice(0, 34)}${RESET}`,
      );
    }

    const series = [...porValor.entries()].filter(([, n]) => n >= 2);
    if (series.length > 0) {
      console.log(
        `   ${GREEN}séries de valor repetido${RESET}: ${series
          .map(([valor, n]) => `${n}× ${formatBRL(fromNumeric(valor))}`)
          .join(", ")}  ${DIM}— valor que se repete todo mês costuma ser o retainer${RESET}`,
      );
    }
    console.log("");
  }

  console.log(
    `${DIM}Respondida cada uma, o caminho é: pôr o CNPJ no cliente (ou cadastrar), e dizer a\n` +
      `conta de receita. A regra por documento pega o histórico inteiro daquela contraparte\n` +
      `de uma vez — mas lembre da D88: ela não alcança o que já está no razão.${RESET}\n`,
  );
} finally {
  await sql.end();
}
