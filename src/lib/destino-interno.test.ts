import { describe, expect, it } from "vitest";
import { destinoInterno } from "@/lib/destino-interno";

const APP = "http://localhost:3000";

describe("destinoInterno", () => {
  it("caminho do app passa, com busca e âncora", () => {
    expect(destinoInterno("/dd-group/fluxo-de-caixa?de=2026-09#set", APP)).toBe(
      "/dd-group/fluxo-de-caixa?de=2026-09#set",
    );
  });

  it("vazio vai para a raiz", () => {
    expect(destinoInterno(null, APP)).toBe("/");
    expect(destinoInterno("", APP)).toBe("/");
  });

  it.each([
    "//outro.site",
    "/\\outro.site",
    "\\\\outro.site",
    "https://outro.site/x",
    "javascript:alert(1)",
  ])("%s não sai do app", (malicioso) => {
    expect(destinoInterno(malicioso, APP)).toBe("/");
  });

  it.each(["/.//outro.site", "//localhost:3000//outro.site", "/%2e//outro.site"])(
    "%s fica na mesma origem e nunca devolve caminho com duas barras",
    (malicioso) => {
      const destino = destinoInterno(malicioso, APP);
      expect(destino.startsWith("//")).toBe(false);
      expect(destino.startsWith("/\\")).toBe(false);
      expect(new URL(destino, APP).origin).toBe(APP);
    },
  );

  it("@outro.site vira caminho do próprio app, nunca outro host", () => {
    expect(destinoInterno("@outro.site", APP)).toBe("/@outro.site");
  });
});
