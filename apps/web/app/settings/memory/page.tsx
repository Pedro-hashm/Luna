"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Brain, GitFork, List, Plus, Sparkles } from "lucide-react";
import {
  approveMemory, configureMemory, dismissMemory, forgetMemory, listMemories, readMemory,
  readMemoryMap, reviewMemory, saveMemory,
  type MemoryDashboard, type MemoryDraft, type MemoryItem, type MemoryKind, type MemorySettings,
  type MemorySuggestion,
} from "@/lib/memory-api";

const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-100 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50";
const field = "mt-1 w-full rounded-xl border border-indigo-100 bg-white/85 px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 read-only:bg-slate-50";
const kinds: Record<MemoryKind, string> = {
  profile: "Perfil", preference: "Preferência", project: "Projeto", relationship: "Relação", event: "Acontecimento",
};
const blank: MemoryDraft = { subject: "Usuário", predicate: "", value: "", kind: "profile", scope: "global", validFrom: null, operation: "add" };
const labels = { active: "Vigente", historical: "Histórica", retracted: "Retratada" };

type Editor = { draft: MemoryDraft; item?: MemoryItem; suggestion?: MemorySuggestion; allowModel: boolean; pinned: boolean };
const newEditor = (): Editor => ({ draft: { ...blank }, allowModel: false, pinned: false });

function localDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

export default function MemoryPage() {
  const [data, setData] = useState<MemoryDashboard>();
  const [tab, setTab] = useState<"list" | "map" | "review">("list");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [mapSubject, setMapSubject] = useState("");
  const [mapDate, setMapDate] = useState("");
  const [mapItems, setMapItems] = useState<MemoryItem[]>();
  const [forgetting, setForgetting] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await listMemories();
        if (!alive) return;
        setData(result);
        const id = new URLSearchParams(window.location.search).get("item");
        if (id) {
          const item = await readMemory(id);
          if (alive) setEditor(fromItem(item));
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : "Não foi possível carregar as memórias.");
      }
    })();
    return () => { alive = false; };
  }, []);

  const subjects = [...new Set(data?.items.filter(item => !item.archived).map(item => item.subject))];
  const subject = mapSubject || subjects[0] || "";
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  const visible = data?.items.filter(item => item.archived === archived && (!category || item.kind === category) &&
    [item.subject, item.predicate, item.scope, item.revisions[0]?.value ?? ""]
      .some(value => value.toLocaleLowerCase("pt-BR").includes(normalized))) ?? [];
  const map = mapItems ?? data?.items.filter(item => !item.archived && item.subject === subject) ?? [];

  function fromItem(item: MemoryItem): Editor {
    const current = item.revisions[0];
    return {
      item, allowModel: item.allowModel, pinned: item.pinned,
      draft: { subject: item.subject, predicate: item.predicate, scope: item.scope, kind: item.kind,
        value: current?.value ?? "", validFrom: current?.validFrom ?? null, operation: "correct" },
    };
  }

  async function action(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy("");
    }
  }

  function open(id: string) {
    void action("Abrindo memória…", async () => {
      setEditor(fromItem(await readMemory(id)));
      setForgetting(false);
    });
  }

  async function reload() {
    setData(await listMemories());
    setMapItems(undefined);
    setMapDate("");
  }

  function changeSettings(change: Partial<MemorySettings>) {
    void action("Salvando configuração…", async () => {
      const settings = await configureMemory(change);
      setData(current => current && { ...current, settings });
      setNotice("Configuração salva.");
    });
  }

  function save(archive?: boolean) {
    if (!editor) return;
    void action("Salvando memória…", async () => {
      const body = {
        ...editor.draft, version: editor.item?.version, allowModel: editor.allowModel,
        pinned: editor.draft.scope === "global" && editor.allowModel && editor.pinned,
        ...(archive === undefined ? {} : { archived: archive }),
      };
      const result = editor.suggestion
        ? await approveMemory(editor.suggestion.id, { ...body, draft: editor.draft, version: editor.suggestion.existing?.version })
        : await saveMemory(body, editor.item?.id);
      await reload();
      setEditor(fromItem(await readMemory(result.id)));
      setForgetting(false);
      setNotice(archive === true ? "Memória arquivada." : "Memória salva.");
    });
  }

  function updateDraft<K extends keyof MemoryDraft>(key: K, value: MemoryDraft[K]) {
    setEditor(current => current && { ...current, draft: { ...current.draft, [key]: value } });
  }

  function showDate(nextSubject: string, date: string) {
    setMapSubject(nextSubject);
    setMapDate(date);
    setMapItems(undefined);
    if (date && nextSubject) void action("Carregando mapa…", async () => {
      setMapItems(await readMemoryMap(nextSubject, date));
    });
  }

  return (
    <main className="h-dvh overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/settings" className={button}><ArrowLeft size={16} /> Configurações</Link>
        <header className="mb-6 mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Contexto entre conversas</p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950"><Brain className="text-indigo-600" /> Memórias da Luna</h1>
          <p className="mt-2 text-sm text-slate-600">Revise o que a Luna sabe sobre você, veja de onde veio e acompanhe mudanças.</p>
        </header>
        {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
        {busy || notice ? <p role="status" className="mb-4 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{busy || notice}</p> : null}
        {!data && !error && <p role="status">Carregando memórias…</p>}
        {data && (
          <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5">
            <details className="glass rounded-3xl p-5">
              <summary className="cursor-pointer font-semibold text-slate-900">Como a Luna usa e aprende memórias</summary>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Setting label="Memória no chat" checked={data.settings.enabled} change={value => changeSettings({ enabled: value })}>
                  Permite consultar e gravar memórias quando você pedir.
                </Setting>
                <Setting label="Sugerir novas memórias" checked={data.settings.suggestionsEnabled} change={value => changeSettings({ suggestionsEnabled: value })}>
                  Analisa mensagens novas com Ollama em segundo plano. Você aprova as sugestões.
                </Setting>
                <Setting label="Usar pedidos de lembrar no chat" checked={data.settings.allowExplicitUse} change={value => changeSettings({ allowExplicitUse: value })}>
                  Autoriza novos itens gravados por pedido explícito a serem enviados ao modelo configurado.
                </Setting>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-2" aria-label="Visualização das memórias">
              <button type="button" className={tab === "list" ? primary : button} onClick={() => setTab("list")} aria-pressed={tab === "list"}><List size={16} /> Meu perfil</button>
              <button type="button" className={tab === "map" ? primary : button} onClick={() => setTab("map")} aria-pressed={tab === "map"}><GitFork size={16} /> Mapa</button>
              <button type="button" className={tab === "review" ? primary : button} onClick={() => setTab("review")} aria-pressed={tab === "review"}><Sparkles size={16} /> Sugestões ({data.suggestions.length})</button>
              <button type="button" className={button + " ml-auto"} onClick={() => { setEditor(newEditor()); setForgetting(false); }}><Plus size={16} /> Nova memória</button>
            </div>
            <div className={"grid min-w-0 gap-5 " + (editor ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "")}>
              <section className="glass min-w-0 self-start rounded-3xl p-4 sm:p-6">
                {tab === "list" && <>
                  <h2 className="text-lg font-semibold text-slate-900">Meu perfil</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Buscar<input className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Assunto, relação ou valor" /></label>
                    <label className="text-sm">Categoria<select className={field} value={category} onChange={e => setCategory(e.target.value)}>
                      <option value="">Todas</option>{Object.entries(kinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                    </select></label>
                  </div>
                  <label className="my-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Mostrar arquivadas</label>
                  <div className="space-y-2">
                    {visible.map(item => <MemoryCard key={item.id} item={item} selected={editor?.item?.id === item.id} open={() => open(item.id)} />)}
                    {!visible.length && <p className="py-5 text-sm text-slate-600">Nenhuma memória para mostrar.</p>}
                  </div>
                </>}
                {tab === "map" && <>
                  <h2 className="text-lg font-semibold text-slate-900">Mapa por assunto</h2>
                  <div className="my-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Assunto<select className={field} value={subject} onChange={e => showDate(e.target.value, mapDate)}>
                      {!subjects.length && <option value="">Sem assuntos</option>}{subjects.map(name => <option key={name}>{name}</option>)}
                    </select></label>
                    <label className="text-sm">Vigência em<input type="date" className={field} value={mapDate} onChange={e => showDate(subject, e.target.value)} /></label>
                  </div>
                  {map.length ? <div className="relative">
                    <div className="mx-auto w-fit rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-900">{subject}</div>
                    <div className="mx-auto h-6 w-px bg-indigo-200" aria-hidden="true" />
                    <div className="mx-auto h-px w-4/5 bg-indigo-200" aria-hidden="true" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {map.map(item => <div key={item.id} className="min-w-0">
                        <div className="mx-auto h-4 w-px bg-indigo-200" aria-hidden="true" />
                        <MemoryCard item={item} selected={editor?.item?.id === item.id} open={() => open(item.id)} />
                        {subjects.includes(item.revisions[0]?.value) && item.revisions[0]?.value !== subject && (
                          <button type="button" className={button + " mt-2"} onClick={() => showDate(item.revisions[0].value, mapDate)}>
                            Explorar {item.revisions[0].value}
                          </button>
                        )}
                      </div>)}
                    </div>
                  </div> : <p className="py-5 text-sm text-slate-600">Nenhuma relação para este recorte.</p>}
                </>}
                {tab === "review" && <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="text-lg font-semibold text-slate-900">Sugestões</h2><p className="mt-1 text-sm text-slate-600">{data.queue.pending} mensagem(ns) na fila{data.queue.failed > 0 ? " · " + data.queue.failed + " falharam" : ""}</p></div>
                    <button type="button" className={button} disabled={!data.settings.enabled || !data.settings.suggestionsEnabled}
                      onClick={() => void action("Analisando mensagens novas…", async () => {
                        const result = await reviewMemory(); await reload(); setNotice(result.proposed + " sugestão(ões) encontrada(s).");
                      })}>Analisar agora</button>
                  </div>
                  <button type="button" className={button + " mt-3"} onClick={() => void action("Atualizando sugestões…", reload)}>Atualizar lista</button>
                  <div className="mt-4 space-y-3">
                    {data.suggestions.map(suggestion => <article key={suggestion.id} className="rounded-2xl border border-indigo-100 bg-white/65 p-4">
                      <h3 className="font-semibold text-slate-900">{suggestion.draft.subject} · {suggestion.draft.predicate}</h3>
                      {suggestion.existing && <p className="mt-1 text-xs text-slate-500">Vigente: {suggestion.existing.value}</p>}
                      <p className="mt-1 break-words text-sm text-indigo-900">Proposta: {suggestion.draft.value}</p>
                      <blockquote className="mt-2 border-l-2 border-indigo-200 pl-3 text-sm text-slate-600">{suggestion.quote}</blockquote>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className={primary} onClick={() => {
                          setEditor({ suggestion, draft: { ...suggestion.draft }, allowModel: false, pinned: false }); setForgetting(false);
                        }}>Revisar sugestão</button>
                        <button type="button" className={button} onClick={() => void action("Rejeitando sugestão…", async () => {
                          await dismissMemory(suggestion.id); if (editor?.suggestion?.id === suggestion.id) setEditor(undefined); await reload();
                        })}>Rejeitar</button>
                        <Link href={"/chat/" + suggestion.message.conversationId} className={button}>Ver origem</Link>
                      </div>
                    </article>)}
                    {!data.suggestions.length && <p className="py-5 text-sm text-slate-600">Nenhuma sugestão aguardando revisão.</p>}
                  </div>
                </>}
              </section>

              {editor && <section className="glass min-w-0 rounded-3xl p-4 sm:p-6" aria-label="Editor de memória">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{editor.item ? "Editar memória" : editor.suggestion ? "Revisar sugestão" : "Nova memória"}</h2>
                  <button type="button" className={button} onClick={() => { setEditor(undefined); setForgetting(false); }}>Fechar</button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Assunto<input className={field} readOnly={Boolean(editor.item)} maxLength={80} value={editor.draft.subject} onChange={e => updateDraft("subject", e.target.value)} /></label>
                  <label className="text-sm">Relação<input className={field} readOnly={Boolean(editor.item)} maxLength={80} value={editor.draft.predicate} placeholder="Ex. residência" onChange={e => updateDraft("predicate", e.target.value)} /></label>
                  <label className="text-sm">Escopo<input className={field} readOnly={Boolean(editor.item)} maxLength={80} value={editor.draft.scope} onChange={e => updateDraft("scope", e.target.value)} /></label>
                  <label className="text-sm">Categoria<select className={field} value={editor.draft.kind} onChange={e => updateDraft("kind", e.target.value as MemoryKind)}>
                    {Object.entries(kinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select></label>
                </div>
                <label className="mt-3 block text-sm">Valor da memória<textarea className={field + " min-h-20 resize-y"} maxLength={500} value={editor.draft.value} onChange={e => updateDraft("value", e.target.value)} /></label>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Vigente desde<input type="date" className={field} value={editor.draft.validFrom ?? ""} onChange={e => updateDraft("validFrom", e.target.value || null)} /></label>
                  {(editor.item || editor.suggestion?.existing) && <label className="text-sm">Tipo de alteração<select className={field} value={editor.draft.operation} onChange={e => updateDraft("operation", e.target.value as MemoryDraft["operation"])}>
                    <option value="add">Confirmar o mesmo valor</option><option value="change">Mudança real</option><option value="correct">Corrigir informação errada</option>
                  </select></label>}
                </div>
                <div className="mt-4 space-y-2">
                  <Setting label="Permitir uso no chat" checked={editor.allowModel} change={value => setEditor({ ...editor, allowModel: value, pinned: value && editor.pinned })}>
                    O modelo configurado pode receber este conteúdo se for relevante.
                  </Setting>
                  <Setting label="Sempre considerar" disabled={!editor.allowModel || editor.draft.scope !== "global"} checked={editor.pinned && editor.draft.scope === "global"}
                    change={value => setEditor({ ...editor, pinned: value })}>Fixa este item global no contexto. A Luna seleciona até três itens fixados.</Setting>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={primary} type="button" disabled={!editor.draft.value.trim() || !editor.draft.subject.trim() || !editor.draft.predicate.trim()} onClick={() => save()}>{editor.suggestion ? "Aprovar memória" : "Salvar memória"}</button>
                  {editor.item && <>
                    <button type="button" className={button} onClick={() => save(!editor.item?.archived)}>{editor.item.archived ? "Restaurar" : "Arquivar"}</button>
                    <button type="button" className={button} onClick={() => setForgetting(!forgetting)}>Esquecer</button>
                  </>}
                </div>
                {forgetting && editor.item && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
                  <p>Remove a memória, as revisões e as sugestões relacionadas. A conversa de origem permanece no histórico.</p>
                  <button className={button + " mt-2"} type="button" onClick={() => void action("Esquecendo memória…", async () => {
                    await forgetMemory(editor.item!); setEditor(undefined); setForgetting(false); await reload(); setNotice("Memória esquecida.");
                  })}>Confirmar exclusão</button>
                </div>}
                {editor.item && <div className="mt-6 border-t border-indigo-100 pt-4">
                  <h3 className="font-semibold text-slate-900">Linha do tempo e fontes</h3>
                  <ol className="mt-3 space-y-4 border-l border-indigo-200 pl-4">
                    {editor.item.revisions.map(revision => <li key={revision.id}>
                      <p className="text-xs font-semibold text-indigo-700">{labels[revision.status]} · revisão {revision.number}</p>
                      <p className="break-words text-sm text-slate-900">{revision.value}</p>
                      <p className="mt-1 text-xs text-slate-500">Registrada em {localDate(revision.recordedAt)} · início {revision.validFrom ?? "desconhecido"}{revision.validTo ? " · fim em " + revision.validTo : ""}</p>
                      {revision.sources?.map(source => <Link key={source.id} href={"/chat/" + source.message.conversationId} className="mt-2 block border-l-2 border-indigo-100 pl-2 text-xs text-indigo-700">
                        {localDate(source.message.createdAt)} · {source.quote}
                      </Link>)}
                    </li>)}
                  </ol>
                </div>}
              </section>}
            </div>
          </fieldset>
        )}
      </div>
    </main>
  );
}

function Setting({ label, checked, change, children, disabled }: {
  label: string; checked: boolean; change: (value: boolean) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return <label className="flex items-start gap-3 rounded-xl border border-white/90 bg-white/50 p-3">
    <input type="checkbox" className="mt-1 accent-indigo-700" checked={checked} disabled={disabled} onChange={e => change(e.target.checked)} />
    <span><span className="block text-sm font-semibold text-slate-800">{label}</span><span className="block text-xs leading-5 text-slate-600">{children}</span></span>
  </label>;
}

function MemoryCard({ item, open, selected }: { item: MemoryItem; open: () => void; selected: boolean }) {
  return <button type="button" aria-pressed={selected} onClick={open}
    className={"block w-full min-w-0 rounded-2xl border p-3 text-left " + (selected ? "border-indigo-300 bg-indigo-50" : "border-white/90 bg-white/65 hover:bg-white")}>
    <span className="block text-xs font-semibold text-indigo-700">{kinds[item.kind]} · {item.scope === "global" ? "Global" : item.scope}</span>
    <span className="mt-1 block break-words text-sm font-semibold text-slate-900">{item.subject} · {item.predicate}</span>
    <span className="block break-words text-sm text-slate-700">{item.revisions[0]?.value}</span>
    <span className="mt-1 block text-xs text-slate-500">{item.allowModel ? "Permitida no chat" : "Privada"}{item.pinned ? " · fixada" : ""}</span>
  </button>;
}
