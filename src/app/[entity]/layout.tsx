import { notFound, redirect } from "next/navigation";
import { EntitySwitcher } from "@/components/entity-switcher";
import { SideNav } from "@/components/side-nav";
import { listUserEntities, resolveScope, scopeLabel } from "@/lib/entities";
import { getUser } from "@/lib/supabase/server";

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entity: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { entity: slug } = await params;
  const scope = await resolveScope(slug);

  // A slug the user cannot reach is indistinguishable from one that does not exist —
  // that is deliberate, it leaks nothing about the other entity.
  if (!scope) notFound();

  const entities = await listUserEntities();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold">Financeiro</span>
          <span className="text-xs text-muted">{scopeLabel(scope)}</span>
        </div>
        <div className="flex items-center gap-4">
          <EntitySwitcher entities={entities} current={slug} />
          <form action="/auth/sign-out" method="post">
            <button className="text-sm text-muted hover:text-foreground" type="submit">
              Sair
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8">
        <aside className="w-52 shrink-0">
          <SideNav slug={slug} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
