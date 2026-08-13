/**
 * Seed. Idempotent — run it as many times as you like.
 *
 * Everything here is real: the two CNPJs, the Itaú account from the statement in
 * `docs/reference/`, and a chart of accounts lifted line by line from the `DRE Geral`
 * sheet so the P&L in Fase 6 can reproduce the spreadsheet the company already uses.
 *
 * One thing is deliberately NOT here: opening balances. The statement on hand is from
 * July 2026 and the backfill starts in January (DECISIONS D9), so the January opening
 * balance is not knowable from any file I have. It seeds as 0,00 and must be set before
 * the cash flow in Fase 2 means anything. SPEC §14: never invent a number.
 *
 *   DATABASE_URL=... npm run db:seed
 *   DATABASE_URL=... SEED_USER_EMAIL=voce@empresa.com npm run db:seed
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { accounts, categories, entities, userEntities } from "../src/lib/db/schema.ts";

type CategorySeed = {
  code: string;
  name: string;
  kind: "revenue" | "cost" | "expense" | "tax" | "transfer" | "owner_draw";
  dreGroup: string;
  parent?: string;
};

/**
 * Mirrors the DRE the company works from today. `dreGroup` plus the array order is what
 * reproduces its line ordering.
 */
const CHART_OF_ACCOUNTS: CategorySeed[] = [
  // Receita bruta
  { code: "3.01", name: "Receita — Suporte contínuo", kind: "revenue", dreGroup: "receita_bruta" },
  { code: "3.02", name: "Receita — Projeto", kind: "revenue", dreGroup: "receita_bruta" },
  { code: "3.03", name: "Receita — Referral", kind: "revenue", dreGroup: "receita_bruta" },
  { code: "3.04", name: "Receita — Parceria", kind: "revenue", dreGroup: "receita_bruta" },

  // Deduções
  { code: "4.01", name: "Impostos sobre a receita", kind: "tax", dreGroup: "deducoes" },
  { code: "4.02", name: "ISS", kind: "tax", dreGroup: "deducoes", parent: "4.01" },
  { code: "4.03", name: "PIS/COFINS", kind: "tax", dreGroup: "deducoes", parent: "4.01" },
  { code: "4.04", name: "IR/CSLL", kind: "tax", dreGroup: "deducoes", parent: "4.01" },

  // Custos diretos
  { code: "5.01", name: "Máquinas", kind: "cost", dreGroup: "custos_diretos" },

  // Pessoal
  { code: "6.01", name: "Pessoal", kind: "expense", dreGroup: "pessoal" },
  { code: "6.02", name: "Salários", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.03", name: "Férias", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.04", name: "13º salário", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.05", name: "Encargos (FGTS + INSS)", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.06", name: "Plano de saúde", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.07", name: "Seguro saúde (estagiários)", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.08", name: "Ticket restaurante", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.09", name: "Vale transporte", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.10", name: "Freelancers", kind: "expense", dreGroup: "pessoal", parent: "6.01" },
  { code: "6.11", name: "Pró-labore", kind: "owner_draw", dreGroup: "pessoal", parent: "6.01" },

  // Ferramentas e assinaturas — one line per tool, as the spreadsheet keeps them.
  { code: "7.00", name: "Ferramentas e assinaturas", kind: "expense", dreGroup: "ferramentas" },
  ...[
    "Google Workspace",
    "Salesforce",
    "Claude",
    "ChatGPT",
    "Slack",
    "Trello",
    "Clicksign",
    "Tarefy",
    "Escola.i",
    "Wix",
    "Adobe",
    "Canva",
    "Vindi",
    "Plaud",
    "NeverBounce",
    "Scribd",
    "Locaweb",
    "Tactic",
    "Railway",
    "LinkedIn",
  ].map<CategorySeed>((name, index) => ({
    code: `7.${String(index + 1).padStart(2, "0")}`,
    name,
    kind: "expense",
    dreGroup: "ferramentas",
    parent: "7.00",
  })),

  // Serviços de terceiros
  { code: "8.01", name: "Contabilidade", kind: "expense", dreGroup: "servicos" },
  { code: "8.02", name: "Jurídico", kind: "expense", dreGroup: "servicos" },
  { code: "8.03", name: "Agência", kind: "expense", dreGroup: "servicos" },

  // Viagem e representação
  { code: "9.01", name: "Passagens", kind: "expense", dreGroup: "viagem" },
  { code: "9.02", name: "Hotéis", kind: "expense", dreGroup: "viagem" },
  { code: "9.03", name: "Alimentação", kind: "expense", dreGroup: "viagem" },
  { code: "9.04", name: "Uber e transporte", kind: "expense", dreGroup: "viagem" },
  { code: "9.05", name: "Viagem e evento", kind: "expense", dreGroup: "viagem" },
  { code: "9.06", name: "Entretenimento", kind: "expense", dreGroup: "viagem" },

  // Outras despesas
  { code: "10.01", name: "Telefonia", kind: "expense", dreGroup: "outras" },
  { code: "10.02", name: "Brindes", kind: "expense", dreGroup: "outras" },
  { code: "10.03", name: "Materiais de job", kind: "expense", dreGroup: "outras" },
  { code: "10.04", name: "Reembolsos", kind: "expense", dreGroup: "outras" },
  { code: "10.05", name: "Outros", kind: "expense", dreGroup: "outras" },

  // Financeiras
  { code: "11.01", name: "Tarifas bancárias", kind: "expense", dreGroup: "financeiras" },
  { code: "11.02", name: "IOF", kind: "expense", dreGroup: "financeiras" },
  { code: "11.03", name: "Multas e acordos", kind: "expense", dreGroup: "financeiras" },

  // Transferências — never revenue, never expense. Keeps the card bill from
  // double-counting (SPEC §7, DECISIONS D-C).
  { code: "99.01", name: "Transferência entre contas", kind: "transfer", dreGroup: "transferencias" },
  { code: "99.02", name: "Pagamento de fatura de cartão", kind: "transfer", dreGroup: "transferencias" },
  { code: "99.03", name: "Aplicação e resgate automático", kind: "transfer", dreGroup: "transferencias" },
  { code: "99.04", name: "Distribuição de lucros", kind: "owner_draw", dreGroup: "socios" },
];

const ENTITIES = [
  {
    slug: "dd-group",
    name: "DD Group",
    legalName: "Dynamics Data Consulting Tecnologia LTDA",
    taxId: "50050390000182",
  },
  {
    slug: "gabriel-sampaio-jacob",
    name: "Gabriel Sampaio Jacob",
    legalName: "GABRIEL SAMPAIO JACOB LTDA - ME",
    taxId: "45207742000120",
  },
] as const;

/** Only DD Group's accounts are known from the files in `docs/reference/`. */
const ACCOUNTS = [
  {
    entitySlug: "dd-group",
    name: "Itaú — conta corrente",
    type: "bank" as const,
    institution: "Itaú Unibanco",
    branch: "0561",
    number: "0098873-4",
    lastDigits: "8873",
  },
  {
    entitySlug: "dd-group",
    name: "Itaucard",
    type: "credit_card" as const,
    institution: "Itaú Unibanco",
    branch: null,
    number: null,
    lastDigits: "4460",
  },
];

const OPENING_DATE = "2026-01-01";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definido — veja .env.example");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    const entityIds = new Map<string, string>();

    for (const entity of ENTITIES) {
      const [row] = await db
        .insert(entities)
        .values({ ...entity })
        .onConflictDoUpdate({
          target: entities.slug,
          set: { name: entity.name, legalName: entity.legalName, taxId: entity.taxId },
        })
        .returning({ id: entities.id });

      if (!row) throw new Error(`falha ao criar a entidade ${entity.slug}`);
      entityIds.set(entity.slug, row.id);
      console.log(`entidade  ${entity.slug}`);
    }

    for (const [slug, entityId] of entityIds) {
      const codeToId = new Map<string, string>();

      for (const [index, category] of CHART_OF_ACCOUNTS.entries()) {
        const parentId = category.parent ? codeToId.get(category.parent) : null;
        const [row] = await db
          .insert(categories)
          .values({
            entityId,
            code: category.code,
            name: category.name,
            kind: category.kind,
            dreGroup: category.dreGroup,
            parentId: parentId ?? null,
            sortOrder: index,
          })
          .onConflictDoUpdate({
            target: [categories.entityId, categories.code],
            set: {
              name: category.name,
              kind: category.kind,
              dreGroup: category.dreGroup,
              parentId: parentId ?? null,
              sortOrder: index,
            },
          })
          .returning({ id: categories.id });

        if (row) codeToId.set(category.code, row.id);
      }

      console.log(`contas    ${slug}: ${CHART_OF_ACCOUNTS.length} categorias`);
    }

    for (const account of ACCOUNTS) {
      const entityId = entityIds.get(account.entitySlug);
      if (!entityId) continue;

      const existing = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.entityId, entityId), eq(accounts.name, account.name)))
        .limit(1);

      if (existing.length > 0) {
        console.log(`conta     ${account.name} (já existia)`);
        continue;
      }

      await db.insert(accounts).values({
        entityId,
        name: account.name,
        type: account.type,
        institution: account.institution,
        branch: account.branch,
        number: account.number,
        lastDigits: account.lastDigits,
        openingBalance: "0",
        openingDate: OPENING_DATE,
      });
      console.log(`conta     ${account.name} — saldo de abertura 0,00, precisa ser corrigido`);
    }

    // Link a user to both entities, when one is named and already exists in Supabase Auth.
    const email = process.env.SEED_USER_EMAIL;
    if (email) {
      const found = await client<{ id: string }[]>`
        select id from auth.users where email = ${email} limit 1
      `;
      const user = found[0];

      if (!user) {
        console.log(
          `usuário   ${email} não encontrado em auth.users — convide pelo painel do ` +
            `Supabase e rode o seed de novo`,
        );
      } else {
        for (const entityId of entityIds.values()) {
          await db
            .insert(userEntities)
            .values({ userId: user.id, entityId, role: "owner" })
            .onConflictDoNothing();
        }
        console.log(`usuário   ${email} ligado a ${entityIds.size} entidades`);
      }
    } else {
      console.log("usuário   SEED_USER_EMAIL não definido — nenhum acesso concedido");
    }

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(categories);
    console.log(`\npronto. ${count} categorias no total.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
