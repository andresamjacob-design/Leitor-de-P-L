import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listarFolha } from "@/lib/data/folha";
import { resolveScope } from "@/lib/entities";
import { todayInSaoPaulo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { removerSalarioAction } from "../actions";
import { SalarioForm } from "../folha-forms";

const mesLegivel = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

export default async function LinhaDaFolhaPage({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope || scope.kind === "consolidated") notFound();
  const linha = (await listarFolha(scope.entity.id)).find((l) => l.id === id);
  if (!linha) notFound();
  const mesPadrao = todayInSaoPaulo().slice(0, 7);
  const historico = [...linha.historico].sort((a, b) => a.mes.localeCompare(b.mes) || a.tipo.localeCompare(b.tipo));

  return (
    <>
      <PageHeader
        title={linha.nome}
        description={[linha.cliente, linha.squad, linha.cargo, linha.conta === "6.11" ? "sócio (pró-labore)" : "time (salários)"]
          .filter(Boolean)
          .join(" · ")}
      />
      <p className="mb-6 text-sm">
        <Link href={`/${slug}/folha`} className="text-accent hover:underline">
          ← Voltar para a folha
        </Link>
      </p>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <SalarioForm slug={slug} linhaId={linha.id} tipo="vigente" mesPadrao={mesPadrao} />
        <SalarioForm slug={slug} linhaId={linha.id} tipo="so_no_mes" mesPadrao={mesPadrao} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Histórico</h2>
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th>Mês</Th>
              <Th>Tipo</Th>
              <Th numeric>Valor</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {historico.map((h) => (
              <tr key={h.id}>
                <Td>{mesLegivel(h.mes)}</Td>
                <Td className="text-xs">{h.tipo === "vigente" ? "salário a partir deste mês" : "só neste mês"}</Td>
                <Td numeric>{formatMoney(h.valor)}</Td>
                <Td>
                  <form action={removerSalarioAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="valor" value={h.id} />
                    <input type="hidden" name="mes" value={h.mes} />
                    <input type="hidden" name="tipo" value={h.tipo} />
                    <button type="submit" className="text-xs text-muted underline">
                      apagar
                    </button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}
