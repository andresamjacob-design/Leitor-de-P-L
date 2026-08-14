"use client";

import { useActionState } from "react";
import { saveBatchPocAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { EMPTY_FORM_STATE } from "@/lib/form";

export type PocRow = {
  contractId: string;
  contractName: string;
  clientName: string;
  totalValue: string;
  lastCumulative: string | null;
  lastPeriod: string | null;
  recognized: bigint;
  alreadyReported: string | null;
};

/**
 * One screen, every open project, one person filling it in (D1). Reporting for a whole
 * portfolio should not be twelve page loads.
 */
export function BatchPocForm({
  slug,
  defaultPeriod,
  rows,
}: {
  slug: string;
  defaultPeriod: string;
  rows: PocRow[];
}) {
  const [state, action, pending] = useActionState(saveBatchPocAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <Field
        label="Mês do reporte"
        htmlFor="period"
        className="max-w-xs"
        hint="Vale para todas as linhas preenchidas abaixo."
      >
        <Input
          id="period"
          name="period"
          type="month"
          defaultValue={state.values?.period ?? defaultPeriod}
          required
        />
      </Field>

      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th>Projeto</Th>
              <Th>Cliente</Th>
              <Th numeric className="w-32">Valor</Th>
              <Th numeric className="w-32">Reconhecido</Th>
              <Th className="w-28">Último</Th>
              <Th className="w-32">% acumulado</Th>
              <Th className="w-24">Correção</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contractId}>
                <Td>{row.contractName}</Td>
                <Td className="text-xs text-muted">{row.clientName}</Td>
                <Td numeric className="text-xs text-muted">{row.totalValue}</Td>
                <Td numeric className="text-xs text-muted">{formatMoney(row.recognized)}</Td>
                <Td className="text-xs text-muted">
                  {row.lastCumulative === null ? "—" : `${row.lastCumulative}%`}
                </Td>
                <Td>
                  <Input
                    name={`pct-${row.contractId}`}
                    inputMode="decimal"
                    defaultValue={row.alreadyReported ?? ""}
                    placeholder={row.lastCumulative ?? "0"}
                    aria-label={`Percentual de ${row.contractName}`}
                    className="h-8 text-sm"
                  />
                </Td>
                <Td>
                  <input
                    type="checkbox"
                    name={`fix-${row.contractId}`}
                    aria-label={`Correção em ${row.contractName}`}
                    className="size-4"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Gravando…" : "Reportar e reconhecer"}
        </Button>
        <span className="text-xs text-muted">
          Linha em branco não é reportada — o mês fica sem reporte e reconhece zero.
        </span>
      </div>
    </form>
  );
}
