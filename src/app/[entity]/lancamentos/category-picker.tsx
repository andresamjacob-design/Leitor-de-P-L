"use client";

import { useActionState, useRef } from "react";
import { setEntryCategoryAction } from "./actions";
import { Select } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

export type PickerCategory = { id: string; code: string; name: string };

/**
 * Categorizes one entry straight from the list. Choosing an option saves it — there is no
 * button, because the choice itself is the decision. The row then leaves the "Sem
 * categoria" filter on its own when the page revalidates.
 */
export function CategoryPicker({
  slug,
  entryId,
  categories,
}: {
  slug: string;
  entryId: string;
  categories: readonly PickerCategory[];
}) {
  const [state, action, pending] = useActionState(setEntryCategoryAction, EMPTY_FORM_STATE);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={action} className="min-w-48">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={entryId} />
      <Select
        name="categoryId"
        defaultValue=""
        disabled={pending}
        aria-label="Categoria"
        className="h-8 py-0 text-xs"
        onChange={(event) => {
          if (event.currentTarget.value) form.current?.requestSubmit();
        }}
      >
        <option value="">{pending ? "Salvando…" : "— escolher categoria —"}</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.code} · {category.name}
          </option>
        ))}
      </Select>
      {state.error ? <p className="mt-1 text-xs text-red-600">{state.error}</p> : null}
      {state.notices?.map((notice) => (
        <p key={notice} className="mt-1 text-xs text-amber-700">
          {notice}
        </p>
      ))}
    </form>
  );
}
