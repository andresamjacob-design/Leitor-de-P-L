/**
 * SPEC §11 test 6: entity isolation, checked at the RLS level and not at the UI.
 *
 * This is the test that could not run until there was a real Postgres (pending as Q5 since
 * Fase 1). It needs no Supabase Auth user: RLS reads `auth.uid()`, which Supabase derives
 * from `request.jwt.claims`, and that setting can be forged locally — which is exactly
 * what a session does.
 *
 * Everything happens inside a transaction that is **rolled back**, so the database is
 * untouched. Running this against production data is safe by construction.
 *
 *   npm run verify:rls
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";

let failures = 0;

function check(label: string, passed: boolean, detail = ""): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? GREEN + "OK   " : RED + "FALHA"}${RESET} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Como uma sessão aberta pelo código do e-mail aparece no JWT (D156). */
const POR_CODIGO = [{ method: "otp", timestamp: 0 }];

/** Thrown to undo everything the check inserted. */
class Rollback extends Error {}

const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  await sql.begin(async (tx) => {
    const entities = await tx<{ id: string; slug: string }[]>`
      select id, slug from entities order by slug`;

    if (entities.length < 2) {
      console.log("são necessárias duas entidades no banco. Rode npm run db:seed.");
      failures += 1;
      return;
    }

    const alpha = entities[0] as { id: string; slug: string };
    const beta = entities[1] as { id: string; slug: string };
    const userId = "00000000-0000-4000-8000-0000000000aa";

    // A synthetic user with access to one entity only.
    await tx`insert into user_entities (user_id, entity_id, role) values (${userId}, ${alpha.id}, 'owner')`;

    // One account and one movement in each entity, so there is something to leak.
    const insertedA = await tx<{ id: string }[]>`
      insert into accounts (entity_id, name, type, opening_date)
      values (${alpha.id}, 'RLS teste A', 'bank', '2026-01-01') returning id`;
    const insertedB = await tx<{ id: string }[]>`
      insert into accounts (entity_id, name, type, opening_date)
      values (${beta.id}, 'RLS teste B', 'bank', '2026-01-01') returning id`;

    const accountA = (insertedA[0] as { id: string }).id;
    const accountB = (insertedB[0] as { id: string }).id;

    await tx`
      insert into cash_entries (entity_id, account_id, occurred_on, amount, direction, description, dedup_hash)
      values (${alpha.id}, ${accountA}, '2026-01-10', 100.00, 'in', 'visível', 'rls-a')`;
    await tx`
      insert into cash_entries (entity_id, account_id, occurred_on, amount, direction, description, dedup_hash)
      values (${beta.id}, ${accountB}, '2026-01-10', 999.00, 'in', 'não deve aparecer', 'rls-b')`;

    console.log(`\nUsuário sintético com acesso só a “${alpha.slug}”\n`);

    // From here on, the connection is an ordinary logged-in user.
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated", amr: POR_CODIGO })}, true)`;

    const visibleEntities = await tx<{ slug: string }[]>`select slug from entities`;
    check(
      "entities devolve só a entidade permitida",
      visibleEntities.length === 1 && visibleEntities[0]?.slug === alpha.slug,
      `viu ${visibleEntities.length}: ${visibleEntities.map((e) => e.slug).join(", ") || "nenhuma"}`,
    );

    const visibleAccounts = await tx<{ name: string }[]>`select name from accounts`;
    check(
      "accounts não vaza conta da outra entidade",
      visibleAccounts.every((row) => row.name !== "RLS teste B"),
      `${visibleAccounts.length} conta(s)`,
    );

    const visibleEntries = await tx<{ description: string }[]>`select description from cash_entries`;
    check(
      "cash_entries não vaza lançamento da outra entidade",
      visibleEntries.every((row) => row.description !== "não deve aparecer"),
      `${visibleEntries.length} lançamento(s)`,
    );

    // Filtering by the other entity's id explicitly must still return nothing.
    const forced = await tx<{ id: string }[]>`select id from cash_entries where entity_id = ${beta.id}`;
    check("consulta direta pelo id da outra entidade devolve vazio", forced.length === 0);

    const otherCategories = await tx<{ id: string }[]>`
      select id from categories where entity_id = ${beta.id} limit 1`;
    check("categories da outra entidade também não aparecem", otherCategories.length === 0);

    // Writing into the other entity has to be refused by the WITH CHECK clause.
    //
    // Inside a savepoint: a failed statement aborts the whole transaction in Postgres, and
    // without this the checks after it would never run — which is how the first version of
    // this script quietly stopped one check short.
    let refused = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          insert into cash_entries (entity_id, account_id, occurred_on, amount, direction, description, dedup_hash)
          values (${beta.id}, ${accountB}, '2026-02-01', 1.00, 'out', 'invasão', 'rls-x')`;
      });
    } catch {
      refused = true;
    }
    check("gravar na outra entidade é recusado pelo RLS", refused);

    const membership = await tx<{ user_id: string }[]>`select user_id from user_entities`;
    check(
      "user_entities mostra só o próprio vínculo",
      membership.every((row) => row.user_id === userId),
      `${membership.length} vínculo(s)`,
    );

    // ---- Papéis (D155): viewer lê, member escreve, owner administra -------------------
    await tx`reset role`;
    const viewerId = "00000000-0000-4000-8000-0000000000ab";
    const memberId = "00000000-0000-4000-8000-0000000000ac";
    await tx`insert into user_entities (user_id, entity_id, role) values
               (${viewerId}, ${alpha.id}, 'viewer'), (${memberId}, ${alpha.id}, 'member')`;

    const como = async (id: string, amr = POR_CODIGO) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: "authenticated", amr })}, true)`;
    };
    const recusa = async (fn: (sp: typeof tx) => Promise<unknown>) => {
      try {
        await tx.savepoint(async (sp) => {
          await fn(sp as unknown as typeof tx);
        });
        return false;
      } catch {
        return true;
      }
    };
    const inserirLancamento = (sp: typeof tx, hash: string) => sp`
      insert into cash_entries (entity_id, account_id, occurred_on, amount, direction, description, dedup_hash)
      values (${alpha.id}, ${accountA}, '2026-03-01', 1.00, 'out', 'papel', ${hash})`;

    console.log(`\nPapéis na “${alpha.slug}”\n`);

    await como(viewerId);
    const lidoViewer = await tx<{ n: number }[]>`select count(*)::int as n from cash_entries`;
    check("viewer lê os lançamentos", (lidoViewer[0]?.n ?? 0) > 0, `${lidoViewer[0]?.n} lançamento(s)`);
    check("viewer não grava lançamento", await recusa((sp) => inserirLancamento(sp, "rls-viewer")));
    const alterados = await tx`update accounts set name = name where entity_id = ${alpha.id}`;
    check("viewer não altera nada", alterados.count === 0, `${alterados.count} linha(s)`);
    check("viewer não lista acessos", await recusa((sp) => sp`select * from listar_acessos(${alpha.id})`));

    await como(memberId);
    check("member grava lançamento", !(await recusa((sp) => inserirLancamento(sp, "rls-member"))));
    check("member não lista acessos", await recusa((sp) => sp`select * from listar_acessos(${alpha.id})`));
    check(
      "member não libera ninguém",
      await recusa((sp) => sp`select definir_acesso(${alpha.id}, 'alguem@ddgroup.com.br', 'owner')`),
    );

    await como(userId);
    check("owner lista acessos", !(await recusa((sp) => sp`select * from listar_acessos(${alpha.id})`)));
    check(
      "owner não libera e-mail de fora do domínio",
      await recusa((sp) => sp`select definir_acesso(${alpha.id}, 'alguem@gmail.com', 'viewer')`),
    );
    const liberado = await tx<{ r: string }[]>`
      select definir_acesso(${alpha.id}, 'rls.teste@ddgroup.com.br', 'viewer') as r`;
    check("owner libera e-mail da empresa antes do primeiro login", liberado[0]?.r === "aguardando primeiro login");

    // D156: o mesmo administrador, numa sessão aberta só com senha — o caminho de quem se
    // cadastra com o e-mail de outra pessoa sem controlar a caixa postal.
    await como(userId, [{ method: "password", timestamp: 0 }]);
    const lidoSenha = await tx<{ n: number }[]>`select count(*)::int as n from cash_entries`;
    check("sessão só com senha não vê lançamento nenhum", lidoSenha[0]?.n === 0, `${lidoSenha[0]?.n} lançamento(s)`);
    check("sessão só com senha não lista acessos", await recusa((sp) => sp`select * from listar_acessos(${alpha.id})`));
    check("sessão só com senha não grava", await recusa((sp) => inserirLancamento(sp, "rls-senha")));

    await como(viewerId);
    check(
      "viewer não forja registro de auditoria",
      await recusa((sp) => sp`insert into audit_log (entity_id, actor, action, table_name, row_id)
        values (${alpha.id}, 'forjado', 'update', 'cash_entries', gen_random_uuid())`),
    );

    await tx`reset role`;
    check(
      "conta nova de fora do domínio é recusada pelo banco",
      await recusa((sp) => sp`insert into auth.users (id, email, aud, role)
        values (gen_random_uuid(), 'rls.teste@gmail.com', 'authenticated', 'authenticated')`),
    );
    const nova = await tx<{ id: string }[]>`insert into auth.users (id, email, aud, role)
      values (gen_random_uuid(), 'RLS.Teste@ddgroup.com.br', 'authenticated', 'authenticated') returning id`;
    const vinculo = await tx<{ role: string }[]>`
      select role::text as role from user_entities where user_id = ${nova[0]!.id} and entity_id = ${alpha.id}`;
    check("conta da empresa nasce com o acesso liberado antes", vinculo[0]?.role === "viewer");

    // Roll back: nothing above ever existed.
    throw new Rollback();
  });
} catch (cause) {
  if (!(cause instanceof Rollback)) {
    console.log(`${RED}erro${RESET}: ${cause instanceof Error ? cause.message : String(cause)}`);
    failures += 1;
  }
} finally {
  await sql.end();
}

console.log(
  failures === 0
    ? `\n${GREEN}isolamento entre entidades confirmado no nível do RLS${RESET} (SPEC §11, teste 6)`
    : `\n${RED}${failures} verificação(ões) falharam${RESET}`,
);

if (failures > 0) process.exitCode = 1;

