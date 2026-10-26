/**
 * O ramo que o banco atribui a cada compra de cartão, medido contra o razão de hoje (D130).
 *
 * ## Por que isto é um comando, e não um comentário
 *
 * O `MERCHANT_CATEGORY_CODES` nasceu de uma medição feita em setembro e guardada **no
 * comentário dele**. Comentário não re-mede: o `VESTUÁRIO` entrou por uma regra do Andre
 * — *"os pagamentos em roupas são brindes"* (D132) — e hoje está 1 de 2 no razão, porque a
 * D138 descobriu que uma daquelas duas linhas era um hotel que o credenciador tinha
 * cadastrado como loja de roupa. Ninguém teria visto isso sem re-medir.
 *
 * Este comando imprime, para cada ramo, em quantas contas as linhas dele caíram e qual a
 * maior fatia. É o número que decide se um ramo é pista ou ruído — e é o mesmo critério da
 * D130, agora repetível em vez de escrito uma vez.
 *
 * ## Como ler
 *
 * Um ramo só vira mapa quando **concentra**: a maior fatia leva quase tudo. `VEÍCULOS` leva
 * 99%, `ALIMENTAÇÃO` 97%. `DIVERSOS` é o ramo mais caro do cartão e espalha por catorze
 * contas com 38% na maior — mapear isso encheria a tela de sugestões erradas com ar de
 * fundamentadas, que é pior que não sugerir nada.
 *
 * O `no mapa` na última coluna diz se o ramo está sendo usado hoje. Ramo **no mapa e sem
 * concentrar** é o alarme: alguma coisa apodreceu desde a última medição.
 *
 * Só lê.
 *
 *   npm run ramos
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { MERCHANT_CATEGORY_CODES, merchantCategoryOf } from "@/lib/data/categorize";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** A fatia mínima para um ramo ser pista. Abaixo disto ele é ruído com cara de dado. */
const CONCENTRA = 90;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  // O razão não guarda o `raw_json` — ele vive no staging, e o `dedup_hash` liga os dois.
  const rows = await sql<Record<string, unknown>[]>`
    select ce.amount::text as amount, st.raw_json as raw, ct.code
      from cash_entries ce
      join accounts a on a.id = ce.account_id
      join staged_transactions st
        on st.entity_id = ce.entity_id and st.dedup_hash = ce.dedup_hash
      left join categories ct on ct.id = ce.category_id
     where ce.entity_id = ${entity.id} and a.type = 'credit_card'`;

  const porRamo = new Map<string, Map<string, { n: number; v: Cents }>>();
  let semRamo = 0;
  for (const row of rows) {
    const ramo = merchantCategoryOf(row.raw as Record<string, unknown> | null);
    if (!ramo) {
      semRamo += 1;
      continue;
    }
    const conta = (row.code as string | null) ?? "— sem conta —";
    const contas = porRamo.get(ramo) ?? new Map<string, { n: number; v: Cents }>();
    porRamo.set(ramo, contas);
    const cell = contas.get(conta) ?? { n: 0, v: 0n };
    cell.n += 1;
    cell.v += fromNumeric(row.amount as string);
    contas.set(conta, cell);
  }

  const total = rows.length;
  console.log(`\n${BOLD}O ramo do banco contra o razão${RESET} ${DIM}— ${total} compras de cartão${RESET}`);
  console.log(
    `${DIM}${total - semRamo} têm ramo legível; ${semRamo} não têm (conversão de câmbio, ` +
      `cidade sozinha, ou nada)${RESET}\n`,
  );
  console.log(
    `${DIM}${"ramo".padEnd(26)}${"linhas".padStart(7)}${"valor".padStart(16)}` +
      `${"contas".padStart(8)}${"maior fatia".padStart(13)}  veredito${RESET}`,
  );

  const ordenado = [...porRamo].sort(
    (a, b) =>
      [...b[1].values()].reduce((x, y) => x + y.n, 0) -
      [...a[1].values()].reduce((x, y) => x + y.n, 0),
  );

  const alarmes: string[] = [];
  for (const [ramo, contas] of ordenado) {
    const n = [...contas.values()].reduce((a, b) => a + b.n, 0);
    const v = [...contas.values()].reduce((a, b) => a + b.v, 0n);
    const ranking = [...contas].sort((a, b) => b[1].n - a[1].n);
    const maior = ranking[0] as [string, { n: number; v: Cents }];
    const pct = Math.round((maior[1].n / n) * 100);
    const mapeado = MERCHANT_CATEGORY_CODES[ramo];

    const concentra = pct >= CONCENTRA;
    const veredito = concentra ? "concentra" : pct >= 60 ? "espalha" : "não concentra";
    const cor = concentra ? GREEN : pct >= 60 ? YELLOW : RED;
    const selo = mapeado ? `${BOLD} · no mapa → ${mapeado}${RESET}` : "";

    console.log(
      `${ramo.padEnd(26).slice(0, 26)}${String(n).padStart(7)}${formatBRL(v).padStart(16)}` +
        `${String(contas.size).padStart(8)}${`${pct}% ${maior[0]}`.padStart(13)}  ` +
        `${cor}${veredito}${RESET}${selo}`,
    );
    // A distribuição só interessa quando não é óbvia; uma conta só já se explicou.
    if (contas.size > 1 && (mapeado || n >= 10)) {
      console.log(
        `${DIM}${"".padEnd(26)}${ranking.map(([c, x]) => `${c}:${x.n}`).join("  ")}${RESET}`,
      );
    }

    if (mapeado && !concentra) {
      alarmes.push(
        `${ramo} está no mapa apontando para ${mapeado}, e hoje concentra só ${pct}% ` +
          `em ${contas.size} contas`,
      );
    }
    if (mapeado && maior[0] !== mapeado) {
      alarmes.push(
        `${ramo} está mapeado para ${mapeado}, mas a conta que mais recebe linhas dele ` +
          `é ${maior[0]}`,
      );
    }
  }

  // Ramo que não está no mapa e concentra é candidato; quem decide é o Andre, não o script.
  const candidatos = ordenado
    .filter(([ramo]) => !MERCHANT_CATEGORY_CODES[ramo])
    .map(([ramo, contas]) => {
      const n = [...contas.values()].reduce((a, b) => a + b.n, 0);
      const maior = [...contas].sort((a, b) => b[1].n - a[1].n)[0] as [
        string,
        { n: number; v: Cents },
      ];
      return { ramo, n, pct: Math.round((maior[1].n / n) * 100), conta: maior[0] };
    })
    .filter((c) => c.n >= 10 && c.pct >= CONCENTRA);

  if (candidatos.length > 0) {
    console.log(`\n${BOLD}Fora do mapa e concentrando${RESET} ${DIM}— candidatos, não decisões${RESET}`);
    for (const c of candidatos) {
      console.log(`  ${c.ramo} — ${c.n} linhas, ${c.pct}% em ${c.conta}`);
    }
  }

  if (alarmes.length > 0) {
    console.log(`\n${YELLOW}${BOLD}Atenção${RESET}`);
    for (const a of alarmes) console.log(`  ${YELLOW}•${RESET} ${a}`);
  } else {
    console.log(`\n${GREEN}Nenhum ramo mapeado apodreceu desde a última medição.${RESET}`);
  }
  console.log(
    `\n${DIM}O mapa vive em src/lib/data/categorize.ts. Ramo entra nele por decisão sua, ` +
      `nunca por este script — ele mede, não escreve.${RESET}\n`,
  );
} finally {
  await sql.end();
}
