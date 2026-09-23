"use client";

import {
  ArrowUp,
  BarChart3,
  Bot,
  CirclePlus,
  LoaderCircle,
  Menu,
  MessageSquare,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { Settings as SettingsIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getConversation,
  getConversations,
  executeConversationRetrieval,
  sendConversationMessage,
  type ConversationListItem,
  type ConversationMessage,
  type ConversationMessageRole,
  type ConversationRetrievalScope,
} from "@/lib/conversation-api";
import { BrainFlow, type BrainStage } from "@/components/observability/brain-flow";
import { TokenCounter, estimateUiTokens } from "@/components/observability/token-counter";
import { MarkdownMessage } from "@/components/chat/markdown-message";

type UiMessage = {
  id: string;
  role: ConversationMessageRole;
  content: string;
  createdAt?: string;
  failed?: boolean;
};

const welcomeMessage: UiMessage = {
  id: "welcome",
  role: "assistant",
  content: "Olá, eu sou a Luna. Como posso ajudar você hoje?",
};

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function titleFromMessage(content: string): string {
  const title = content.replace(/\s+/gu, " ").trim();
  return title.length > 42 ? `${title.slice(0, 41).trim()}…` : title || "Nova conversa";
}

function toUiMessage(message: ConversationMessage): UiMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export function ChatShell() {
  const [messages, setMessages] = useState<UiMessage[]>([welcomeMessage]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [conversationTitle, setConversationTitle] = useState("Nova conversa");
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [isConversationsLoading, setIsConversationsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [historyError, setHistoryError] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsMode, setToolsMode] = useState(false);
  const [toolDateFrom, setToolDateFrom] = useState("");
  const [toolDateTo, setToolDateTo] = useState("");
  const [toolScope, setToolScope] = useState<ConversationRetrievalScope>("auto");
  const [brainStage, setBrainStage] = useState<BrainStage>();
  const [completedBrainStages, setCompletedBrainStages] = useState<BrainStage[]>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isInteractionDisabled = isLoading || isConversationLoading;
  const visibleMessages = messages.filter((message) => message.id !== welcomeMessage.id);
  const historyTokens = estimateUiTokens(
    visibleMessages
      .filter((message) => message.role !== "tool")
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n"),
  );
  const toolsTokens = estimateUiTokens(
    visibleMessages
      .filter((message) => message.role === "tool")
      .map((message) => message.content)
      .join("\n"),
  );
  const outputTokens = estimateUiTokens(
    [...visibleMessages].reverse().find((message) => message.role === "assistant")?.content ?? "",
  );
  const conversationStats = conversationId
    ? getLocalConversationStats(visibleMessages)
    : undefined;

  const loadConversations = async () => {
    setIsConversationsLoading(true);

    try {
      setConversations(await getConversations());
      setHistoryError(undefined);
    } catch {
      setHistoryError("Não foi possível carregar o histórico.");
    } finally {
      setIsConversationsLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;

    const loadInitialConversations = async () => {
      try {
        const initialConversations = await getConversations();

        if (isCurrent) {
          setConversations(initialConversations);
          setHistoryError(undefined);
        }
      } catch {
        if (isCurrent) {
          setHistoryError("Não foi possível carregar o histórico.");
        }
      } finally {
        if (isCurrent) {
          setIsConversationsLoading(false);
        }
      }
    };

    void loadInitialConversations();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading, isConversationLoading, error]);

  const startNewConversation = () => {
    if (isInteractionDisabled) {
      return;
    }

    setConversationId(undefined);
    setConversationTitle("Nova conversa");
    setMessages([welcomeMessage]);
    setDraft("");
    setError(undefined);
    setToolScope("auto");
    setBrainStage(undefined);
    setCompletedBrainStages([]);
    setSidebarOpen(false);
  };

  const openConversation = async (selectedConversationId: string) => {
    if (selectedConversationId === conversationId) {
      setSidebarOpen(false);
      return;
    }

    if (isInteractionDisabled) {
      return;
    }

    setIsConversationLoading(true);
    setError(undefined);

    try {
      const conversation = await getConversation(selectedConversationId);

      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setMessages(
        conversation.messages.length > 0
          ? conversation.messages.map(toUiMessage)
          : [welcomeMessage],
      );
      setDraft("");
      setSidebarOpen(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível abrir essa conversa.",
      );
      setSidebarOpen(false);
    } finally {
      setIsConversationLoading(false);
    }
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const content = draft.trim();
    const canRunDirectTool =
      toolsMode && Boolean(toolDateFrom || toolDateTo);

    if ((!content && !canRunDirectTool) || isInteractionDisabled) {
      return;
    }

    const optimisticId = createId();
    const optimisticMessage: UiMessage = {
      id: optimisticId,
      role: "user",
      content,
    };

    const isFirstMessage = !conversationId;
    if (content) {
      setMessages((current) => [...current, optimisticMessage]);
    }
    setDraft("");
    setError(undefined);
    setIsLoading(true);
    setBrainStage("user");
    setCompletedBrainStages([]);

    try {
      if (toolsMode) {
        setBrainStage("context");
        setCompletedBrainStages(["user"]);
        const immediateContext = [
          ...messages
            .filter((message) => message.id !== welcomeMessage.id)
            .map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
            })),
          ...(content
            ? [{ id: optimisticId, role: "user" as const, content }]
            : []),
        ];
        const currentMessageId = toolScope !== "historical"
          ? [...messages]
              .reverse()
              .find(
                (message) =>
                  message.id !== welcomeMessage.id && message.role !== "tool",
              )?.id
          : undefined;
        const response = await executeConversationRetrieval({
          query: content || undefined,
          conversationId,
          currentMessageId,
          dateFrom: toolDateFrom || undefined,
          dateTo: toolDateTo || undefined,
          scope: toolScope,
          messages: immediateContext,
        });

        setBrainStage("tools");
        setCompletedBrainStages(["user", "context"]);

        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "tool",
            content: formatToolResponse(response),
          },
        ]);
        setBrainStage("luna");
        setCompletedBrainStages(["user", "context", "tools"]);
      } else {
        setBrainStage("context");
        setCompletedBrainStages(["user"]);
        const response = await sendConversationMessage({ content, conversationId });
        const userMessage = response.messages.find((message) => message.role === "user");
        const assistantMessage = response.messages.find(
          (message) => message.role === "assistant",
        );

        setConversationId(response.conversationId);
        if (isFirstMessage) {
          setConversationTitle(titleFromMessage(content));
        }

        void loadConversations();

        setMessages((current) => {
          const withPersistedUser = current.map((message) =>
            message.id === optimisticId && userMessage ? toUiMessage(userMessage) : message,
          );

          return assistantMessage
            ? [...withPersistedUser, toUiMessage(assistantMessage)]
            : withPersistedUser;
        });
        setBrainStage("luna");
        setCompletedBrainStages(["user", "context"]);
      }
    } catch (requestError) {
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticId ? { ...message, failed: true } : message,
        ),
      );
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível obter uma resposta agora.",
      );
      setBrainStage(undefined);
      setCompletedBrainStages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <main className="relative h-dvh overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
      <div className="animate-breathe pointer-events-none absolute -left-32 top-4 size-96 rounded-full bg-indigo-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-0 size-[30rem] rounded-full bg-violet-200/35 blur-3xl" />

      <div className="relative mx-auto flex h-[calc(100dvh-1.5rem)] max-w-[1600px] min-h-0 gap-4 sm:h-[calc(100dvh-2.5rem)]">
        <ChatSidebar
          className="hidden h-full w-80 shrink-0 lg:flex"
          conversationId={conversationId}
          conversations={conversations}
          disabled={isInteractionDisabled}
          historyError={historyError}
          isConversationsLoading={isConversationsLoading}
          onSelectConversation={openConversation}
          onStartNew={startNewConversation}
        />

        <section className="glass flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-[1.7rem]">
          <header className="flex h-[4.75rem] shrink-0 items-center justify-between border-b border-white/70 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-label="Abrir painel de conversas"
                className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-900 lg:hidden"
                onClick={() => setSidebarOpen(true)}
                type="button"
              >
                <Menu className="size-4" />
              </button>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-950 to-slate-700 text-white shadow-lg shadow-slate-500/20 lg:hidden">
                <Sparkles className="size-4" strokeWidth={2.3} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold tracking-tight">
                    {conversationTitle}
                  </h1>
                  <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 sm:inline-flex">
                    {conversationId ? "Salva" : "Nova"}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {conversationId ? "Conversa em andamento" : "Assistente pessoal"}
                </p>
              </div>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-slate-500 transition hover:bg-white/75 hover:text-slate-900"
                href={conversationId ? `/observability?conversation=${conversationId}` : "/observability"}
              >
                <BarChart3 className="size-3.5" />
                Observabilidade
              </Link>
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-slate-500 transition hover:bg-white/75 hover:text-slate-900"
                href="/settings"
              >
                <SettingsIcon className="size-3.5" />
                Configurações
              </Link>
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(34,197,94,0.12)]" />
              Pronta para ajudar
            </div>
          </header>

          <div className="scrollbar-subtle shrink-0 overflow-x-auto border-b border-white/55 px-4 py-2 sm:px-8">
            <BrainFlow
              activeStage={brainStage}
              completedStages={completedBrainStages}
              compact
            />
          </div>
          {conversationStats ? (
            <div className="scrollbar-subtle shrink-0 overflow-x-auto border-b border-white/45 px-4 py-2 sm:px-8">
              <ConversationStatsStrip stats={conversationStats} />
            </div>
          ) : null}

          <div
            className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
            ref={viewportRef}
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end">
              <div className="space-y-5">
                {isConversationLoading ? (
                  <ConversationLoadingIndicator />
                ) : (
                  messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))
                )}
                {isLoading ? <ThinkingIndicator /> : null}
                {error ? (
                  <div className="animate-fade-up rounded-xl border border-red-200/80 bg-red-50/75 px-3 py-2 text-sm text-red-700 sm:ml-11">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-4 sm:px-8 sm:pb-7">
            <div className="mx-auto mb-3 max-w-3xl">
              <TokenCounter
                historyTokens={historyTokens}
                inputTokens={estimateUiTokens(draft)}
                outputTokens={outputTokens}
                toolsTokens={toolsTokens}
              />
            </div>
            <form
              className="mx-auto max-w-3xl rounded-[1.35rem] border border-white/85 bg-white/70 p-2.5 shadow-[0_16px_38px_rgba(34,37,62,0.1)] backdrop-blur-xl transition-shadow focus-within:shadow-[0_18px_44px_rgba(34,37,62,0.15)]"
              onSubmit={submit}
            >
              <textarea
                aria-label="Mensagem para Luna"
                className="min-h-20 w-full resize-none rounded-2xl bg-transparent px-1 py-1 text-[15px] leading-6 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isInteractionDisabled}
                maxLength={16_000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={toolsMode ? "Consulta forçada da tool..." : "Pergunte qualquer coisa..."}
                rows={2}
                value={draft}
              />
              <div className="flex items-center justify-between pt-1">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    aria-pressed={toolsMode}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                      toolsMode
                        ? "bg-indigo-100 text-indigo-700"
                        : "text-slate-500 hover:bg-white/80 hover:text-slate-800"
                    }`}
                    disabled={isInteractionDisabled}
                    onClick={() => setToolsMode((current) => !current)}
                    type="button"
                  >
                    <Wrench className="size-3.5" />
                    Tools
                  </button>
                  {toolsMode ? (
                    <>
                      <select
                        aria-label="Tool forçada"
                        className="h-8 max-w-[12rem] rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 text-[11px] font-medium text-indigo-700 outline-none"
                        defaultValue="conversation_retrieval"
                        disabled={isInteractionDisabled}
                      >
                        <option value="conversation_retrieval">conversation_retrieval</option>
                      </select>
                      <input
                        aria-label="Data inicial da recuperação"
                        className="hidden h-8 w-32 rounded-lg border border-white/80 bg-white/60 px-2 text-[11px] text-slate-600 outline-none focus:border-indigo-200 sm:block"
                        disabled={isInteractionDisabled}
                        onChange={(event) => setToolDateFrom(event.target.value)}
                        type="date"
                        value={toolDateFrom}
                      />
                      <input
                        aria-label="Data final da recuperação"
                        className="hidden h-8 w-32 rounded-lg border border-white/80 bg-white/60 px-2 text-[11px] text-slate-600 outline-none focus:border-indigo-200 sm:block"
                        disabled={isInteractionDisabled}
                        onChange={(event) => setToolDateTo(event.target.value)}
                        type="date"
                        value={toolDateTo}
                      />
                      <select
                        aria-label="Escopo da recuperação"
                        className="hidden h-8 rounded-lg border border-white/80 bg-white/60 px-2 text-[11px] text-slate-600 outline-none focus:border-indigo-200 lg:block"
                        disabled={isInteractionDisabled}
                        onChange={(event) =>
                          setToolScope(event.target.value as ConversationRetrievalScope)
                        }
                        value={toolScope}
                      >
                        <option value="auto">Escopo: automático</option>
                        <option disabled={!conversationId} value="current_conversation">
                          Nesta conversa
                        </option>
                        <option value="historical">Outras conversas</option>
                      </select>
                    </>
                  ) : null}
                  <p className="hidden pl-1 text-[11px] text-slate-500 xl:block">
                    Enter para enviar · Shift + Enter para nova linha
                  </p>
                </div>
                <span className="sm:hidden" />
                <button
                  aria-label="Enviar mensagem"
                  className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-45"
                  disabled={
                    (!draft.trim() &&
                      !(toolsMode && Boolean(toolDateFrom || toolDateTo))) ||
                    isInteractionDisabled
                  }
                  type="submit"
                >
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                </button>
              </div>
            </form>
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Luna pode cometer erros. Confira informações importantes.
            </p>
          </div>
        </section>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-3 z-50 lg:hidden">
          <ChatSidebar
            className="h-full w-full"
            conversationId={conversationId}
            conversations={conversations}
            disabled={isInteractionDisabled}
            historyError={historyError}
            isConversationsLoading={isConversationsLoading}
            onClose={() => setSidebarOpen(false)}
            onSelectConversation={openConversation}
            onStartNew={startNewConversation}
          />
        </div>
      ) : null}
    </main>
  );
}

function ChatSidebar({
  className,
  conversationId,
  conversations,
  disabled,
  historyError,
  isConversationsLoading,
  onClose,
  onSelectConversation,
  onStartNew,
}: {
  className?: string;
  conversationId?: string;
  conversations: ConversationListItem[];
  disabled: boolean;
  historyError?: string;
  isConversationsLoading: boolean;
  onClose?: () => void;
  onSelectConversation: (conversationId: string) => void;
  onStartNew: () => void;
}) {
  return (
    <aside
      aria-label="Conversas"
      className={`glass min-h-0 flex-col rounded-[1.7rem] p-3 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-950 to-slate-700 text-white shadow-lg shadow-slate-500/20">
          <Sparkles className="size-4" strokeWidth={2.3} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-tight">Luna</p>
          <p className="text-[10px] text-slate-500">Assistente pessoal local</p>
        </div>
        {onClose ? (
          <button
            aria-label="Fechar painel de conversas"
            className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <button
        className="mt-5 flex h-10 w-full items-center justify-start gap-2 rounded-xl bg-white/70 px-4 text-sm font-medium text-slate-800 shadow-sm transition-all hover:-translate-y-px hover:bg-white disabled:pointer-events-none disabled:opacity-45"
        disabled={disabled}
        onClick={onStartNew}
        type="button"
      >
        <CirclePlus className="size-4" />
        Nova conversa
      </button>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Conversas
          </p>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {conversations.length}
          </span>
        </div>

        <div className="scrollbar-subtle mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {isConversationsLoading && conversations.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/90 bg-white/28 px-3 py-5 text-[11px] text-slate-500">
              <LoaderCircle className="size-3.5 animate-spin" />
              Carregando conversas
            </div>
          ) : null}

          {conversations.map((conversation) => {
            const isActive = conversation.id === conversationId;

            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={`w-full rounded-xl border p-3 text-left shadow-sm transition-all hover:-translate-y-px disabled:pointer-events-none disabled:opacity-45 ${
                  isActive
                    ? "border-indigo-200 bg-indigo-50/80 shadow-indigo-100"
                    : "border-white/90 bg-white/60 hover:bg-white/85"
                }`}
                disabled={disabled}
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                type="button"
              >
                <div className="flex items-start gap-2">
                  <MessageSquare
                    className={`mt-0.5 size-3.5 shrink-0 ${
                      isActive ? "text-indigo-600" : "text-slate-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">
                      {conversation.title}
                    </p>
                    <p className="mt-1 truncate text-[10px] leading-4 text-slate-500">
                      {conversation.preview || "Sem mensagens ainda."}
                    </p>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      {conversation.messageCount} {conversation.messageCount === 1 ? "mensagem" : "mensagens"}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}

          {!isConversationsLoading && conversations.length === 0 && !historyError ? (
            <div className="rounded-xl border border-dashed border-white/90 bg-white/28 px-3 py-5 text-center">
              <MessageSquare className="mx-auto size-4 text-slate-400" />
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                Suas conversas aparecerão aqui.
              </p>
            </div>
          ) : null}

          {historyError ? (
            <p className="rounded-xl border border-red-100 bg-red-50/70 px-3 py-2 text-[11px] leading-4 text-red-700">
              {historyError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 border-t border-white/70 px-3 pt-3 text-[11px] text-slate-500">
        <Link className="inline-flex items-center gap-1.5 transition hover:text-slate-900" href={conversationId ? `/observability?conversation=${conversationId}` : "/observability"}>
          <BarChart3 className="size-3" />
          Observabilidade
        </Link>
        <span className="mx-1.5 text-slate-300">·</span>
        <Link className="inline-flex items-center gap-1.5 transition hover:text-slate-900" href="/settings">
          <SettingsIcon className="size-3" />
          Configurações
        </Link>
        <span className="mx-1.5 text-slate-300">·</span>
        Core de conversa ativo
      </div>
    </aside>
  );
}

function ConversationLoadingIndicator() {
  return (
    <div className="animate-fade-up flex items-center gap-3 text-sm text-slate-500">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/68 text-slate-500 shadow-sm">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
      Carregando conversa…
    </div>
  );
}

function MessageBubble({ message }: { message: UiMessage }) {
  const isTool = message.role === "tool";
  const isAssistant =
    message.role === "assistant" || message.role === "system" || isTool;

  return (
    <article className={`animate-fade-up flex gap-3 ${isAssistant ? "items-start" : "justify-end"}`}>
      {isAssistant ? (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md shadow-slate-400/20">
          {isTool ? <Wrench className="size-4" /> : <Bot className="size-4" />}
        </div>
      ) : null}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-6 shadow-sm sm:max-w-[75%] ${
          isAssistant
            ? "border border-white/90 bg-white/68 text-slate-900"
            : "bg-slate-900 text-white shadow-slate-500/20"
        } ${message.failed ? "ring-1 ring-red-300" : ""}`}
      >
        {message.role === "assistant" ? (
          <MarkdownMessage content={message.content} />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
        {message.failed ? (
          <p className="mt-2 border-t border-white/15 pt-2 text-[11px] text-red-200">
            A resposta não foi concluída.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function formatToolResponse(response: Awaited<ReturnType<typeof executeConversationRetrieval>>): string {
  if (response.result.results.length === 0) {
    return "conversation_retrieval\n\nNenhum contexto encontrado para esta consulta.";
  }

  const sections = response.result.results.map((result, index) => {
    const messages = result.messages
      ?.map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    return [
      `Resultado ${index + 1} · ${result.status} · score ${result.score.toFixed(3)}`,
      `Período: ${result.timeRange.start} → ${result.timeRange.end} (${result.timeRange.timeZone})`,
      result.content,
      result.tailContent ? `Tail não indexada:\n${result.tailContent}` : "",
      messages ? `Mensagens deduplicadas:\n${messages}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  return `conversation_retrieval · ${response.result.results.length} resultado(s)\n\n${sections.join("\n\n---\n\n")}`;
}

function ThinkingIndicator() {
  return (
    <div className="animate-fade-up flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md shadow-slate-400/20">
        <Bot className="size-4" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl border border-white/90 bg-white/68 px-4 py-3 shadow-sm">
        <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
        <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
        <span className="ml-1 text-xs text-slate-500">Pensando</span>
        <LoaderCircle className="ml-1 size-3 animate-spin text-slate-400" />
      </div>
    </div>
  );
}

function getLocalConversationStats(messages: UiMessage[]) {
  const datedMessages = messages
    .map((message) => (message.createdAt ? new Date(message.createdAt).getTime() : undefined))
    .filter((value): value is number => value !== undefined && !Number.isNaN(value));
  const content = messages.map((message) => message.content).join("\n");

  return {
    messageCount: messages.length,
    tokenCount: estimateUiTokens(content),
    durationMs: datedMessages.length > 1 ? Math.max(...datedMessages) - Math.min(...datedMessages) : 0,
    toolsUsed: messages.filter((message) => message.role === "tool").length,
  };
}

function ConversationStatsStrip({
  stats,
}: {
  stats: { messageCount: number; tokenCount: number; durationMs: number; toolsUsed: number };
}) {
  return (
    <div className="mx-auto flex max-w-3xl min-w-max items-center gap-4 text-[10px] text-slate-500">
      <span className="font-medium text-slate-600">Estatísticas da conversa</span>
      <span>{stats.messageCount} {stats.messageCount === 1 ? "mensagem" : "mensagens"}</span>
      <span>{formatChatTokens(stats.tokenCount)} tokens</span>
      <span>{formatChatDuration(stats.durationMs)}</span>
      <span>{stats.toolsUsed} {stats.toolsUsed === 1 ? "tool" : "tools"}</span>
      <span className="text-slate-400">0 memórias · 0 relacionadas</span>
    </div>
  );
}

function formatChatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

function formatChatDuration(value: number): string {
  if (value < 60_000) {
    return `${Math.round(value / 1000)}s de duração`;
  }

  return `${Math.round(value / 60_000)}min de duração`;
}
