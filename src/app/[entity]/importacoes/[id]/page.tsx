import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { FormNotice } from "@/components/ui/field";
import { ReviewForm } from "./review-form";
import { getAccount } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { getImport, listStaged } from "@/lib/data/imports";
import { resolveScope } from "@/lib/entities";
import { formatPtBRDate } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";

export default async function ReviewImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string; id: string }>;
  searchParams: Promise<{ avisos?: string }>;
}) {
  const { entity: slug, id } = await params;
  const { avisos } = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const record = await getImport(id);
  if (!record) notFound();

  const [staged, account, categories] = await Promise.all([
    listStaged(id),
    getAccount(record.accountId),
    listCategories([record.entityId]),
  ]);

  const pending = staged.filter((row) => row.status === "pending");
  const approved = staged.filter((row) => row.status === "approved");
  const duplicates = staged.filter((row) => row.status === "duplicate");
  const rejected = staged.filter((row) => row.status === "rejected");

  const total = sum(
    staged.map((row) => (row.direction === "in" ? row.amount : -row.amount)),
  );

  const warnings = (avisos ?? "").split("\n").filter((line) => line.trim() !== "");

  return (
    <>
      <PageHeader
        title={record.filename}
        description={`${account?.name ?? "conta desconhecida"} · ${
          record.periodStart && record.periodEnd
            ? `${formatPtBRDate(record.periodStart)} a ${formatPtBRDate(record.periodEnd)}`
            : "período não declarado"
        }`}
      />

      <div className="mb-4 flex flex-col gap-2">
        {warnings.map((warning) => (
          <FormNotice key={warning}>{warning}</FormNotice>
        ))}
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Linhas lidas</dt>
          <dd className="tabular">{staged.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Aguardando</dt>
          <dd className="tabular">{pending.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Já no ledger</dt>
          <dd className="tabular">{duplicates.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Soma do arquivo</dt>
          <dd className="tabular">{formatMoney(total)}</dd>
        </div>
      </dl>

      {record.statementClosingBalance !== null ? (
        <p className="mb-6 text-xs text-muted">
          Saldo de fechamento declarado no extrato:{" "}
          <span className="tabular">{formatMoney(record.statementClosingBalance)}</span>.
        </p>
      ) : null}

      {staged.length === 0 ? (
        <p className="text-sm text-muted">Este arquivo não produziu nenhuma linha.</p>
      ) : (
        <ReviewForm slug={slug} importId={id} staged={staged} categories={categories} />
      )}

      {approved.length > 0 ? (
        <p className="mt-6 text-sm">
          {approved.length} lançamento{approved.length === 1 ? "" : "s"} já{" "}
          {approved.length === 1 ? "foi criado" : "foram criados"} —{" "}
          <Link
            href={`/${slug}/lancamentos?de=${record.periodStart ?? ""}&ate=${record.periodEnd ?? ""}`}
            className="text-accent hover:underline"
          >
            ver no ledger
          </Link>
          .
        </p>
      ) : null}

      {rejected.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {rejected.length} linha{rejected.length === 1 ? "" : "s"} rejeitada
          {rejected.length === 1 ? "" : "s"}, que não vão para o ledger.
        </p>
      ) : null}
    </>
  );
}
