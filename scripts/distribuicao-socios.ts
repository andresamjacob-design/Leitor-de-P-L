/**
 * Separa distribuição de lucro do salário dos sócios (D110).
 *
 * ## O defeito
 *
 * O SISPAG entrega CPF e valor, nunca a natureza do pagamento. Quando a D96 abriu os lotes
 * e a D97 levou as 63 regras ao razão, **tudo o que os três sócios receberam caiu em
 * `6.10 Freelancers`** — conta de custo, dentro da DRE. Parte daquilo é salário e pertence
 * ali; parte é distribuição de lucro, que **não é despesa** e não pode pesar no resultado.
 *
 * O desenho para isso existe desde a D24 e nunca foi usado: `99.04 Distribuição de lucros`
 * é `owner_draw`, grupo `socios`, e o `src/lib/pl.ts` já a põe **abaixo do EBITDA**. A conta
 * estava vazia porque ninguém tinha como saber, olhando um CPF, qual metade era qual.
 *
 * ## Como se sabe qual é qual
 *
 * O método é do Andre, em 26/08/2026: *"olha na aba pessoas da planilha do DRE, procura o
 * nome deles e lá tem o salário de cada; aí subtrai do valor total e você vai ter o total"*.
 *
 * A aba `Colaboradores` traz três linhas sem colaborador nomeado — `CUSTODIO`, `JACOB` e
 * `LEONARDO` —, que são o salário mensal de cada sócio. **Este script lê essas linhas**, em
 * vez de trazer os valores escritos à mão: número copiado é número que ninguém confere.
 *
 *     distribuição do mês = o que o sócio recebeu − o salário daquele mês
 *
 * E a leitura se prova sozinha: salários R$ 313.014,93 mais distribuição R$ 442.500,00 dão
 * **R$ 755.514,93**, que é a linha `Distribuição de Lucro` da aba `Summary` do fluxo de
 * caixa, ao centavo, nos sete meses. De março em diante a distribuição é **zero** — os
 * R$ 15.000 mensais são só salário, e é por isso que só janeiro e fevereiro têm o que mover.
 *
 * ## As travas, e por que cada uma existe
 *
 *   - **Um padrão de nome tem de resolver para um documento só, e ele tem de ser CPF.**
 *     A D100 pagou caro por casar contraparte por `ilike` e pegar o CPF de outra pessoa, e
 *     o handover avisa que *a pessoa Gabriel Sampaio Jacob tem CPF e a empresa homônima tem
 *     CNPJ* — sem esta trava o padrão pegaria as duas. O documento vem do extrato; nenhum
 *     CPF é digitado aqui, como em `vincular-clientes.ts`.
 *   - **A diferença tem de casar com um lançamento exato, ou o script recusa.** Nada de
 *     escolher um subconjunto que "dá quase certo". Onde não casa, ele relata e não move —
 *     é o que acontece com janeiro do Jacob, cujo salário foi pago dentro de um lote SISPAG
 *     ainda anônimo.
 *   - **Os R$ 1.300 mensais no CPF do Custodio não são dele.** São o salário da Manuella
 *     Cipryano, que a aba `Pessoas` mostra recebendo exatamente isso de fev a jul e que o
 *     razão nunca traz com documento próprio (D104; confirmado pelo Andre em 26/08). Sem
 *     excluí-los, seis meses passariam a ter R$ 1.300 de "distribuição" que não existe.
 *   - **O espelho de competência é apagado à mão.** O `recategorize` nunca precisou disso
 *     porque só toca em linha sem conta; aqui a linha **já tem** espelho, e `planCashMirror`
 *     devolver `null` significa *apague o que existe* — mas alguém tem que executar o apagar.
 *     Sem isto o custo continuaria na DRE depois da mudança, em silêncio.
 *   - **A trava de saldo é condição de saída**, como na D109: mudar de conta não move
 *     dinheiro. Se mover, é defeito e o script sai com erro.
 *
 *   npm run socios              # dry run: mostra o plano e a conferência
 *   npm run socios -- --ensaio  # grava numa transação revertida e mede
 *   npm run socios -- --aplicar
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, parseMoney, type Cents } from "@/lib/money";
import { formatTaxId } from "@/lib/tax-id";
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

const PLANILHA = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
const DESTINO = "99.04";
const ORIGEM = "6.10";
const DE = "2026-01-01";
const ATE = "2026-07-31";

/**
 * Os três sócios, nomeados pelo Andre. O `rotulo` é como a aba `Colaboradores` os chama;
 * `contraparte` é o padrão que acha as linhas no razão — e o documento sai de lá.
 */
const SOCIOS: readonly { rotulo: string; contraparte: string }[] = [
  { rotulo: "CUSTODIO", contraparte: "RICARDO DE CARVALHO CUSTODIO%" },
  { rotulo: "JACOB", contraparte: "GABRIEL SAMPAIO JACOB%" },
  { rotulo: "LEONARDO", contraparte: "LEONARDO SANCHES ALVES DE OLIVEIRA%" },
];

/** Pagamento que sai no CPF de um sócio e não é dele (D104). Fica em 6.10, onde já está. */
const DE_TERCEIRO: readonly { rotulo: string; valor: Cents; quem: string }[] = [
  { rotulo: "CUSTODIO", valor: parseMoney("1.300,00"), quem: "Manuella Cipryano" },
];

const MESES = ["01", "02", "03", "04", "05", "06", "07"] as const;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

const mask = (t: string) => {
  const f = formatTaxId(t);
  return `${"•".repeat(Math.max(f.length - 6, 0))}${f.slice(-6)}`;
};

/** Só os dígitos: CPF tem 11, CNPJ tem 14. */
const isCpf = (t: string) => t.replace(/\D/g, "").length === 11;

type Linha = {
  id: string;
  occurredOn: IsoDate;
  amount: Cents;
  direction: "in" | "out";
  description: string;
};

/** Salário mensal de cada sócio, lido da aba `Colaboradores`. */
function lerSalarios(): Map<string, Map<string, Cents>> {
  const aba = readXlsx(readFileSync(PLANILHA)).find((s) => s.name === "Colaboradores");
  if (!aba) throw new Error("aba `Colaboradores` não encontrada na planilha da DRE");

  const porRotulo = new Map<string, Map<string, Cents>>();
  for (const { rotulo } of SOCIOS) {
    const linhas = aba.rows.filter(
      (r) => (r[2] ?? "").trim().toUpperCase() === rotulo && (r[5] ?? "").trim() === "",
    );
    if (linhas.length !== 1) {
      throw new Error(
        `a aba \`Colaboradores\` tem ${linhas.length} linhas para ${rotulo}; esperava exatamente 1`,
      );
    }
    const linha = linhas[0] as (string | null)[];
    const meses = new Map<string, Cents>();
    MESES.forEach((mes, i) => {
      const bruto = (linha[7 + i] ?? "").trim();
      if (bruto === "") return;
      // A planilha escreve número com ponto decimal; centavos são bigint (§7 do handover).
      meses.set(mes, BigInt(Math.round(Number(bruto) * 100)));
    });
    porRotulo.set(rotulo, meses);
  }
  return porRotulo;
}

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const contas = await sql<{ id: string; code: string; kind: string }[]>`
    select id, code, kind from categories
     where entity_id = ${entity.id} and code in (${ORIGEM}, ${DESTINO})`;
  const origem = contas.find((c) => c.code === ORIGEM);
  const destino = contas.find((c) => c.code === DESTINO);
  if (!origem || !destino) throw new Error(`contas ${ORIGEM}/${DESTINO} não encontradas`);
  if (destino.kind !== "owner_draw") {
    throw new Error(`${DESTINO} deveria ser owner_draw e é ${destino.kind}`);
  }

  const salarios = lerSalarios();

  console.log(`\n${BOLD}Distribuição de lucro × salário dos sócios${RESET}`);
  console.log(
    `${DIM}salário lido de \`Colaboradores\`; ${ORIGEM} → ${DESTINO} (fora da DRE)${RESET}\n`,
  );

  type Mover = { rotulo: string; mes: string; valor: Cents; linhas: Linha[] };
  const mover: Mover[] = [];
  const recusas: string[] = [];

  for (const { rotulo, contraparte } of SOCIOS) {
    // O padrão acha as linhas; o documento sai do extrato e tem de ser um só, e CPF.
    const docs = await sql<{ doc: string }[]>`
      select distinct counterparty_tax_id as doc from cash_entries
       where entity_id = ${entity.id}
         and counterparty_name ilike ${contraparte}
         and counterparty_tax_id is not null`;
    const cpfs = docs.map((d) => d.doc).filter(isCpf);
    if (docs.length !== cpfs.length) {
      recusas.push(
        `${rotulo}: o padrão pegou ${docs.length} documentos e só ${cpfs.length} são CPF — ` +
          `é a empresa homônima entrando junto. Nada movido.`,
      );
      continue;
    }
    if (cpfs.length !== 1) {
      recusas.push(
        `${rotulo}: o padrão resolveu para ${cpfs.length} CPFs; esperava 1. Nada movido.`,
      );
      continue;
    }
    const doc = cpfs[0] as string;

    const brutas = await sql<{ id: string; occurredOn: string; amount: string; direction: string; description: string }[]>`
      select id, occurred_on::text as "occurredOn", amount::text as amount,
             direction, description
        from cash_entries
       where entity_id = ${entity.id}
         and counterparty_tax_id = ${doc}
         and category_id = ${origem.id}
         and occurred_on::text between ${DE} and ${ATE}
       order by occurred_on::text`;
    const tipadas: Linha[] = brutas.map((l) => ({
      id: l.id,
      occurredOn: l.occurredOn as IsoDate,
      amount: fromNumeric(l.amount),
      direction: l.direction as "in" | "out",
      description: l.description,
    }));

    const excluir = DE_TERCEIRO.filter((t) => t.rotulo === rotulo);
    const proprias = tipadas.filter((l) => !excluir.some((t) => t.valor === l.amount));
    const alheias = tipadas.length - proprias.length;

    console.log(`${BOLD}${rotulo}${RESET} ${DIM}${mask(doc)}${RESET}`);
    if (alheias > 0) {
      const t = excluir[0] as { valor: Cents; quem: string };
      console.log(
        `  ${DIM}${alheias} linha(s) de ${formatBRL(t.valor)} fora da conta: salário da ${t.quem}, paga por ele (D104)${RESET}`,
      );
    }

    for (const mes of MESES) {
      const doMes = proprias.filter((l) => l.occurredOn.slice(5, 7) === mes);
      const salario = salarios.get(rotulo)?.get(mes) ?? 0n;
      if (doMes.length === 0 && salario === 0n) continue;

      const recebido = doMes.reduce(
        (a, l) => a + (l.direction === "out" ? l.amount : -l.amount),
        0n,
      );
      const dif = recebido - salario;

      if (dif === 0n) continue;
      if (dif < 0n) {
        console.log(
          `  ${DIM}2026-${mes}  recebeu ${formatBRL(recebido)}, salário ${formatBRL(salario)} — ` +
            `faltam ${formatBRL(-dif)}; nada a mover${RESET}`,
        );
        continue;
      }

      // A diferença tem de ser exatamente um lançamento, ou um par de estorno (D103): duas
      // saídas iguais e uma devolução no mesmo dia, que juntas valem uma saída só.
      const exatos = doMes.filter((l) => l.amount === dif);
      const liquido = exatos.reduce(
        (a, l) => a + (l.direction === "out" ? l.amount : -l.amount),
        0n,
      );

      if (exatos.length === 0 || liquido !== dif) {
        recusas.push(
          `${rotulo} 2026-${mes}: a diferença é ${formatBRL(dif)} e nenhum lançamento ` +
            `(nem grupo de estorno) fecha nesse valor. Não movido — ver o handover.`,
        );
        console.log(
          `  ${YELLOW}2026-${mes}  ${formatBRL(dif)} sem lançamento exato — recusado${RESET}`,
        );
        continue;
      }

      mover.push({ rotulo, mes, valor: dif, linhas: exatos });
      console.log(
        `  ${GREEN}2026-${mes}  ${formatBRL(dif)}${RESET} ${DIM}em ${exatos.length} linha(s) → ${DESTINO}${RESET}`,
      );
    }
    console.log("");
  }

  const total = mover.reduce((a, m) => a + m.valor, 0n);
  const nLinhas = mover.reduce((a, m) => a + m.linhas.length, 0);
  console.log(`${BOLD}${formatBRL(total)}${RESET} em ${nLinhas} linha(s) sairiam do custo.\n`);

  for (const r of recusas) console.log(`${YELLOW}recusado${RESET} ${r}`);
  if (recusas.length > 0) console.log("");

  // ---- Conferências -------------------------------------------------------
  // O caixa de verdade: abertura mais movimentos, só nas contas que guardam dinheiro (D-C).
  // R$ 711.916,33 é o número que o handover declara — se sair outro, a consulta é que está
  // errada, não o banco (D109).
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
                     where entity_id = ${entity.id} and account_id in (select id from caixa)), 0)
      )::text as total`;
    return fromNumeric(r?.total ?? "0");
  };
  const custoDe = async (db: postgres.TransactionSql | postgres.Sql) => {
    const [r] = await db<{ total: string }[]>`
      select coalesce(sum(amount), 0)::text as total from recognition_entries
       where entity_id = ${entity.id} and kind = 'cost'`;
    return fromNumeric(r?.total ?? "0");
  };

  const saldoAntes = await saldoDe(sql);
  const custoAntes = await custoDe(sql);

  if (mover.length === 0) {
    console.log(`${DIM}nada a mover.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `${DIM}nada foi gravado. Rode com --ensaio para medir numa transação revertida,\n` +
        `ou com --aplicar para gravar.${RESET}\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      let movidas = 0;
      let espelhos = 0;
      for (const m of mover) {
        for (const l of m.linhas) {
          await db`
            update cash_entries
               set category_id = ${destino.id}, updated_at = now()
             where id = ${l.id}`;
          // `planCashMirror` devolve null para owner_draw, e null quer dizer *apague o que
          // existe*. Sem este delete o custo continua na DRE depois da mudança.
          const apagados = await db`
            delete from recognition_entries where cash_entry_id = ${l.id} returning id`;
          espelhos += apagados.length;
          movidas += 1;
        }
      }
      return { movidas, espelhos, saldo: await saldoDe(db), custo: await custoDe(db) };
    };

    let out = { movidas: 0, espelhos: 0, saldo: saldoAntes, custo: custoAntes };
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          out = await write(db as postgres.TransactionSql);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      console.log(`${YELLOW}ensaio: gravado e revertido.${RESET}`);
    } else {
      out = await sql.begin(write);
      console.log(`${GREEN}aplicado.${RESET}`);
    }

    const moveu = out.saldo - saldoAntes;
    const caiu = custoAntes - out.custo;
    console.log(
      `  ${out.movidas} linha(s) movidas, ${out.espelhos} espelho(s) de competência apagados`,
    );
    console.log(
      moveu === 0n
        ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}, antes e depois${RESET}`
        : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET} — mudar de conta não pode fazer isso`,
    );
    console.log(
      caiu === total
        ? `  ${GREEN}o custo caiu exatamente ${formatBRL(caiu)}${RESET} ${DIM}— o resultado sobe o mesmo${RESET}`
        : `  ${RED}o custo caiu ${formatBRL(caiu)} e o esperado era ${formatBRL(total)}${RESET}`,
    );
    if (moveu !== 0n || caiu !== total) {
      console.log(`\n${RED}Grave: a conferência falhou. Confira antes de seguir.${RESET}\n`);
      process.exitCode = 1;
    } else {
      console.log(
        APPLY
          ? `\n${DIM}rode agora: npm run verify:rls e npm run verify:reconcile${RESET}\n`
          : `\n${DIM}nada foi gravado. Rode com --aplicar quando estiver satisfeito.${RESET}\n`,
      );
    }
  }
} finally {
  await sql.end();
}
