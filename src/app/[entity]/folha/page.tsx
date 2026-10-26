import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listarFolha } from "@/lib/data/folha";
import { valorNoMes } from "@/lib/folha";
import { resolveScope } from "@/lib/entities";
import { todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";

const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DESCRICAO =
  "O salário de cada linha da folha, mês a mês. Ele repete até você registrar outro; a DRE usa estes valores.";

/**
 * A folha cadastrada (D161), na forma da aba `Colaboradores` do Andre: uma linha por pessoa
 * e cliente, os doze meses ao lado. Célula em itálico é valor "só deste mês".
 */
export default async function FolhaPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();
  if (scope.kind === "consolidated") {
    return <ConsolidatedNotice title="Folha" description={DESCRICAO} entities={scope.entities} path="folha" />;
  }

  const ano = todayInSaoPaulo().slice(0, 4);
  const meses = NOMES.map((_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);
  const linhas = await listarFolha(scope.entity.id);
  const grade = linhas.map((l) => ({
    linha: l,
    valores: meses.map((m) => valorNoMes(l.historico, m)),
    doMes: new Set(l.historico.filter((h) => h.tipo === "so_no_mes").map((h) => h.mes)),
  }));
  const totais = meses.map((_, i) => sum(grade.map((g) => g.valores[i] ?? 0n)));
  const ativas = grade.filter((g) => g.valores.some((v) => v > 0n));

  return (
    <>
      <PageHeader title="Folha" description={DESCRICAO} />
      <div className="mb-4 flex justify-end">
        <Link href={`/${slug}/folha/nova`} className={buttonVariants({ size: "sm" })}>
          Adicionar pessoa à folha
        </Link>
      </div>

      {ativas.length === 0 ? (
        <EmptyState title="Nenhuma linha de folha cadastrada">
          Adicione as pessoas da folha com o salário de cada uma; ele repete nos meses seguintes.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th className="sticky left-0 bg-background">Pessoa</Th>
                <Th>Cliente</Th>
                {NOMES.map((n) => (
                  <Th key={n} numeric>
                    {n}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ativas.map(({ linha, valores, doMes }) => (
                <tr key={linha.id}>
                  <Td className="sticky left-0 whitespace-nowrap bg-background">
                    <Link href={`/${slug}/folha/${linha.id}`} className="text-accent hover:underline">
                      {linha.nome}
                    </Link>
                    {linha.conta === "6.11" ? <span className="ml-2 text-xs text-muted">sócio</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{linha.cliente ?? "—"}</Td>
                  {valores.map((v, i) => (
                    <Td key={meses[i]} numeric className={doMes.has(meses[i]!) ? "italic" : ""}>
                      {v === 0n ? <span className="text-muted">—</span> : formatMoney(v)}
                    </Td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold">
                <Td className="sticky left-0 bg-background" colSpan={2}>
                  Total
                </Td>
                {totais.map((t, i) => (
                  <Td key={meses[i]} numeric>
                    {formatMoney(t)}
                  </Td>
                ))}
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}
      <p className="mt-4 text-xs text-muted">
        Em itálico: valor digitado só para aquele mês (entrada ou saída no meio do mês). Clique
        no nome para mudar o salário. {linhas.length - ativas.length > 0
          ? `${linhas.length - ativas.length} linha(s) sem valor neste ano não aparecem.`
          : null}
      </p>
    </>
  );
}
