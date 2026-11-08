"use client";

import { ArrowLeft, ExternalLink, Headphones, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getDiscordVoice, updateDiscordVoice, type DiscordVoiceSettings } from "@/lib/discord-voice-api";

const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-100 bg-white/80 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50";
const field = "mt-1.5 w-full rounded-xl border border-indigo-100 bg-white/80 px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const statusCopy: Record<DiscordVoiceSettings["status"]["state"], { label: string; description: string; tone: string }> = {
  offline: { label: "Serviço indisponível", description: "A Luna não conseguiu consultar o serviço de voz do Discord.", tone: "bg-amber-50 text-amber-800" },
  missing_token: { label: "Bot pendente", description: "A conexão do bot ainda precisa ser provisionada no ambiente da Luna.", tone: "bg-amber-50 text-amber-800" },
  disabled: { label: "Desativada", description: "Ative a integração para liberar o uso do bot no canal escolhido.", tone: "bg-slate-100 text-slate-700" },
  connecting: { label: "Conectando", description: "A Luna está estabelecendo a conexão com o Discord.", tone: "bg-indigo-50 text-indigo-800" },
  ready: { label: "Pronta para entrar", description: "No canal escolhido, use /luna entrar para chamar o bot.", tone: "bg-emerald-50 text-emerald-800" },
  in_channel: { label: "Na call", description: "A Luna está no canal. Use /luna sair para encerrar a sessão.", tone: "bg-emerald-50 text-emerald-800" },
  error: { label: "Erro de conexão", description: "Confira se o bot tem acesso ao servidor e pode conectar e falar no canal.", tone: "bg-rose-50 text-rose-800" },
};

const commands = [
  ["/luna entrar", "Chama a Luna para o canal de voz selecionado."],
  ["/luna perguntar", "Toca o bip e escuta uma pergunta neste turno."],
  ["/luna participar", "Ativa o wake word para os próximos turnos."],
  ["/luna parar", "Encerra sua participação e apaga o contexto temporário da call."],
  ["/luna sair", "Encerra a call para a Luna."],
] as const;

type Destination = { guildId: string; channelId: string };

function destination(settings: DiscordVoiceSettings): Destination {
  return { guildId: settings.guildId ?? "", channelId: settings.channelId ?? "" };
}

function channelLink(value: string): Destination | undefined {
  const match = value.trim().match(/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{1,20})\/(\d{1,20})(?:[/?#].*)?$/i);
  if (match) return { guildId: match[1], channelId: match[2] };
}

function validId(value: string) {
  return /^[1-9]\d{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615");
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a ação. Tente novamente.";
}

export default function DiscordSettingsPage() {
  const [settings, setSettings] = useState<DiscordVoiceSettings>();
  const [draft, setDraft] = useState<Destination>();
  const [ownerDraft, setOwnerDraft] = useState<string>();
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function refresh() {
      try {
        const result = await getDiscordVoice(controller.signal);
        if (controller.signal.aborted) return;
        setSettings(result);
        setDraft((current) => current ?? destination(result));
        setOwnerDraft((current) => current ?? result.ownerDiscordUserId ?? "");
        setLoadError("");
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(describeError(error));
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [busy, refreshCount]);

  const status = settings && statusCopy[settings.status.state];
  const guilds = settings?.destinations ?? [];
  const channels = guilds.find((guild) => guild.id === draft?.guildId)?.channels ?? [];
  const useManualGuild = manual || guilds.length === 0;
  const useManualChannel = manual || channels.length === 0;
  const valid = draft && validId(draft.guildId.trim()) && validId(draft.channelId.trim());
  const dirty = settings && draft && (
    draft.guildId.trim() !== (settings.guildId ?? "") ||
    draft.channelId.trim() !== (settings.channelId ?? "")
  );

  function chooseGuild(guildId: string) {
    setDraft((current) => current && (current.guildId === guildId ? current : { guildId, channelId: "" }));
  }

  function chooseChannel(channelId: string) {
    setDraft((current) => current && (channelLink(channelId) ?? { ...current, channelId }));
  }

  async function update(label: string, changes: Parameters<typeof updateDiscordVoice>[0], success: string) {
    setBusy(label);
    setSaveError("");
    setNotice("");
    try {
      const result = await updateDiscordVoice(changes);
      setSettings(result);
      if (changes.guildId !== undefined || changes.channelId !== undefined) setDraft(destination(result));
      if (changes.ownerDiscordUserId !== undefined) setOwnerDraft(result.ownerDiscordUserId ?? "");
      setNotice(success);
    } catch (error) {
      setSaveError(describeError(error));
    } finally {
      setBusy("");
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !valid) return;
    void update("Salvando canal…", {
      guildId: draft.guildId.trim(),
      channelId: draft.channelId.trim(),
    }, "Canal salvo.");
  }

  function toggle() {
    if (!settings || !draft) return;
    if (settings.enabled) {
      void update("Desativando…", { enabled: false }, "Integração desativada.");
    } else if (valid) {
      void update("Ativando…", {
        enabled: true,
        guildId: draft.guildId.trim(),
        channelId: draft.channelId.trim(),
      }, "Integração ativada. Use /luna entrar no canal selecionado.");
    }
  }

  function saveOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ownerDraft === undefined) return;
    const ownerDiscordUserId = ownerDraft.trim();
    if (ownerDiscordUserId && !validId(ownerDiscordUserId)) return;
    void update("Salvando identidade…", { ownerDiscordUserId: ownerDiscordUserId || null },
      ownerDiscordUserId ? "Sua identidade do Discord foi vinculada às memórias globais." : "Vínculo removido. A próxima fala usará um escopo isolado.");
  }

  return (
    <main className="h-dvh overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/settings" className={button}><ArrowLeft size={16} /> Configurações</Link>
        <header className="mb-6 mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Integrações de voz</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-slate-950">
            <Headphones className="shrink-0 text-indigo-600" size={28} /> Luna no Discord
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Escolha onde a Luna pode entrar e conversar por voz. O bot só entra quando você usa <code>/luna entrar</code>.
          </p>
        </header>

        {loadError && (
          <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Não foi possível atualizar a integração. {loadError}
          </p>
        )}
        {saveError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{saveError}</p>}
        {(busy || notice) && <p role="status" className="mb-4 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{busy || notice}</p>}
        {!settings && !loadError && <p role="status" className="text-sm text-slate-600">Carregando integração…</p>}
        {!settings && loadError && <button type="button" className={button} onClick={() => setRefreshCount((count) => count + 1)}>Tentar novamente</button>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          {settings && draft && status && (
            <div className="min-w-0 space-y-5">
              <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="discord-status">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="discord-status" className="text-lg font-semibold text-slate-900">Conexão do bot</h2>
                  <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + status.tone} aria-live="polite">{status.label}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{status.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={settings.enabled ? button : primary} disabled={Boolean(busy || (!settings.enabled && !valid))}
                    onClick={toggle}>
                    {settings.enabled ? "Desativar integração" : "Ativar integração"}
                  </button>
                  <button type="button" className={button} disabled={Boolean(busy)} onClick={() => setRefreshCount((count) => count + 1)}>
                    <RefreshCw size={15} /> Atualizar status
                  </button>
                </div>
              </section>

              <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="discord-destination">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="discord-destination" className="text-lg font-semibold text-slate-900">Canal autorizado</h2>
                  {guilds.length > 0 && <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline"
                    disabled={Boolean(busy)} onClick={() => setManual(!manual)}>
                    {manual ? "Escolher na lista" : "Informar IDs manualmente"}
                  </button>}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  A Luna entra somente no canal de voz definido aqui.
                </p>
                <form className="mt-4" onSubmit={save}>
                  <fieldset disabled={Boolean(busy)} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-800" htmlFor="discord-guild">
                        {useManualGuild ? "ID do servidor" : "Servidor"}
                      </label>
                      {useManualGuild ? (
                        <input id="discord-guild" className={field} value={draft.guildId} inputMode="numeric" autoComplete="off"
                          onChange={(event) => chooseGuild(event.target.value)} placeholder="ID numérico do servidor" />
                      ) : (
                        <select id="discord-guild" className={field} value={draft.guildId} onChange={(event) => chooseGuild(event.target.value)}>
                          <option value="">Selecione um servidor</option>
                          {draft.guildId && !guilds.some((guild) => guild.id === draft.guildId) && <option value={draft.guildId}>{draft.guildId}</option>}
                          {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-800" htmlFor="discord-channel">
                        {useManualChannel ? "ID ou link do canal de voz" : "Canal de voz"}
                      </label>
                      {useManualChannel ? (
                        <input id="discord-channel" className={field} value={draft.channelId} autoComplete="off" spellCheck={false}
                          onChange={(event) => chooseChannel(event.target.value)} placeholder="Cole o link do canal ou informe o ID" />
                      ) : (
                        <select id="discord-channel" className={field} value={draft.channelId} onChange={(event) => chooseChannel(event.target.value)}>
                          <option value="">Selecione um canal de voz</option>
                          {draft.channelId && !channels.some((channel) => channel.id === draft.channelId) && <option value={draft.channelId}>{draft.channelId}</option>}
                          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                        </select>
                      )}
                    </div>
                    {useManualChannel && <p className="text-xs leading-5 text-slate-600">Ao colar o link do canal, os dois IDs são preenchidos juntos.</p>}
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={button} disabled={!valid || !dirty}>Salvar canal</button>
                      {settings.guildId && settings.channelId && (
                        <a className={button} href={"https://discord.com/channels/" + settings.guildId + "/" + settings.channelId}
                          target="_blank" rel="noreferrer">
                          Abrir canal no Discord <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </fieldset>
                </form>
              </section>

              <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="discord-identity">
                <h2 id="discord-identity" className="text-lg font-semibold text-slate-900">Sua identidade e memórias</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Vincule seu ID do Discord para a Luna usar suas memórias e conversas globais. As outras pessoas ficam em escopos isolados.
                </p>
                <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={saveOwner}>
                  <label className="flex-1 text-sm font-medium text-slate-800" htmlFor="discord-owner-id">
                    Seu ID de usuário do Discord
                    <input id="discord-owner-id" className={field} value={ownerDraft ?? ""} inputMode="numeric" autoComplete="off"
                      onChange={(event) => setOwnerDraft(event.target.value)} placeholder="ID numérico da sua conta" />
                  </label>
                  <button type="submit" className={button + " sm:mt-7"} disabled={Boolean(busy || ownerDraft === undefined ||
                    ((ownerDraft.trim() || null) === settings.ownerDiscordUserId) || (ownerDraft.trim() && !validId(ownerDraft.trim())))}>
                    Salvar vínculo
                  </button>
                </form>
                <p className="mt-2 text-xs leading-5 text-slate-500">Ative o Modo desenvolvedor no Discord e copie seu ID pelo menu do seu perfil.</p>
              </section>
            </div>
          )}

          <aside className="glass self-start rounded-3xl p-5 sm:p-6" aria-labelledby="discord-guide">
            <h2 id="discord-guide" className="text-lg font-semibold text-slate-900">Como usar na call</h2>
            <dl className="mt-3 space-y-3">
              {commands.map(([command, description]) => (
                <div key={command}>
                  <dt className="font-mono text-sm font-semibold text-indigo-800">{command}</dt>
                  <dd className="mt-0.5 text-sm leading-5 text-slate-600">{description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t border-indigo-100 pt-4 text-sm leading-6 text-slate-700">
              Para falar uma vez, use <strong>/luna perguntar</strong>; o bip toca e só a voz de quem chamou é capturada. Para usar o wake word, primeiro use <strong>/luna participar</strong> e diga “Luna” antes da pergunta.
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              A fala reconhecida e a resposta viram mensagens em conversas visíveis na interface e nos fluxos da Luna. O áudio bruto não é salvo; todos no canal ouvem a resposta.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}

