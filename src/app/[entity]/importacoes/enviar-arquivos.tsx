"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { enviarArquivosAction, type EnvioState } from "./actions";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const VAZIO: EnvioState = {};

function tamanho(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tipoPeloNome(nome: string): string {
  const n = nome.toLowerCase();
  if (n.endsWith(".pdf")) return "PDF — fatura ou extrato da Contabilizei";
  if (n.endsWith(".xlsx") || n.endsWith(".csv")) return "extrato";
  return "formato não aceito";
}

/**
 * O lugar de colocar os arquivos do mês (D143): extrato do Itaú em xlsx e faturas do cartão
 * em pdf, vários de uma vez, arrastados ou escolhidos. Não há menu de conta — cada arquivo
 * diz de quem é, e o servidor lê isso de dentro dele.
 */
export function EnviarArquivos({ slug }: { slug: string }) {
  const [state, dispatch, pending] = useActionState(
    enviarArquivosAction,
    VAZIO,
  );
  const input = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(0);
  const [arrastando, setArrastando] = useState(false);

  function soltar(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setArrastando(false);
    const soltos = event.dataTransfer.files;
    if (soltos.length === 0 || !input.current) return;
    // O formulário envia o que estiver no campo; arrastar só preenche o campo.
    input.current.files = soltos;
    setArquivos(Array.from(soltos));
  }

  return (
    <form
      action={(data) => {
        setEnviando(arquivos.length);
        setArquivos([]);
        dispatch(data);
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="slug" value={slug} />

      <label
        htmlFor="arquivos"
        onDragOver={(event) => {
          event.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30",
          arrastando
            ? "border-accent bg-accent/10"
            : "border-border hover:border-accent/60 hover:bg-surface",
        )}
      >
        <span className="text-base font-medium">
          Arraste aqui o extrato do Itaú e as faturas do cartão
        </span>
        <span className="text-sm text-muted">
          ou clique para escolher · .xlsx e .csv de extrato, .pdf de fatura ·
          vários de uma vez
        </span>
        <span className="text-xs text-muted">
          A conta de cada arquivo é lida de dentro dele — não precisa escolher.
        </span>
        <input
          ref={input}
          id="arquivos"
          name="arquivos"
          type="file"
          multiple
          accept=".xlsx,.csv,.pdf"
          className="sr-only"
          onChange={(event) =>
            setArquivos(
              event.target.files ? Array.from(event.target.files) : [],
            )
          }
        />
      </label>

      {arquivos.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {arquivos.map((arquivo) => (
            <li
              key={`${arquivo.name}-${arquivo.size}`}
              className="flex flex-wrap gap-x-3"
            >
              <span className="font-medium">{arquivo.name}</span>
              <span className="text-muted">
                {tipoPeloNome(arquivo.name)} · {tamanho(arquivo.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || arquivos.length === 0}>
          {pending
            ? `Lendo ${enviando} arquivo${enviando === 1 ? "" : "s"}…`
            : arquivos.length > 1
              ? `Enviar ${arquivos.length} arquivos`
              : "Enviar"}
        </Button>
        <span className="text-xs text-muted">
          O que fecha com o saldo do banco entra sozinho; o que não fecha fica
          para você conferir.
        </span>
      </div>

      <FormError>{state.erro}</FormError>

      {state.resultados && state.resultados.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {state.resultados.map((r) => (
            <li
              key={r.arquivo}
              className={cn(
                "rounded-md border px-4 py-3 text-sm",
                r.ok ? "border-border" : "border-red-300 dark:border-red-900",
              )}
            >
              {r.ok ? (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium">{r.arquivo}</span>
                    <span className="text-muted">→ {r.conta}</span>
                  </div>
                  {r.aprovado ? (
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-green-700 dark:text-green-400">
                        ✓ entrou no razão: {r.lancamentos} lançamento
                        {r.lancamentos === 1 ? "" : "s"}
                        {r.semCategoria > 0 ? ` (${r.semCategoria} sem categoria)` : ""}
                        {r.duplicatas > 0
                          ? ` · ${r.duplicatas} já ${r.duplicatas === 1 ? "estava" : "estavam"} lá`
                          : ""}
                      </span>
                      <Link
                        href={`/${slug}/fluxo-de-caixa`}
                        className="font-medium text-accent underline underline-offset-2"
                      >
                        Ver o fluxo →
                      </Link>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-amber-700 dark:text-amber-300">
                        ficou para revisão: {r.motivoRevisao}
                      </span>
                      <Link
                        href={`/${slug}/importacoes/${r.importId}`}
                        className="font-medium text-accent underline underline-offset-2"
                      >
                        Revisar e aprovar →
                      </Link>
                    </div>
                  )}
                  {r.avisos.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                      {r.avisos.map((aviso) => (
                        <li key={aviso}>{aviso}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{r.arquivo}</span>
                  <span className="text-red-700 dark:text-red-300">
                    não entrou: {r.erro}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
