"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CornerDownLeft,
  FilePlus2,
  Loader2,
  Search,
  UserRound,
  UserSearch,
} from "lucide-react";
import type { ElementType } from "react";

import { canAccessPage } from "@/lib/auth/permissions";
import { clientHref } from "@/lib/clients/client-link";
import {
  searchClientsQuick,
  type QuickClient,
} from "@/app/(dashboard)/clientes/quick-search-action";

import {
  menuGroups,
  OPEN_COMMAND_PALETTE,
} from "@/components/layout/navigation";

/*
 * Pesquisa rápida (Ctrl+K / ⌘K): escreve o nome, NIF ou apólice de
 * um cliente e escolhe-o para abrir logo o painel dele; ou vai para
 * qualquer página, tarefa ou processo — sem tirar as mãos do teclado.
 * Abre também pelo campo da barra de topo e pelo botão do menu.
 */

// Espera depois da última tecla antes de ir procurar clientes.
const SEARCH_DELAY_MS = 220;

type Entry = {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: ElementType;
  search: string;
  // Título do grupo onde aparece na lista.
  section: "Clientes" | "Páginas e ações";
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function CommandPalette({ role }: { role: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Clientes encontrados para `clientsFor` (o texto que os trouxe).
  const [clients, setClients] = useState<QuickClient[]>([]);
  const [clientsFor, setClientsFor] = useState("");

  const listRef = useRef<HTMLDivElement>(null);

  const canSearchClients = canAccessPage(role, "/clientes");
  const searchText = query.trim();
  const wantsClients = open && canSearchClients && searchText.length >= 2;
  const searching = wantsClients && clientsFor !== searchText;

  // Procura clientes um instante depois de parar de escrever. A
  // resposta só conta se ainda for a do texto atual.
  useEffect(() => {
    if (!wantsClients) return;

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        const found = await searchClientsQuick(searchText);

        if (!cancelled) {
          setClients(found);
          setClientsFor(searchText);
        }
      } catch {
        if (!cancelled) {
          setClients([]);
          setClientsFor(searchText);
        }
      }
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wantsClients, searchText]);

  // Abrir / fechar: atalho de teclado e botões (evento global).
  useEffect(() => {
    function show() {
      setQuery("");
      setSelected(0);
      setOpen(true);
    }

    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setSelected(0);
        setOpen((value) => !value);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE, show);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE, show);
    };
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = menuGroups.flatMap((group) =>
      group.items
        .filter((item) => canAccessPage(role, item.href))
        .map((item) => ({
          id: `page:${item.href}`,
          label: item.label,
          hint: group.title ?? "Início",
          href: item.href,
          icon: item.icon,
          section: "Páginas e ações" as const,
          search: normalize(
            `${item.label} ${group.title ?? ""} ${item.keywords ?? ""}`,
          ),
        })),
    );

    const actions: Entry[] = [
      {
        id: "action:task",
        label: "Nova tarefa",
        hint: "Ação",
        href: "/tarefas",
        icon: FilePlus2,
        section: "Páginas e ações" as const,
        search: normalize("nova tarefa criar lembrete adicionar"),
      },
      {
        id: "action:process",
        label: "Novo processo",
        hint: "Ação",
        href: "/processos",
        icon: FilePlus2,
        section: "Páginas e ações" as const,
        search: normalize("novo processo criar simulação renegociação"),
      },
    ].filter((entry) => canAccessPage(role, entry.href));

    return [...pages, ...actions];
  }, [role]);

  const results = useMemo<Entry[]>(() => {
    const text = query.trim();
    const needle = normalize(text);

    const matches = needle
      ? entries.filter((entry) =>
          needle.split(/\s+/).every((word) => entry.search.includes(word)),
        )
      : entries;

    if (!text || !canSearchClients) return matches;

    // Clientes primeiro: escolher um abre o painel lateral dele.
    const clientEntries: Entry[] =
      clientsFor === text
        ? clients.map((client) => ({
            id: `client:${client.id}`,
            label: client.name,
            hint: [
              client.nif ? `NIF ${client.nif}` : null,
              client.policyNumber ? `Apólice ${client.policyNumber}` : null,
              client.city,
            ]
              .filter(Boolean)
              .join(" · "),
            href: clientHref(client.id),
            icon: UserRound,
            section: "Clientes" as const,
            search: "",
          }))
        : [];

    return [
      ...clientEntries,
      {
        id: "client-search",
        label: `Ver todos os clientes com "${text}"`,
        hint: "Abre a lista de clientes filtrada",
        href: `/clientes?q=${encodeURIComponent(text)}`,
        icon: UserSearch,
        section: "Clientes",
        search: "",
      },
      ...matches,
    ];
  }, [entries, query, canSearchClients, clients, clientsFor]);

  const active = Math.min(selected, Math.max(results.length - 1, 0));

  function go(entry: Entry | undefined) {
    if (!entry) return;

    setOpen(false);
    router.push(entry.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function move(next: number) {
    if (results.length === 0) return;

    const index = (next + results.length) % results.length;
    setSelected(index);

    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in items-start justify-center bg-[#14161b]/45 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-label="Pesquisa rápida"
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-white/60 bg-white shadow-[0_30px_80px_rgba(20,22,27,0.35)]"
      >
        <div className="flex items-center gap-3 border-b border-[#edf0f2] px-4">
          <Search className="h-5 w-5 shrink-0 text-[#8a9099]" />

          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Nome, NIF ou apólice do cliente — ou uma página…"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-[#20242a] outline-none placeholder:text-[#a0a5ac]"
          />

          {searching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#ff4b0a]" />
          )}

          <kbd className="rounded-md border border-[#e4e6e9] bg-[#f7f8f9] px-1.5 py-0.5 text-[10px] font-medium text-[#7d848e]">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-[#8a9099]">
              Nada encontrado.
            </p>
          ) : (
            results.map((entry, index) => {
              const Icon = entry.icon;
              const isActive = index === active;
              const startsSection =
                searchText !== "" &&
                (index === 0 || results[index - 1].section !== entry.section);

              return (
                <div key={entry.id}>
                  {startsSection && (
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a0a5ac]">
                      {entry.section}
                      {entry.section === "Clientes" &&
                        !searching &&
                        clientsFor === searchText &&
                        clients.length === 0 &&
                        " — nenhum encontrado"}
                    </p>
                  )}

                <button
                  type="button"
                  data-index={index}
                  onClick={() => go(entry)}
                  onMouseMove={() => {
                    if (!isActive) setSelected(index);
                  }}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    isActive ? "bg-[#fff3ee]" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                      isActive
                        ? "bg-[#ff4b0a] text-white"
                        : "bg-[#f4f5f7] text-[#59616d]",
                    ].join(" ")}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[#20242a]">
                      {entry.label}
                    </span>
                    <span className="block truncate text-xs text-[#8a9099]">
                      {entry.hint}
                    </span>
                  </span>

                  {isActive && (
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#ff4b0a]" />
                  )}
                </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-[#edf0f2] bg-[#fafbfc] px-4 py-2 text-[11px] text-[#8a9099]">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-[#e4e6e9] bg-white px-1">↑</kbd>
            <kbd className="rounded border border-[#e4e6e9] bg-white px-1">↓</kbd>
            escolher
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" />
            abrir
          </span>
          <span className="ml-auto">Ctrl + K em qualquer página</span>
        </div>
      </div>
    </div>
  );
}
