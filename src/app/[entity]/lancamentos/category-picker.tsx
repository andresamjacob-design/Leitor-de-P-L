"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { setEntryCategoryAction } from "./actions";
import { Select } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { CategoryKind } from "@/lib/ledger-types";

export type PickerCategory = { id: string; code: string; name: string; kind: CategoryKind };
export type PickerClient = { id: string; name: string };

const KIND_ORDER_IN: readonly CategoryKind[] = ["revenue", "expense", "cost", "tax", "owner_draw"];
const KIND_ORDER_OUT: readonly CategoryKind[] = ["expense", "cost", "tax", "owner_draw", "revenue"];
const KIND_LABEL: Partial<Record<CategoryKind, string>> = {
  revenue: "Receitas",
  expense: "Despesas",
  cost: "Custos",
  tax: "Impostos",
  owner_draw: "Sócios",
};

/** The categories grouped by kind, the group that fits the direction first. */
function grouped(categories: readonly PickerCategory[], direction: "in" | "out") {
  const order = direction === "in" ? KIND_ORDER_IN : KIND_ORDER_OUT;
  return order
    .map((kind) => ({
      kind,
      label: direction === "in" && kind !== "revenue" ? `${KIND_LABEL[kind]} (estorno)` : KIND_LABEL[kind],
      items: categories.filter((category) => category.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Categorizes one entry straight from the list.
 *
 * A payment is one decision — the category — so choosing it saves. A receipt is two: the
 * category and **who paid**. Revenue enters the DRE through the client's contract or NF,
 * not through the day the money landed (SPEC §5), so the client is what ties this money to
 * that revenue; without it the receipt floats. That needs a button, because saving on the
 * first change would save half the answer.
 */
export function CategoryPicker({
  slug,
  entryId,
  direction,
  categories,
  clients = [],
  defaultCategoryId = "",
  defaultClientId = "",
}: {
  slug: string;
  entryId: string;
  direction: "in" | "out";
  categories: readonly PickerCategory[];
  clients?: readonly PickerClient[];
  defaultCategoryId?: string;
  defaultClientId?: string;
}) {
  const [state, action, pending] = useActionState(setEntryCategoryAction, EMPTY_FORM_STATE);
  const form = useRef<HTMLFormElement>(null);
  const isReceipt = direction === "in";

  const categorySelect = (
    <Select
      name="categoryId"
      defaultValue={defaultCategoryId}
      disabled={pending}
      aria-label="Categoria"
      className="h-8 py-0 text-xs"
      onChange={(event) => {
        if (!isReceipt && event.currentTarget.value) form.current?.requestSubmit();
      }}
    >
      <option value="">{pending ? "Salvando…" : "— escolher categoria —"}</option>
      {grouped(categories, direction).map((group) => (
        <optgroup key={group.kind} label={group.label}>
          {group.items.map((category) => (
            <option key={category.id} value={category.id}>
              {category.code} · {category.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );

  return (
    <form ref={form} action={action} className="flex min-w-56 flex-col gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={entryId} />
      {categorySelect}
      {isReceipt ? (
        <>
          <Select
            name="clientId"
            defaultValue={defaultClientId}
            disabled={pending}
            aria-label="Cliente que pagou"
            className="h-8 py-0 text-xs"
          >
            <option value="">— cliente que pagou —</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted/10 disabled:opacity-50"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
            <Link href={`/${slug}/clientes/nova`} className="text-xs text-accent hover:underline">
              cliente novo
            </Link>
          </div>
        </>
      ) : null}
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state.notices?.map((notice) => (
        <p key={notice} className="text-xs text-amber-700">
          {notice}
        </p>
      ))}
    </form>
  );
}
