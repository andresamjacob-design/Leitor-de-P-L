import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financeiro",
  description: "Gestão financeira multi-entidade — caixa, competência e reconhecimento",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
