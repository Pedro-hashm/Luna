"use client";

import { ArrowLeft, Check, Copy, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  activatePersonality,
  getPersonalities,
  previewPersonality,
  savePersonality,
  type Personalities,
  type PersonalityDraft,
  type PersonalityPreset,
  type PersonalityPreview,
} from "@/lib/personality-api";

const field = "w-full rounded-xl border border-indigo-100 bg-white/80 px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-100 bg-white/80 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50";

const controls = [
  { key: "tone", label: "Tom", options: [["direto", "Direto"], ["acolhedor", "Acolhedor"], ["elegante", "Elegante"]] },
  { key: "detail", label: "Nível de detalhe", options: [["breve", "Breve"], ["detalhado", "Detalhado"]] },
  { key: "humor", label: "Humor", options: [["discreto", "Discreto"], ["serio", "Sério"]] },
] as const;

const emptyDraft: PersonalityDraft = { name: "", instructions: "", tone: "", detail: "", humor: "" };

function toDraft({ name, instructions, tone, detail, humor }: PersonalityPreset): PersonalityDraft {
  return { name, instructions, tone, detail, humor };
}

function description(preset: PersonalityPreset) {
  if (preset.id === "luna-current") return "O jeito original da Luna.";
  if (preset.id === "luna-sagaz") return "Elegância, carinho discreto e uma provocação quando couber.";
  return preset.instructions || "Personalidade configurada por você.";
}

export default function PersonalitySettingsPage() {
  const [data, setData] = useState<Personalities | null>(null);
  const [selected, setSelected] = useState<PersonalityPreset>();
  const [draft, setDraft] = useState<PersonalityDraft>(emptyDraft);
  const [testMessage, setTestMessage] = useState("Acertei de primeira. Confessa que ficou impressionada.");
  const [preview, setPreview] = useState<PersonalityPreview>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    getPersonalities().then((result) => {
      if (!mounted) return;
      setData(result);
      const active = result.presets.find((preset) => preset.id === result.activeId);
      setSelected(active);
      setDraft(active ? toDraft(active) : emptyDraft);
    }).catch((err: unknown) => {
      if (mounted) setError(err instanceof Error ? err.message : "Não foi possível carregar os presets.");
    });
    return () => { mounted = false; };
  }, []);

  const dirty = data !== null && (!selected || JSON.stringify(draft) !== JSON.stringify(toDraft(selected)));
  const isActive = selected?.id === data?.activeId;

  function choose(preset?: PersonalityPreset, copy?: PersonalityDraft) {
    setSelected(preset);
    setDraft(copy ?? (preset ? toDraft(preset) : emptyDraft));
    setPreview(undefined);
    setNotice("");
    setError("");
  }

  function edit(key: keyof PersonalityDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(undefined);
    setNotice("");
  }

  async function action(label: string, task: () => Promise<void>) {
    setBusy(label);
    setNotice("");
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(undefined);
    }
  }

  function save() {
    void action("Salvando preset…", async () => {
      const saved = await savePersonality(draft, selected);
      setData((previous) => previous && ({
        ...previous,
        presets: selected
          ? previous.presets.map((preset) => preset.id === saved.id ? saved : preset)
          : [...previous.presets, saved],
      }));
      choose(saved);
      setNotice(isActive ? "Preset salvo. A próxima resposta já usa esta versão." : "Preset salvo e pronto para ativar.");
    });
  }

  function activate(preset: PersonalityPreset) {
    void action("Ativando preset…", async () => {
      const { activeId } = await activatePersonality(preset.id);
      setData((previous) => previous && { ...previous, activeId });
      choose(preset);
      setNotice(preset.name + " vale a partir da próxima resposta.");
    });
  }

  function test() {
    setPreview(undefined);
    void action("Gerando duas respostas…", async () => {
      setPreview(await previewPersonality(testMessage, draft));
    });
  }

  return (
    <main className="h-dvh overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/settings" className={button}><ArrowLeft size={16} /> Configurações</Link>
        <header className="mb-6 mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">O jeito da Luna</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Personalidade</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Escolha como ela conversa com você no chat e por voz.</p>
        </header>

        {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
        {busy || notice ? <p role="status" className="mb-4 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{busy ?? notice}</p> : null}
        {!data && !error && <p role="status" className="text-sm text-slate-600">Carregando presets…</p>}

        {data && (
          <fieldset disabled={Boolean(busy)} className="grid min-w-0 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <section className="glass self-start rounded-3xl p-4 sm:p-5" aria-label="Presets">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900">Presets</h2>
                <button type="button" className={button} disabled={dirty} onClick={() => choose()}><Plus size={16} /> Novo</button>
              </div>
              <div className="space-y-2">
                {data.presets.map((preset) => (
                  <button key={preset.id} type="button" aria-pressed={selected?.id === preset.id} disabled={dirty}
                    onClick={() => choose(preset)}
                    className={"block w-full rounded-2xl border p-3 text-left disabled:opacity-60 " + (selected?.id === preset.id ? "border-indigo-300 bg-indigo-50/90" : "border-white/90 bg-white/55 hover:bg-white/85")}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-semibold text-slate-900">{preset.name}</span>
                      {preset.id === data.activeId && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">Ativo</span>}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{description(preset)}</span>
                  </button>
                ))}
              </div>
              <button type="button" className={button + " mt-4 w-full"} disabled={dirty || data.activeId === "luna-current"}
                onClick={() => {
                  const original = data.presets.find((preset) => preset.id === "luna-current");
                  if (original) activate(original);
                }}>Voltar para Luna atual</button>
            </section>

            <div className="min-w-0 space-y-5">
              <section className="glass rounded-3xl p-4 sm:p-6" aria-labelledby="editor-title">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 id="editor-title" className="text-lg font-semibold text-slate-900">{selected ? selected.name : "Novo preset"}</h2>
                    <p className="mt-1 text-xs text-slate-600">{selected?.builtIn ? "Preset original. Duplique para criar sua versão." : "Descreva como você quer que a Luna soe."}</p>
                  </div>
                  {selected && <button className={button} type="button" disabled={dirty} onClick={() => choose(undefined, { ...toDraft(selected), name: selected.name.slice(0, 52) + " · cópia" })}><Copy size={15} /> Duplicar</button>}
                </div>

                <label className="mb-4 block text-sm font-medium text-slate-800">
                  Nome
                  <input className={field + " mt-1.5"} value={draft.name} maxLength={60} readOnly={selected?.builtIn}
                    onChange={(event) => edit("name", event.target.value)} placeholder="Ex. Luna de laboratório" />
                </label>
                <label className="block text-sm font-medium text-slate-800">
                  Jeito da Luna
                  <textarea className={field + " mt-1.5 min-h-32 resize-y leading-6"} value={draft.instructions} maxLength={1800}
                    readOnly={selected?.builtIn} onChange={(event) => edit("instructions", event.target.value)}
                    placeholder={selected?.id === "luna-current" ? "Comportamento original da Luna." : "Ex. Seja direta, carinhosa e dê sua opinião com clareza."} />
                </label>
                {!selected?.builtIn && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {controls.map(({ key, label, options }) => (
                      <label key={key} className="block text-sm font-medium text-slate-800">
                        {label}
                        <select className={field + " mt-1.5"} value={draft[key]} onChange={(event) => edit(key, event.target.value)}>
                          <option value="">Pelo texto do preset</option>
                          {options.map(([value, caption]) => <option key={value} value={value}>{caption}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  {dirty && <button className={primary} type="button" onClick={save} disabled={!draft.name.trim()}><Check size={16} /> Salvar preset</button>}
                  {dirty && <button className={button} type="button" onClick={() => choose(selected ?? data.presets.find((preset) => preset.id === data.activeId))}>Descartar alterações</button>}
                  {selected && !dirty && <button className={primary} type="button" disabled={isActive} onClick={() => activate(selected)}>{isActive ? "Preset ativo" : "Ativar preset"}</button>}
                </div>
              </section>

              <section className="glass rounded-3xl p-4 sm:p-6" aria-labelledby="preview-title">
                <h2 id="preview-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Sparkles size={17} className="text-indigo-600" /> Prévia comparativa</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">A mesma mensagem para o preset ativo e o rascunho. A prévia usa o modelo configurado e fica fora do histórico.</p>
                <label className="mt-4 block text-sm font-medium text-slate-800">
                  Mensagem de teste
                  <textarea className={field + " mt-1.5 min-h-20 resize-y"} value={testMessage} maxLength={800}
                    onChange={(event) => { setTestMessage(event.target.value); setPreview(undefined); }} />
                </label>
                <button className={button + " mt-3"} type="button" onClick={test} disabled={!draft.name.trim() || !testMessage.trim()}>Testar</button>
                {preview && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2" aria-live="polite">
                    {(["active", "draft"] as const).map((side) => (
                      <article key={side} className="min-w-0 rounded-2xl border border-white/90 bg-white/65 p-4">
                        <p className="text-xs font-semibold text-indigo-700">{side === "active" ? "Preset ativo" : "Em teste"}</p>
                        <h3 className="mt-1 break-words text-sm font-semibold text-slate-900">{preview[side].name}</h3>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{preview[side].text}</p>
                        <p className="mt-3 break-words text-xs text-slate-500">{preview[side].model}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </fieldset>
        )}
      </div>
    </main>
  );
}
