import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { PageHeader } from "@/components/page-header";
import { RuleForm } from "../rule-form";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { getCashEntry } from "@/lib/data/cash-entries";
import { proposeRuleFrom } from "@/lib/categorize/engine";
import { resolveScope } from "@/lib/entities";
import type { Rule } from "@/lib/categorize/types";

/**
 * A blank rule, or one pre-filled from a movement the user just categorised by hand —
 * `?de=<id>` on the entry screen. Proposing beats asking someone to retype a pattern
 * they already have in front of them.
 */
export default async function NewRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  const { entity: slug } = await params;
  const { de } = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return (
      <ConsolidatedNotice
        title="Nova regra"
        description="Uma regra pertence a uma entidade."
        entities={scope.entities}
        path="regras/nova"
      />
    );
  }

  const [categories, accounts] = await Promise.all([
    listCategories([scope.entity.id]),
    listAccounts([scope.entity.id], { includeInactive: true }),
  ]);

  let draft: Rule | null = null;
  let origin: string | null = null;

  if (de) {
    const entry = await getCashEntry(de);
    if (entry) {
      const proposal = proposeRuleFrom({
        description: entry.description,
        amount: entry.amount,
        direction: entry.direction,
        accountId: entry.accountId,
        counterpartyTaxId: entry.counterpartyTaxId,
        counterpartyName: entry.counterpartyName,
      });

      origin = entry.description;
      draft = {
        id: "",
        priority: 100,
        matchType: proposal.matchType,
        pattern: proposal.pattern,
        counterpartyTaxId: proposal.counterpartyTaxId,
        amountMin: null,
        amountMax: null,
        accountId: null,
        categoryId: entry.categoryId ?? "",
        clientId: entry.clientId,
        personId: entry.personId,
        active: true,
        hitCount: 0,
      };
    }
  }

  return (
    <>
      <PageHeader
        title="Nova regra"
        description={origin ? `A partir de “${origin}”` : scope.entity.name}
      />
      <RuleForm slug={slug} rule={draft} categories={categories} accounts={accounts} />
    </>
  );
}
