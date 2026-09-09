/**
 * As respostas do Andre sobre as descrições de cartão que ninguém reconhecia (D128).
 *
 * Estas linhas nunca tiveram conta. Não são correção — o `corrigir` (D119) existe para
 * linha que já tem conta e está na errada; esta é a outra metade, a lacuna. E a lacuna se
 * preenche por **regra**, não por edição direta, por dois motivos: a regra vale para a
 * próxima ocorrência (a Maria Clara tem três parcelas hoje e mais três por vir), e ela fica
 * legível na tela de regras em vez de virar um lançamento inexplicável no razão.
 *
 * Cada linha aqui é uma frase que o Andre disse, não uma inferência minha. O que ele não
 * soube dizer continua sem conta — `HS ANALIA FR-CT` é o caso, e ele respondeu "não sei
 * ainda", que é uma resposta e fica registrada como tal.
 *
 * O sentido está preenchido em todas. A regra `CICLO` sem sentido foi o falso positivo que
 * criou a coluna `direction` (D122): a Agência Ciclo é fornecedora *e* cliente, e sem o
 * sentido a regra de despesa capturava os recebimentos dela.
 *
 *   npm run respostas              # dry run
 *   npm run respostas -- --ensaio  # grava numa transação revertida e mede
 *   npm run respostas -- --aplicar
 */

import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

class Rollback extends Error {}

type Resposta = {
  /** O texto como ele aparece no razão. */
  pattern: string;
  direction: "in" | "out";
  code: string;
  /** Nome do cliente, quando o recebimento é de um que já existe. */
  client?: string;
  /** A frase do Andre, palavra por palavra. */
  disse: string;
};

/**
 * As quatro que o **banco** respondeu, não o Andre (D130).
 *
 * O `detalhe` da fatura traz o ramo do lojista, e medido contra as 452 linhas de cartão já
 * decididas ele acerta `VEÍCULOS` em 158 de 159 e `ALIMENTAÇÃO` em 24 de 25. Isso é forte o
 * suficiente para propor e fraco demais para calar: cada linha aqui registra que a fonte é
 * a classificação do banco, e não uma frase de alguém.
 *
 * A camada 6 do motor faz isto sozinha para importação nova. Estas quatro já viraram
 * lançamento, e o razão não guarda o `raw` — por isso entram por regra, como as outras.
 */
const RESPOSTAS: Resposta[] = [
  { pattern: "SQ *DREAMFORCE SF", direction: "out", code: "9.05", disse: "ingresso evento" },
  // Registro de marca é a mesma natureza do INPI, que a D117 pôs em Jurídico — e é a linha
  // onde a planilha do Andre e o app já divergem de propósito por R$ 440.
  { pattern: "ASA*MARIA CLARA", direction: "out", code: "8.02", disse: "registro de marca" },
  { pattern: "APPLE.COM/US", direction: "out", code: "5.01", disse: "equipamento" },
  { pattern: "Administrado-CT", direction: "out", code: "10.05", disse: "classifique como outros" },
  // "pagamento normal" = o mesmo que os outros três recebimentos da Ciclo, que já estão em
  // 3.03 com o cliente ligado. O sentido `in` é o que impede esta regra de encostar no
  // boleto de R$ 4.000 que a empresa **paga** à Agência Ciclo todo mês (D122).
  {
    pattern: "PIX RECEBIDO CICLO",
    direction: "in",
    code: "3.03",
    client: "Ciclo",
    disse: "pagamento normal",
  },
  // Daqui para baixo quem respondeu foi o banco. `LAGO AZUL` desmente o palpite que estava
  // no documento de ações — eu tinha escrito "restaurante?" e o ramo diz veículos, em
  // Jundiaí.
  {
    pattern: "LAGO AZUL",
    direction: "out",
    code: "9.04",
    disse: "o banco classificou como VEÍCULOS (.JUNDIAI)",
  },
  {
    pattern: "FOCO FORNECE",
    direction: "out",
    code: "9.03",
    disse: "o banco classificou como ALIMENTAÇÃO (.SAO PAULO)",
  },
  {
    pattern: "ZIG*SPE VTEX",
    direction: "out",
    code: "9.03",
    disse: "o banco classificou como ALIMENTAÇÃO — comida no VTEX Day, não ingresso",
  },
  {
    pattern: "DASTRI CONVE",
    direction: "out",
    code: "9.03",
    disse: "o banco classificou como ALIMENTAÇÃO (.SAO PAULO)",
  },
];

/** Respondida com "não sei", que é resposta e não ausência dela. */
const SEM_RESPOSTA = [{ pattern: "HS ANALIA FR-CT", disse: "não sei ainda" }];

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");
  const entityId = entity.id;

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entityId}`;
  const byCode = new Map(categories.map((c) => [c.code, c]));

  const clients = await sql<{ id: string; name: string }[]>`
    select id, name from clients where entity_id = ${entityId}`;

  const existing = await sql<{ pattern: string; direction: string | null }[]>`
    select pattern, direction::text from categorization_rules where entity_id = ${entityId}`;
  const seen = new Set(existing.map((r) => `${r.pattern}|${r.direction ?? ""}`));

  console.log(`\n${BOLD}As respostas do Andre sobre as descrições de cartão${RESET}\n`);

  const pending: (Resposta & { categoryId: string; clientId: string | null; linhas: number; valor: bigint })[] = [];

  for (const r of RESPOSTAS) {
    const category = byCode.get(r.code);
    if (!category) throw new Error(`conta ${r.code} não existe`);
    const client = r.client
      ? (clients.find((c) => c.name.toLowerCase() === r.client!.toLowerCase()) ?? null)
      : null;
    if (r.client && !client) throw new Error(`cliente ${r.client} não existe`);

    // Quantas linhas sem conta esta regra alcança hoje.
    const [hit] = await sql<{ n: number; total: string }[]>`
      select count(*)::int as n, coalesce(sum(amount), 0)::text as total
        from cash_entries
       where entity_id = ${entityId} and category_id is null
         and direction = ${r.direction} and description ilike ${"%" + r.pattern + "%"}`;

    const already = seen.has(`${r.pattern}|${r.direction}`);
    const linhas = hit?.n ?? 0;
    const valor = fromNumeric(hit?.total ?? "0");

    console.log(
      `  ${r.pattern.padEnd(22)} ${r.direction === "out" ? "saída  " : "entrada"} → ` +
        `${r.code.padEnd(6)} ${category.name.slice(0, 22).padEnd(22)} ` +
        `${String(linhas).padStart(2)} linha(s) ${formatBRL(valor).padStart(12)}  ` +
        `${already ? `${YELLOW}regra já existe${RESET}` : `${GREEN}criar${RESET}`}`,
    );
    console.log(`  ${DIM}  "${r.disse}"${RESET}`);

    if (!already) {
      pending.push({ ...r, categoryId: category.id, clientId: client?.id ?? null, linhas, valor });
    }
  }

  for (const s of SEM_RESPOSTA) {
    console.log(`  ${s.pattern.padEnd(22)} ${DIM}sem conta — "${s.disse}"${RESET}`);
  }

  const alcance = pending.reduce((a, p) => a + p.valor, 0n);
  console.log(
    `\n${BOLD}${pending.length} regra(s) a criar${RESET}, alcançando ` +
      `${pending.reduce((a, p) => a + p.linhas, 0)} linha(s) sem conta, ${formatBRL(alcance)}.`,
  );
  console.log(
    `${DIM}A regra sozinha não move o razão — quem move é o npm run recategorize.${RESET}`,
  );

  async function write(db: Sql): Promise<number> {
    let n = 0;
    for (const p of pending) {
      await db`
        insert into categorization_rules
          (entity_id, priority, match_type, pattern, direction, category_id, client_id, active)
        values (${entityId}, 50, 'contains', ${p.pattern}, ${p.direction},
                ${p.categoryId}, ${p.clientId}, true)`;
      n += 1;
    }
    return n;
  }

  if (pending.length === 0) {
    console.log(`\n${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
        `ou --aplicar para criar as regras.${RESET}\n`,
    );
  } else {
    const done = await (REHEARSE
      ? sql
          .begin(async (tx) => {
            const count = await write(tx as unknown as Sql);
            throw new Rollback(String(count));
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) return Number(error.message);
            throw error;
          })
      : write(sql));

    console.log(`\n${GREEN}${done} regra(s) ${REHEARSE ? "seriam criadas" : "criadas"}${RESET}.`);
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log(`${DIM}agora rode npm run recategorize para levá-las ao razão.${RESET}\n`);
  }
} finally {
  await sql.end();
}
