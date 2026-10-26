import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { listUserEntities } from "@/lib/entities";
import { getUser } from "@/lib/supabase/server";

export default async function HomePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const entities = await listUserEntities();
  const first = entities[0];

  if (!first) {
    return (
      <main className="mx-auto max-w-lg p-10">
        <EmptyState title="Você entrou, mas ainda não tem acesso aos dados">
          Peça a um administrador para liberar o seu e-mail ({user.email}) na tela Acessos.
          Depois disso, é só recarregar esta página.
          <form action="/auth/sign-out" method="post" className="mt-3">
            <button type="submit" className="underline">
              Sair
            </button>
          </form>
        </EmptyState>
      </main>
    );
  }

  redirect(`/${first.slug}`);
}
