import { PlaceholderPage } from "@/components/placeholder-page";

export default function Page() {
  return (
    <PlaceholderPage
      title="Fluxo de caixa"
      description="Regime de caixa: todo movimento real de dinheiro, por conta."
      phase="Fase 2"
      waitingFor="Precisa de lançamentos e do plano de contas."
    />
  );
}
