import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { resolveScope } from "@/lib/entities";
import { todayInSaoPaulo } from "@/lib/dates";
import { NovaLinhaForm } from "../folha-forms";

export default async function NovaLinhaPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope || scope.kind === "consolidated") notFound();
  return (
    <>
      <PageHeader title="Adicionar pessoa à folha" description="O salário repete nos meses seguintes até você registrar outro." />
      <p className="mb-6 text-sm">
        <Link href={`/${slug}/folha`} className="text-accent hover:underline">
          ← Voltar para a folha
        </Link>
      </p>
      <NovaLinhaForm slug={slug} mesPadrao={todayInSaoPaulo().slice(0, 7)} />
    </>
  );
}
