"use server";

import { revalidatePath } from "next/cache";
import { requireWriteContext } from "@/lib/actions/context";
import { definirAcesso, type Papel } from "@/lib/data/acessos";
import { FormError, readText, toFormState, type FormState } from "@/lib/form";

const PAPEIS: readonly (Papel | "remover")[] = ["viewer", "member", "owner", "remover"];

/**
 * Libera, muda ou tira o acesso de alguém. Quem confere se a pessoa logada é administradora
 * é o banco (`definir_acesso`); a mensagem de recusa dele volta para a tela como está.
 */
export async function definirAcessoAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  try {
    const { entity } = await requireWriteContext(slug);
    const email = readText(data, "email", "O e-mail").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new FormError("Esse e-mail não parece válido.");
    const escolha = String(data.get("papel") ?? "");
    if (!PAPEIS.includes(escolha as Papel | "remover")) throw new FormError("Escolha o que a pessoa pode fazer.");

    const situacao = await definirAcesso(entity.id, email, escolha === "remover" ? null : (escolha as Papel));
    revalidatePath(`/${slug}/acessos`);
    return {
      notices: [
        situacao === "removido"
          ? `${email} não tem mais acesso.`
          : situacao === "ativo"
            ? `${email} já pode usar o app com esse acesso.`
            : `${email} foi liberado e passa a ter acesso no primeiro login.`,
      ],
    };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
