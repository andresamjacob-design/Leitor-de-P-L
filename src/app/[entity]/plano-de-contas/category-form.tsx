"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveCategoryAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import {
  CATEGORY_KIND_LABEL,
  DRE_GROUP_LABEL,
  DRE_GROUP_ORDER,
  type CategoryKind,
} from "@/lib/ledger-types";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Category } from "@/lib/data/categories";

export function CategoryForm({
  slug,
  category,
  categories,
}: {
  slug: string;
  category: Category | null;
  categories: Category[];
}) {
  const [state, action, pending] = useActionState(saveCategoryAction, EMPTY_FORM_STATE);

  // A rejected save comes back with what was typed; React would blank the form otherwise.
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const parents = categories.filter((candidate) => candidate.id !== category?.id);

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {category ? <input type="hidden" name="id" value={category.id} /> : null}

      <FormError>{state.error}</FormError>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Código"
          htmlFor="code"
          hint="O mesmo código da planilha, por exemplo 6.02."
        >
          <Input id="code" name="code" defaultValue={kept("code", category?.code ?? "")} required />
        </Field>

        <Field label="Nome" htmlFor="name">
          <Input id="name" name="name" defaultValue={kept("name", category?.name ?? "")} required />
        </Field>

        <Field
          label="Natureza"
          htmlFor="kind"
          hint="Custo, despesa e imposto viram competência automaticamente. Receita vem do contrato. Transferência não entra em nenhum dos dois."
          className="sm:col-span-2"
        >
          <Select id="kind" name="kind" defaultValue={kept("kind", category?.kind ?? "expense")}>
            {(Object.keys(CATEGORY_KIND_LABEL) as CategoryKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {CATEGORY_KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Grupo no DRE" htmlFor="dreGroup" hint="Define a linha do DRE gerencial.">
          <Select id="dreGroup" name="dreGroup" defaultValue={kept("dreGroup", category?.dreGroup ?? "")}>
            <option value="">—</option>
            {DRE_GROUP_ORDER.map((group) => (
              <option key={group} value={group}>
                {DRE_GROUP_LABEL[group]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Dentro de" htmlFor="parentId" hint="Deixe vazio para uma linha de topo.">
          <Select id="parentId" name="parentId" defaultValue={kept("parentId", category?.parentId ?? "")}>
            <option value="">—</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.code} · {parent.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Ordem" htmlFor="sortOrder" hint="Menor aparece primeiro.">
          <Input
            id="sortOrder"
            name="sortOrder"
            type="number"
            defaultValue={kept("sortOrder", String(category?.sortOrder ?? 999))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : (category?.active ?? true)}
          className="size-4"
        />
        Categoria ativa
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Link
          href={`/${slug}/plano-de-contas`}
          className="text-sm text-muted hover:text-foreground"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
