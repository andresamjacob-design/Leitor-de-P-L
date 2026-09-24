import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Escolhe o que a aba mostra: a planilha do Andre, copiada (o padrão, D141), ou o relatório
 * calculado pelo razão do banco. As duas coisas continuam existindo — a cópia não apaga o
 * cálculo, e o cálculo é o que prova que a conta corrente bate com o extrato.
 */
export function FonteToggle({
  slug,
  pagina,
  atual,
}: {
  slug: string;
  pagina: "dre" | "fluxo-de-caixa";
  atual: "planilha" | "razao";
}) {
  const opcoes = [
    { chave: "planilha", rotulo: "Sua planilha", href: `/${slug}/${pagina}` },
    { chave: "razao", rotulo: "Calculado pelo razão", href: `/${slug}/${pagina}?fonte=razao` },
  ] as const;

  return (
    <nav aria-label="Origem dos números" className="mb-6 inline-flex rounded-md border border-border p-0.5 text-sm">
      {opcoes.map((opcao) => (
        <Link
          key={opcao.chave}
          href={opcao.href}
          aria-current={atual === opcao.chave ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1",
            atual === opcao.chave ? "bg-surface font-medium" : "text-muted hover:text-foreground",
          )}
        >
          {opcao.rotulo}
        </Link>
      ))}
    </nav>
  );
}
