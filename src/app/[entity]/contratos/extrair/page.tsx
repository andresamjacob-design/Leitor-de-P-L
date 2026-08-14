import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ExtractForm } from "./extract-form";
import { resolveScope } from "@/lib/entities";
import { isAiConfigured } from "@/lib/ai/provider";

export default async function ExtractContractPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return (
      <ConsolidatedNotice
        title="Ler contrato"
        description="Um contrato pertence a uma entidade."
        entities={scope.entities}
        path="contratos/extrair"
      />
    );
  }

  if (!isAiConfigured()) {
    return (
      <>
        <PageHeader title="Ler contrato" description="Extração de rascunho por IA." />
        <EmptyState title="IA não configurada">
          Defina <code className="font-mono">ANTHROPIC_API_KEY</code> em{" "}
          <code className="font-mono">.env.local</code> para usar esta tela. Ela só reduz
          digitação —{" "}
          <Link href={`/${slug}/contratos/novo`} className="text-accent underline underline-offset-2">
            cadastrar o contrato à mão
          </Link>{" "}
          faz exatamente a mesma coisa.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ler contrato"
        description="A IA lê o documento e propõe os campos, com o trecho de origem ao lado. Você confirma."
      />
      <ExtractForm slug={slug} />
    </>
  );
}
