"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import {
  createClientRecord,
  updateClientRecord,
  type ClientInput,
} from "@/lib/data/clients";
import {
  readBoolean,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import { isValidTaxId } from "@/lib/tax-id";

function readClient(data: FormData): ClientInput {
  const taxId = readOptionalText(data, "taxId");
  // A tax id that does not check out is worse than none: the statement matches by CNPJ,
  // and a wrong one would quietly attach someone else's money to this client.
  if (taxId && !isValidTaxId(taxId)) {
    throw new Error("o CNPJ/CPF não é válido. Confira os dígitos.");
  }

  return {
    name: readText(data, "name", "O nome"),
    taxId,
    notes: readOptionalText(data, "notes"),
    active: readBoolean(data, "active"),
  };
}

export async function saveClientAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readClient(data);
    if (id) await updateClientRecord(id, input);
    else await createClientRecord(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/clientes`);
  redirect(`/${slug}/clientes`);
}
