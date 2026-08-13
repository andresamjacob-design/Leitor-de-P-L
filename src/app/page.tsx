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
        <EmptyState title="Sua conta não está ligada a nenhuma entidade">
          Peça para alguém criar a sua linha em <code className="font-mono">user_entities</code>.
          Não há auto-cadastro (DECISIONS D20).
        </EmptyState>
      </main>
    );
  }

  redirect(`/${first.slug}`);
}
