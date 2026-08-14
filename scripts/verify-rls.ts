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
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;

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

