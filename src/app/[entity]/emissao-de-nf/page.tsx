import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { loadEmissaoDeNf } from "@/lib/data/inadimplencia";
import { resolveScope } from "@/lib/entities";
import { formatPeriod, formatPeriodShort, formatPtBRDate } from "@/lib/dates";
import { PAGA_A_PARTIR_DE, type NotaAvaliada, type Recebimento, type SituacaoDaNota } from "@/lib/inadimplencia";
import { formatMoney, sum } from "@/lib/money";
import { cn } from "@/lib/utils";

const COR: Record<SituacaoDaNota, string> = {
  paga: "text-emerald-700 dark:text-emerald-400",
  "a vencer": "text-amber-700 dark:text-amber-300",
  atrasada: "bg-red-50 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300",
  prevista: "text-muted",
};

const LEGENDA: { situacao: SituacaoDaNota; texto: string }[] = [
  { situacao: "paga", texto: "paga" },
  { situacao: "a vencer", texto: "no prazo" },
  { situacao: "atrasada", texto: "atrasada" },
  { situacao: "prevista", texto: "prevista (mês que ainda não chegou)" },
];

function titulo(nota: NotaAvaliada): string {
  const base = `vence ${formatPtBRDate(nota.vencimento)}`;
  if (nota.situacao === "paga") return `paga — recebido ${formatMoney(nota.pago)}`;
  if (nota.situacao === "prevista") return "prevista na planilha";
  const recebido = nota.pago > 0n ? ` · recebido ${formatMoney(nota.pago)} de ${formatMoney(nota.valor)}` : "";
  return nota.situacao === "atrasada" ? `${base} · ${nota.diasDeAtraso} dias de atraso${recebido}` : `${base}${recebido}`;
}

function TabelaDeRecebimentos({ recebimentos }: { recebimentos: Recebimento[] }) {
  return (
    <div className="mb-8">
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th className="w-24">Data</Th>
              <Th>Descrição</Th>
              <Th numeric className="w-32">Valor</Th>
            </tr>
          </thead>
          <tbody>
            {recebimentos.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-xs text-muted tabular">{formatPtBRDate(r.data)}</Td>
                <Td className="text-xs">{r.descricao}</Td>
                <Td numeric>{formatMoney(r.valor)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </div>
  );
}

export default async function EmissaoDeNfPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return (
      <ConsolidatedNotice
        title="Emissão de NF"
        description="As notas emitidas e quem ainda não pagou."
        entities={scope.entities}
        path="emissao-de-nf"
      />
    );
  }

  const dados = await loadEmissaoDeNf(scope.entity.id);

  if (dados.linhas.length === 0) {
    return (
      <>
        <PageHeader title="Emissão de NF" />
        <EmptyState title="A emissão de NF da planilha ainda não foi copiada">
          Rode <code>npm run importar:nf -- --aplicar</code> para copiar o bloco “Emissão de NF”
          da aba Clientes da planilha de fluxo.
        </EmptyState>
      </>
    );
  }

  const atrasados = dados.pagadores.filter((p) => p.situacao === "atrasado");
  const emAtraso = sum(atrasados.map((p) => p.emAtraso));
  const aVencer = sum(dados.pagadores.map((p) => p.aVencer));
  const notaPorCelula = new Map<string, NotaAvaliada>();
  for (const p of dados.pagadores) for (const n of p.notas) notaPorCelula.set(`${n.ordem}|${n.periodo}`, n);
  const semCliente = dados.recebimentosSemPagador.filter((r) => r.clientId === null);
  const semNota = dados.recebimentosSemPagador.filter((r) => r.clientId !== null);
  const semPagador = sum(semCliente.map((r) => r.valor));
  const retencao = Number(100n - PAGA_A_PARTIR_DE.numerador);

  return (
    <>
      <PageHeader
        title="Emissão de NF"
        description={
          "As notas da aba Clientes da planilha, conferidas com o que entrou no extrato. A nota " +
          "pode ser paga até o fim do mês seguinte ao da emissão; depois disso, está atrasada."
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-muted">Em atraso</p>
          <p className="mt-1 text-lg font-semibold tabular text-red-700 dark:text-red-300">
            R$ {formatMoney(emAtraso)}
          </p>
          <p className="text-xs text-muted">
            {atrasados.length} cliente{atrasados.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-muted">No prazo, ainda a receber</p>
          <p className="mt-1 text-lg font-semibold tabular">R$ {formatMoney(aVencer)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-muted">Recebido sem cliente identificado</p>
          <p className="mt-1 text-lg font-semibold tabular">R$ {formatMoney(semPagador)}</p>
          <p className="text-xs text-muted">pode estar pagando uma nota “atrasada”</p>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Clientes com pagamento atrasado</h2>
      {atrasados.length === 0 ? (
        <p className="mb-8 text-sm text-muted">Nenhum. Toda nota vencida foi paga.</p>
      ) : (
        <div className="mb-8">
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Notas em atraso</Th>
                  <Th numeric className="w-32">Em atraso</Th>
                  <Th numeric className="w-24">Atraso</Th>
                  <Th className="w-32">Último recebimento</Th>
                </tr>
              </thead>
              <tbody>
                {atrasados.map((p) => {
                  const notas = p.notas.filter((n) => n.situacao === "atrasada");
                  const ultimo = p.recebimentos[p.recebimentos.length - 1];
                  return (
                    <tr key={p.chave}>
                      <Td className="font-medium">{p.nome}</Td>
                      <Td className="text-xs text-muted">
                        {notas
                          .map((n) => `${formatPeriodShort(n.periodo)} ${formatMoney(n.valor - n.pago)}${n.rotulo !== p.nome ? ` (${n.rotulo})` : ""}`)
                          .join(" · ")}
                      </Td>
                      <Td numeric className="text-red-700 dark:text-red-300">{formatMoney(p.emAtraso)}</Td>
                      <Td numeric>{p.diasDeAtraso} dias</Td>
                      <Td className="whitespace-nowrap text-xs text-muted tabular">
                        {ultimo ? `${formatPtBRDate(ultimo.data)} · ${formatMoney(ultimo.valor)}` : "nenhum"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold">Emissão de NF</h2>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {LEGENDA.map((l) => (
          <span key={l.situacao} className={cn("rounded px-1", COR[l.situacao])}>
            ■ {l.texto}
          </span>
        ))}
        <span className="text-muted">
          · cinza sem cor: antes de {formatPeriod(dados.desde)}, quando o extrato começa
        </span>
      </div>
      <div className="mb-8">
        <TableScroll>
          <Table className="text-xs">
            <thead>
              <tr>
                <Th className="sticky left-0 z-10 bg-surface">Cliente</Th>
                {dados.periodos.map((periodo) => (
                  <Th key={periodo} numeric>
                    {formatPeriodShort(periodo)}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((linha) => (
                <tr key={linha.ordem}>
                  <Td className="sticky left-0 z-10 whitespace-nowrap bg-surface">{linha.rotulo}</Td>
                  {dados.periodos.map((periodo) => {
                    const valor = linha.notas.find((n) => n.periodo === periodo)?.valor;
                    if (valor === undefined) return <Td key={periodo} />;
                    const nota = notaPorCelula.get(`${linha.ordem}|${periodo}`);
                    return (
                      <Td
                        key={periodo}
                        numeric
                        title={nota ? titulo(nota) : undefined}
                        className={nota ? COR[nota.situacao] : "text-muted"}
                      >
                        {formatMoney(valor)}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <p className="mt-2 text-xs text-muted">
          O pagamento quita a nota aberta mais antiga do mesmo cliente, identificado pelo CNPJ de
          quem pagou ou pelo cliente do lançamento. Recebido {100 - retencao}% da nota, ela está
          paga: os {retencao}% são a retenção de impostos na fonte. Cópia de{" "}
          {dados.arquivo ?? "—"}
          {dados.copiadaEm ? `, feita em ${formatPtBRDate(dados.copiadaEm.slice(0, 10))}` : ""}.
        </p>
      </div>

      {semCliente.length > 0 ? (
        <>
          <h2 className="mb-1 text-sm font-semibold">Recebimentos sem cliente identificado</h2>
          <p className="mb-2 text-xs text-muted">
            Entraram como receita mas não chegam a nenhum cliente: sem cliente no lançamento e
            sem CNPJ que a planilha conheça. Ligue o cliente em Lançamentos e eles passam a pagar
            as notas dele.
          </p>
          <TabelaDeRecebimentos recebimentos={semCliente} />
        </>
      ) : null}

      {semNota.length > 0 ? (
        <>
          <h2 className="mb-1 text-sm font-semibold">Recebimentos de cliente sem nota na planilha</h2>
          <p className="mb-2 text-xs text-muted">
            O cliente está ligado, mas não tem linha na Emissão de NF da planilha — falta lançar a
            nota lá.
          </p>
          <TabelaDeRecebimentos recebimentos={semNota} />
        </>
      ) : null}

      {dados.semIdentificacao.length > 0 ? (
        <p className="text-xs text-muted">
          Sem cliente nem CNPJ, não classificadas: {dados.semIdentificacao.map((l) => l.rotulo).join(", ")}.
        </p>
      ) : null}
    </>
  );
}
