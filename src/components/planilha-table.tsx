import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { formatPeriodShort } from "@/lib/dates";
import { formatMoney, fromNumeric } from "@/lib/money";
import { razaoEmPercentual, type LinhaPlanilha } from "@/lib/planilha";
import { formatPercent, parsePercent } from "@/lib/recognition/percent";
import { cn } from "@/lib/utils";

/**
 * A planilha do Andre, desenhada como ele a vê: as linhas na ordem dele, doze meses e o total
 * que a própria planilha declara (D141). Nenhum número é calculado aqui — a célula vira
 * centavo pelo `fromNumeric`, que arredonda uma vez o resto de fórmula (`30714.28571`), e
 * é só.
 */
export function PlanilhaTable({
  linhas,
  ano,
  mesesCalculados = [],
}: {
  /** `calculado`, quando vem, marca as células que o app preencheu a partir do extrato (D146). */
  linhas: readonly (LinhaPlanilha & { calculado?: boolean[] })[];
  ano: string;
  /** Os meses (janeiro = 0) que o app preencheu — o cabeçalho deles leva a marca. */
  mesesCalculados?: readonly number[];
}) {
  const doApp = new Set(mesesCalculados);
  const meses = Array.from(
    { length: 12 },
    (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`,
  );
  const colunas = meses.length + 2;

  function valor(celula: string | null, percentual: boolean) {
    if (celula === null) return <span className="text-muted">—</span>;
    if (percentual) {
      const p = parsePercent(razaoEmPercentual(celula));
      return <span>{formatPercent(p)}%</span>;
    }
    const cents = fromNumeric(celula);
    if (cents === 0n) return <span className="text-muted">—</span>;
    return <Amount value={cents} format={formatMoney} />;
  }

  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th className="sticky left-0 bg-background">Linha</Th>
            {meses.map((mes, i) => (
              <Th
                key={mes}
                numeric
                className={doApp.has(i) ? "text-accent" : undefined}
                title={doApp.has(i) ? "calculado pelo app a partir do extrato" : undefined}
              >
                {formatPeriodShort(mes)}
                {doApp.has(i) ? " · app" : ""}
              </Th>
            ))}
            <Th numeric>Total</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => {
            if (linha.tipo === "secao") {
              return (
                <tr key={linha.ordem}>
                  <Th
                    scope="colgroup"
                    colSpan={colunas}
                    className="bg-surface text-xs uppercase tracking-wide"
                  >
                    {linha.rotulo}
                  </Th>
                </tr>
              );
            }

            const percentual = linha.tipo === "percentual";
            return (
              <tr
                key={linha.ordem}
                className={cn(
                  linha.tipo === "total" &&
                    "border-t-2 border-border font-semibold",
                  linha.tipo === "grupo" && "font-medium",
                  percentual && "text-muted",
                )}
              >
                <Td
                  className={cn(
                    "sticky left-0 whitespace-nowrap bg-background",
                    linha.tipo === "linha" && "pl-6",
                  )}
                >
                  {linha.rotulo}
                  {linha.detalhe ? (
                    <span className="ml-2 text-xs font-normal text-muted">
                      {linha.detalhe}
                    </span>
                  ) : null}
                </Td>
                {linha.valores.map((celula, i) => (
                  <Td
                    key={meses[i]}
                    numeric
                    className={linha.calculado?.[i] ? "bg-accent/5 italic" : undefined}
                  >
                    {valor(celula, percentual)}
                  </Td>
                ))}
                <Td numeric className="font-medium">
                  {valor(linha.total, percentual)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
