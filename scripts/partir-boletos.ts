/**
 * Os `BOLETOS RECEBIDOS` da Mash — parte os que carregam dois boletos e dá conta aos oito.
 *
 * O extrato do Itaú escreve `BOLETOS RECEBIDOS` e não diz quem sacou. Eram oito linhas,
 * **R$ 43.100,00**, a maior entrada sem dono do projeto. A resposta saiu de medição, não de
 * palpite, e o caminho vale registrado porque é o mesmo da D101 e da D104:
 *
 *   1. A parcela de R$ 5.000 aparece em **março, abril, maio e junho**. Na seção
 *      `Pagamento de NF` da planilha de fluxo, só **duas** linhas têm 5.000 nesses quatro
 *      meses: Afubra e Mash (Service). Star Palestras é Mar/Abr/Jun, Asaptech é só maio.
 *   2. **A Afubra já está no razão com nome próprio** — quatro TEDs nomeadas nos mesmos
 *      quatro meses, CNPJ 74.072.513/0001-44. Star Palestras e Asaptech idem. Se qualquer
 *      uma delas fosse o boleto, teria pago duas vezes.
 *   3. **A Mash é a única que a planilha diz ter pago e o razão nunca mostra.**
 *   4. E a aritmética fecha por um caminho que ninguém procurou: o contrato `project` da
 *      Mash, já cadastrado, tem **total de R$ 20.000**, e 4 × 5.000 = R$ 20.000.
 *
 * `7 × 3.300 + 4 × 5.000 = R$ 43.100`. Confirmado pelo Andre em 25/08/2026.
 *
 * ## Por que este script parte linha de extrato, e por que isso não é apagar
 *
 * Três boletos vieram **liquidados juntos** — R$ 8.300 é 3.300 do Ongoing mais 5.000 do
 * Projeto, e por isso o banco escreve "boletos", no plural. Uma linha, duas contas. Como
 * `cash_entries.category_id` é um só, ou a linha inteira vai para a conta errada em parte,
 * ou ela vira duas que somam o mesmo. **O Andre escolheu partir**, para a receita por conta
 * ficar certa ao centavo.
 *
 * Partir **não** é o que a D83 proíbe. Ali o erro seria apagar a linha e o saldo deixar de
 * bater com o banco; aqui a soma é idêntica e o saldo não se move — há uma trava neste
 * script que recusa gravar se ele se mover.
 *
 * **A armadilha real é o `dedup_hash`,** e ela custaria uma reimportação silenciosamente
 * dobrada. O hash existe para que importar o mesmo extrato duas vezes não crie o mesmo
 * movimento duas vezes (SPEC §7). Se as duas filhas recebessem hash honesto do próprio
 * conteúdo, o arquivo original — que tem a linha de 8.300 — voltaria a entrar como
 * novidade. Então:
 *
 *   - **a filha de 3.300 herda o hash da mãe.** Ele deixa de descrever o conteúdo dela e
 *     passa a dizer a coisa que importa: *"o movimento de 8.300 daquele extrato já está
 *     representado aqui"*. É a função do campo, não um efeito colateral.
 *   - **a filha de 5.000 ganha hash próprio**, calculado do conteúdo dela. Nenhum
 *     importador vai produzi-lo, porque essa linha não existe em arquivo nenhum.
 *
 * ## O que fica gravado
 *
 * Duas **regras de texto com faixa de valor fechada** (D104), não regra por documento: os
 * boletos não trazem documento nenhum, e é a exceção que a D40 admite e a D105 já usou.
 * `BOLETO` + R$ 3.300 + entrada → 3.01 Ongoing; `BOLETO` + R$ 5.000 + entrada → 3.02
 * Projeto, as duas com `client_id` da Mash.
 *
 * Elas envelhecem mal de propósito, como as da D104: se o valor mudar, nenhuma casa e a
 * linha aparece pedindo decisão em vez de entrar calada na conta errada.
 *
 * **A DRE não se mexe, e é o esperado** — receita nasce de contrato e NF (SPEC §5), não do
 * caixa. O `planCashMirror` não espelha receita, então o script confere que zero espelhos
 * foram criados e reclama se algum aparecer.
 *
 *   npm run boletos              # dry run: mostra o plano e a conferência
 *   npm run boletos -- --ensaio  # grava numa transação revertida e mede
 *   npm run boletos -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { dedupHash } from "@/lib/dedup";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const CLIENTE = "Mash";
/** O retainer mensal, `Mash` na aba `Income` — 12 meses de R$ 3.300. */
const ONGOING = { valor: parseMoney("3.300,00"), code: "3.01", quantas: 7 };
/** O contrato `project`, `Mash (Service)` na planilha — total de R$ 20.000. */
const PROJETO = { valor: parseMoney("5.000,00"), code: "3.02", quantas: 4 };
const TOTAL = parseMoney("43.100,00");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });
const iso = (v: unknown): IsoDate =>
  (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) as IsoDate;

type Boleto = {
  id: string;
  accountId: string;
  occurredOn: IsoDate;
  amount: Cents;
  description: string;
  dedupHash: string;
  categoryId: string | null;
};

/** O que cada linha vira. Uma linha inteira é `[uma parte]`; uma partida, `[duas]`. */
type Parte = { valor: Cents; code: string; nova: boolean };

function decompor(amount: Cents): Parte[] | null {
  if (amount === ONGOING.valor) return [{ valor: amount, code: ONGOING.code, nova: false }];
  if (amount === PROJETO.valor) return [{ valor: amount, code: PROJETO.code, nova: false }];
  if (amount === ONGOING.valor + PROJETO.valor) {
    return [
      { valor: ONGOING.valor, code: ONGOING.code, nova: false },
      { valor: PROJETO.valor, code: PROJETO.code, nova: true },
    ];
  }
  return null;
}

try {
  const [entity] = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const [cliente] = await sql<{ id: string; name: string }[]>`
    select id, name from clients where entity_id = ${entity.id} and name = ${CLIENTE}`;
  if (!cliente) throw new Error(`cliente "${CLIENTE}" não encontrado — cadastre antes`);

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entity.id}`;
  const byCode = new Map(categories.map((c) => [c.code, c]));
  for (const code of [ONGOING.code, PROJETO.code]) {
    if (!byCode.has(code)) throw new Error(`conta ${code} não existe no plano`);
  }

  const rows = await sql<Record<string, unknown>[]>`
    select id, account_id, occurred_on, amount::text as amount, description,
           dedup_hash, category_id
      from cash_entries
     where entity_id = ${entity.id}
       and direction = 'in'
       and description ilike '%BOLETO%RECEBID%'
     order by occurred_on`;

  const boletos: Boleto[] = rows.map((r) => ({
    id: String(r.id),
    accountId: String(r.account_id),
    occurredOn: iso(r.occurred_on),
    amount: fromNumeric(String(r.amount)),
    description: String(r.description),
    dedupHash: String(r.dedup_hash),
    categoryId: r.category_id === null ? null : String(r.category_id),
  }));

  console.log(`\n${BOLD}Os boletos da Mash${RESET}\n`);
  if (boletos.length === 0) {
    console.log(`${DIM}nenhum \`BOLETOS RECEBIDOS\` sem dono no razão — nada a fazer.${RESET}\n`);
    process.exit(0);
  }

  // ---- A trava aritmética, antes de qualquer plano ------------------------
  // Ela existe porque a identificação da Mash **é** esta conta. Se o razão mudar e a soma
  // deixar de fechar, a premissa caiu junto — e aí o certo é parar e reler, não gravar.
  const soma = boletos.reduce((acc, b) => acc + b.amount, 0n);
  const decomposto = boletos.map((b) => ({ boleto: b, partes: decompor(b.amount) }));
  const estranhas = decomposto.filter((d) => d.partes === null);

  const contagem = { [ONGOING.code]: 0, [PROJETO.code]: 0 } as Record<string, number>;
  for (const { partes } of decomposto) {
    for (const p of partes ?? []) contagem[p.code] = (contagem[p.code] ?? 0) + 1;
  }

  const problemas: string[] = [];
  if (soma !== TOTAL) {
    problemas.push(`a soma é ${formatBRL(soma)} e a conta da D109 é ${formatBRL(TOTAL)}`);
  }
  if (estranhas.length > 0) {
    problemas.push(
      `${estranhas.length} linha(s) com valor que não é 3.300, 5.000 nem a soma dos dois: ` +
        estranhas.map((d) => `${d.boleto.occurredOn} ${formatBRL(d.boleto.amount)}`).join(", "),
    );
  }
  if (contagem[ONGOING.code] !== ONGOING.quantas) {
    problemas.push(
      `são ${contagem[ONGOING.code]} parcelas de 3.300 e a D109 mediu ${ONGOING.quantas}`,
    );
  }
  if (contagem[PROJETO.code] !== PROJETO.quantas) {
    problemas.push(
      `são ${contagem[PROJETO.code]} parcelas de 5.000 e a D109 mediu ${PROJETO.quantas}`,
    );
  }
  const jaTemConta = boletos.filter((b) => b.categoryId !== null);
  if (jaTemConta.length > 0) {
    problemas.push(`${jaTemConta.length} linha(s) já têm conta — o script já rodou?`);
  }

  for (const { boleto, partes } of decomposto) {
    const texto = (partes ?? [])
      .map((p) => `${formatBRL(p.valor)} → ${p.code}${p.nova ? " (linha nova)" : ""}`)
      .join("  +  ");
    console.log(
      `  ${boleto.occurredOn}  ${formatBRL(boleto.amount).padStart(12)}  ${DIM}${boleto.description}${RESET}` +
        (texto ? `\n${" ".repeat(28)}${texto}` : `  ${RED}não decompõe${RESET}`),
    );
  }
  console.log(
    `\n  ${contagem[ONGOING.code]} × ${formatBRL(ONGOING.valor)} + ` +
      `${contagem[PROJETO.code]} × ${formatBRL(PROJETO.valor)} = ${BOLD}${formatBRL(soma)}${RESET}`,
  );

  if (problemas.length > 0) {
    console.log(`\n${RED}${BOLD}A conferência não fecha — nada foi gravado.${RESET}`);
    for (const p of problemas) console.log(`  ${RED}·${RESET} ${p}`);
    console.log(
      `\n${DIM}A identificação da Mash é esta aritmética. Se ela não fecha, a premissa\n` +
        `caiu junto — releia a D109 antes de mexer neste script.${RESET}\n`,
    );
    process.exit(1);
  }
  console.log(`  ${GREEN}fecha ao centavo${RESET}\n`);

  const novas = decomposto.flatMap(({ boleto, partes }) =>
    (partes ?? []).filter((p) => p.nova).map((p) => ({ boleto, parte: p })),
  );
  console.log(
    `${BOLD}Plano${RESET}\n` +
      `  ${boletos.length} linhas ganham conta e cliente (${cliente.name})\n` +
      `  ${novas.length} linha(s) de ${formatBRL(PROJETO.valor)} nascem da partição dos boletos de ` +
      `${formatBRL(ONGOING.valor + PROJETO.valor)}\n` +
      `  2 regras de texto com faixa de valor fechada, para o mês que vem cair sozinho\n`,
  );

  if (!APPLY && !REHEARSE) {
    console.log(
      `${DIM}nada foi gravado. Rode com --ensaio para medir numa transação revertida,\n` +
        `ou com --aplicar para gravar.${RESET}\n`,
    );
    process.exit(0);
  }

  // ---- Escrita ------------------------------------------------------------
  // O caixa de verdade: abertura das contas **mais** os movimentos, e só nas contas que
  // guardam dinheiro (D-C — cartão é passivo, não caixa). Duas armadilhas pagas aqui, e as
  // duas produzem um número que *parece* saldo e não é: somar só os movimentos dá negativo,
  // e incluir o cartão desconta compras que ainda não viraram pagamento. Um número desses
  // já custou meia hora acusando o app de errado.
  const saldoDe = async (db: postgres.TransactionSql | postgres.Sql) => {
    const [r] = await db<{ total: string }[]>`
      with caixa as (
        select id, opening_balance from accounts
         where entity_id = ${entity.id} and type in ('bank', 'cash', 'investment')
      )
      select (
        coalesce((select sum(opening_balance) from caixa), 0)
        + coalesce((select sum(case when direction = 'in' then amount else -amount end)
                      from cash_entries
                     where entity_id = ${entity.id}
                       and account_id in (select id from caixa)), 0)
      )::text as total`;
    return fromNumeric(r?.total ?? "0");
  };
  const espelhosDe = async (db: postgres.TransactionSql | postgres.Sql) => {
    const [r] = await db<{ n: number }[]>`
      select count(*)::int as n from recognition_entries where entity_id = ${entity.id}`;
    return r?.n ?? 0;
  };

  const saldoAntes = await saldoDe(sql);
  const espelhosAntes = await espelhosDe(sql);

  const write = async (db: postgres.TransactionSql) => {
    let criadas = 0;
    let categorizadas = 0;

    for (const { boleto, partes } of decomposto) {
      for (const parte of partes ?? []) {
        const categoria = byCode.get(parte.code) as { id: string };

        if (!parte.nova) {
          // A linha original sobrevive com o valor da primeira parte — e **mantém o
          // `dedup_hash` da mãe**, que é o que faz uma reimportação do extrato reconhecer
          // o movimento de 8.300 como já representado aqui.
          await db`
            update cash_entries
               set amount = ${toNumeric(parte.valor)},
                   category_id = ${categoria.id},
                   client_id = ${cliente.id},
                   updated_at = now()
             where id = ${boleto.id}`;
          categorizadas += 1;
          continue;
        }

        await db`
          insert into cash_entries
            (entity_id, account_id, occurred_on, amount, direction, description,
             category_id, client_id, dedup_hash)
          values (${entity.id}, ${boleto.accountId}, ${boleto.occurredOn},
                  ${toNumeric(parte.valor)}, 'in', ${boleto.description},
                  ${categoria.id}, ${cliente.id},
                  ${dedupHash({
                    accountId: boleto.accountId,
                    occurredOn: boleto.occurredOn,
                    amount: parte.valor,
                    direction: "in",
                    description: boleto.description,
                  })})`;
        criadas += 1;
        categorizadas += 1;
      }
    }

    // As duas regras. `amount_min = amount_max` é a faixa fechada da D104: identidade aqui
    // é o par texto + valor, porque documento não existe nesta linha.
    let regras = 0;
    for (const alvo of [ONGOING, PROJETO]) {
      const categoria = byCode.get(alvo.code) as { id: string };
      const [existe] = await db<{ id: string }[]>`
        select id from categorization_rules
         where entity_id = ${entity.id} and pattern = 'BOLETO' and direction = 'in'
           and amount_min = ${toNumeric(alvo.valor)} and amount_max = ${toNumeric(alvo.valor)}`;
      if (existe) continue;

      await db`
        insert into categorization_rules
          (entity_id, priority, match_type, pattern, direction,
           amount_min, amount_max, category_id, client_id)
        values (${entity.id}, 40, 'contains', 'BOLETO', 'in',
                ${toNumeric(alvo.valor)}, ${toNumeric(alvo.valor)},
                ${categoria.id}, ${cliente.id})`;
      regras += 1;
    }

    return {
      criadas,
      categorizadas,
      regras,
      saldo: await saldoDe(db),
      espelhos: await espelhosDe(db),
    };
  };

  let out = { criadas: 0, categorizadas: 0, regras: 0, saldo: saldoAntes, espelhos: espelhosAntes };
  if (REHEARSE) {
    const ROLLBACK = Symbol("ensaio");
    try {
      await sql.begin(async (db) => {
        out = await write(db);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  } else {
    out = await sql.begin(write);
  }

  console.log(
    `${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ` +
      `${out.categorizadas} lançamentos com conta, ${out.criadas} linha(s) nova(s), ` +
      `${out.regras} regra(s).`,
  );

  // As duas conferências que fazem esta operação ser partição e não invenção.
  const moveu = out.saldo - saldoAntes;
  console.log(
    moveu === 0n
      ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}, antes e depois${RESET}`
      : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET} — partir não pode fazer isso`,
  );
  const espelhos = out.espelhos - espelhosAntes;
  console.log(
    espelhos === 0
      ? `  ${GREEN}nenhum espelho de competência${RESET} ${DIM}— receita nasce de contrato e NF, não do caixa (SPEC §5)${RESET}`
      : `  ${YELLOW}${espelhos} espelho(s) de competência criados${RESET} — receita não deveria espelhar`,
  );

  if (moveu !== 0n && !REHEARSE) {
    console.log(`\n${RED}Grave: o saldo mudou. Confira antes de seguir.${RESET}\n`);
    process.exit(1);
  }

  console.log(
    REHEARSE
      ? `\n${DIM}nada foi gravado. Rode com --aplicar quando estiver satisfeito.${RESET}\n`
      : `\n${DIM}Rode ${RESET}npm run verify:rls${DIM} e ${RESET}npm run verify:reconcile${DIM} agora.${RESET}\n`,
  );
} finally {
  await sql.end();
}
