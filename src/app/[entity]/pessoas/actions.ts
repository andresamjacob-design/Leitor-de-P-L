"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import {
  createPerson,
  updatePerson,
  type PersonBond,
  type PersonInput,
  type PersonKind,
} from "@/lib/data/clients";
import {
  readBoolean,
  readChoice,
  readOptionalId,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import { isValidTaxId } from "@/lib/tax-id";

const KINDS: readonly PersonKind[] = ["employee", "contractor", "partner"];
const BONDS: readonly PersonBond[] = ["clt", "pj", "freelancer", "estagio", "socio"];

function readPerson(data: FormData): PersonInput {
  const taxId = readOptionalText(data, "taxId");
  if (taxId && !isValidTaxId(taxId)) {
    throw new Error("o CPF/CNPJ não é válido. Confira os dígitos.");
  }

  const bond = String(data.get("bond") ?? "").trim();

  return {
    name: readText(data, "name", "O nome"),
    role: readOptionalText(data, "role"),
    kind: readChoice(data, "kind", KINDS, "O tipo"),
    bond: bond === "" ? null : readChoice(data, "bond", BONDS, "O vínculo"),
    squad: readOptionalText(data, "squad"),
    managerName: readOptionalText(data, "managerName"),
    clientId: readOptionalId(data, "clientId"),
    taxId,
    active: readBoolean(data, "active"),
  };
}

export async function savePersonAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readPerson(data);
    if (id) await updatePerson(id, input);
    else await createPerson(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/pessoas`);
  redirect(`/${slug}/pessoas`);
}
