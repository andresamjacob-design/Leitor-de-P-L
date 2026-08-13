"use client";

import { useActionState, useState } from "react";
import { reviewImportAction } from "../actions";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice, Select } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { formatPtBRDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { StagedTransaction } from "@/lib/data/imports";
import type { Category } from "@/lib/data/categories";

const STATUS_LABEL: Record<string, string> = {
  pending: "",
  approved: "aprovada",
  rejected: "rejeitada",
  duplicate: "duplicata",
};

export function ReviewForm({
  slug,
  importId,
  staged,
  categories,
}: {
  slug: string;
  importId: string;
  staged: StagedTransaction[];
  categories: Category[];
}) {
  const [state, action, pending] = useActionState(reviewImportAction, EMPTY_FORM_STATE);
  const pendingRows = staged.filter((row) => row.status === "pending");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(pendingRows.map((row) => row.id)),
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = pendingRows.length > 0 && selected.size === pendingRows.length;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="importId" value={importId} />

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      {pendingRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="decision" value="approve" disabled={pending || selected.size === 0}>
            {pending ? "Gravando…" : `Aprovar ${selected.size}`}
          </Button>
          <Button
            type="submit"
            name="decision"
            value="reject"
            variant="outline"
            disabled={pending || selected.size === 0}
          >
            Rejeitar {selected.size}
          </Button>
          <button
            type="button"
            className="text-sm text-muted hover:text-foreground"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(pendingRows.map((row) => row.id)))
            }
          >
            {allSelected ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>
      ) : null}

      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th className="w-10" aria-label="Selecionar" />
              <Th className="w-24">Data</Th>
              <Th>Descrição</Th>
              <Th>Contraparte</Th>
              <Th className="w-56">Categoria</Th>
              <Th numeric className="w-32">
                Valor
              </Th>
            </tr>
          </thead>
          <tbody>
            {staged.map((row) => {
              const decided = row.status !== "pending";
              return (
                <tr key={row.id} className={decided ? "opacity-60" : ""}>
                  <Td>
                    {decided ? null : (
                      <input
                        type="checkbox"
                        name="staged"
                        value={row.id}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Selecionar ${row.description}`}
                        className="size-4"
                      />
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular text-xs">
                    {formatPtBRDate(row.occurredOn)}
                  </Td>
                  <Td>
                    {row.description}
                    {row.installmentTotal ? (
                      <span className="ml-2 text-xs text-muted">
                        parcela {row.installmentCurrent}/{row.installmentTotal}
                      </span>
                    ) : null}
                    {decided ? (
                      <span className="ml-2 text-xs text-muted">{STATUS_LABEL[row.status]}</span>
                    ) : null}
                  </Td>
                  <Td className="text-xs text-muted">{row.counterpartyName ?? "—"}</Td>
                  <Td>
                    {decided ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <Select
                        name={`categoria-${row.id}`}
                        defaultValue={row.suggestedCategoryId ?? ""}
                        aria-label={`Categoria de ${row.description}`}
                        className="h-8 text-xs"
                      >
                        <option value="">— sem categoria —</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.code} · {category.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Td>
                  <Td numeric>
                    <Amount
                      value={row.direction === "in" ? row.amount : -row.amount}
                      format={formatMoney}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>

      <p className="text-xs text-muted">
        Categorizar aqui é opcional — o que ficar sem categoria entra no fluxo de caixa numa
        linha “Sem categoria” e pode ser ajustado depois. A categorização automática é a
        Fase 4.
      </p>
    </form>
  );
}
