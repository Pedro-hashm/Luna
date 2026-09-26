"use client";

import Link from "next/link";
import {
  Bot,
  ChevronDown,
  Database,
  Download,
  Globe2,
  Layers3,
  LoaderCircle,
  Mic2,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  getSettings,
  getRerankerModels,
  getTemporalConsolidationRuns,
  getTemporalConsolidationRun,
  getTemporalConsolidationStatus,
  downloadRerankerModel,
  compareRerankers,
  runTemporalConsolidation,
  updateSettings,
  type RerankerComparisonResponse,
  type RerankerModel,
  type RerankerModelsResponse,
  type SettingsResponse,
  type TemporalConsolidationRun,
  type TemporalConsolidationRunDetails,
  type TemporalConsolidationStatus,
} from "@/lib/conversation-api";
import { VoiceProfilesSettings } from "@/components/voice/voice-profiles-settings";
import { WakeTrainingSettings } from "@/components/voice/wake-training-settings";
import { WakeModelStatusBadge } from "@/components/voice/wake-model-status";

type SettingsScope = "application" | "conversationChunks";
type FieldKind = "text" | "number" | "checkbox" | "select" | "time";

type ConfigField = {
  scope: SettingsScope;
  key: string;
  label: string;
  description: string;
  kind: FieldKind;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  readOnly?: boolean;
  nullable?: boolean;
  options?: Array<{ label: string; value: string }>;
};

type ConfigSection = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  fields: ConfigField[];
};

const configSections: ConfigSection[] = [
  {
    id: "voice",
    eyebrow: "Áudio",
    title: "Voz e Wake Word",
    description: "Controle a escuta, a resposta falada, a detecção de Luna e os providers do pipeline.",
    icon: Mic2,
    fields: [
      { scope: "application", key: "voiceEnabled", label: "Voz ativada", description: "Permite abrir sessões de voz.", kind: "checkbox" },
      { scope: "application", key: "voiceDefaultMode", label: "Modo padrão", description: "Wake aguarda Luna; Live escuta sem palavra de ativação.", kind: "select", options: [{ label: "Wake", value: "wake" }, { label: "Live", value: "live" }] },
      { scope: "application", key: "wakeEnabled", label: "Wake word ativada", description: "Habilita a detecção leve de Luna no modo Wake.", kind: "checkbox" },
      { scope: "application", key: "wakeKeyword", label: "Palavra de ativação", description: "O modelo instalado detecta Luna. Para outra palavra, é necessário treinar e instalar um modelo correspondente.", kind: "text", readOnly: true },
      { scope: "application", key: "wakeModel", label: "Modelo wake", description: "Identificador do luna.onnx instalado no serviço wake.", kind: "text", readOnly: true },
      { scope: "application", key: "wakeThreshold", label: "Sensibilidade do wake", description: "Score mínimo para aceitar uma detecção.", kind: "number", min: 0, max: 1, step: "0.01" },
      { scope: "application", key: "wakeVerifierEnabled", label: "Verifier ativado", description: "Exige uma segunda verificação após a detecção inicial.", kind: "checkbox" },
      { scope: "application", key: "wakeVerifierModel", label: "Modelo verifier", description: "Identificador do modelo de verificação opcional.", kind: "text", nullable: true },
      { scope: "application", key: "wakeVerifierThreshold", label: "Threshold verifier", description: "Score mínimo da segunda verificação.", kind: "number", min: 0, max: 1, step: "0.01" },
      { scope: "application", key: "voiceSpeed", label: "Velocidade da fala", description: "Controla Kokoro, F5-TTS e Fish Audio; Qwen usa o ritmo natural do clone.", kind: "number", min: 0.5, max: 2, step: "0.05" },
      { scope: "application", key: "voiceResponseMode", label: "Resposta por voz", description: "Aplica respostas curtas ao LLM final.", kind: "select", options: [{ label: "Curta e direta", value: "concise" }, { label: "Normal", value: "normal" }] },
      { scope: "application", key: "voiceMaxSentences", label: "Máximo de frases", description: "Limite configurável para resposta falada.", kind: "number", min: 1, max: 20 },
      { scope: "application", key: "voiceMaxWords", label: "Máximo de palavras", description: "Limite configurável para resposta falada.", kind: "number", min: 10, max: 500 },
      { scope: "application", key: "voiceBargeInEnabled", label: "Barge-in", description: "Interrompe o áudio da Luna quando você começa a falar.", kind: "checkbox" },
      { scope: "application", key: "voiceTtsStreamingEnabled", label: "Áudio em streaming", description: "Só afeta o Faster Qwen3-TTS. Quando ativo, reproduz os blocos enquanto o restante da fala é sintetizado.", kind: "checkbox" },
      { scope: "application", key: "sttProvider", label: "Provider STT", description: "Provider de transcrição.", kind: "select", options: [{ label: "Speaches", value: "speaches" }] },
      { scope: "application", key: "voiceTtsEngine", label: "Motor de voz", description: "Escolha entre os motores locais e o Fish Audio.", kind: "select", options: [{ label: "Kokoro · Dora / Luna Nobre", value: "kokoro" }, { label: "Qwen3-TTS · minha voz clonada", value: "qwen" }, { label: "Faster Qwen3-TTS · clonagem rápida", value: "qwen-fast" }, { label: "F5-TTS pt-BR · minha voz clonada", value: "f5" }, { label: "Fish Audio · S2.1 Pro grátis", value: "fish" }] },
      { scope: "application", key: "fishAudioReferenceId", label: "Fish Audio reference_id", description: "Cole o ID da voz no Fish Audio. A chave FISH_AUDIO_API_KEY é lida da .env raiz do projeto.", kind: "text", placeholder: "Cole aqui o ID da voz" },
    ],
  },
  {
    id: "general",
    eyebrow: "Aplicação",
    title: "Geral",
    description: "Valores de ambiente que afetam a interpretação temporal e o comportamento global.",
    icon: Globe2,
    fields: [
      {
        scope: "application",
        key: "appTimezone",
        label: "Fuso horário da aplicação",
        description: "Usado para interpretar datas como hoje, ontem e janelas de retrieval.",
        kind: "text",
        placeholder: "America/Sao_Paulo",
      },
      {
        scope: "application",
        key: "conversationEvidenceEnabled",
        label: "Conversation Evidence",
        description: "Permite que respostas baseadas no histórico mantenham referências às fontes recuperadas para reutilização em mensagens futuras.",
        kind: "checkbox",
      },
    ],
  },
  {
    id: "llm",
    eyebrow: "Modelos",
    title: "LLM · resposta final",
    description: "Combo e parâmetros usados pelo LunaModule para gerar a resposta final.",
    icon: Bot,
    fields: [
      {
        scope: "application",
        key: "llmCombo",
        label: "Combo do LLM",
        description: "Identificador do combo enviado ao OmniRoute para responder mensagens.",
        kind: "text",
        placeholder: "local-general",
      },
      {
        scope: "application",
        key: "llmTemperature",
        label: "Temperature",
        description: "Deixe vazio para usar o default do provedor. Faixa aceita: 0 a 2.",
        kind: "number",
        min: 0,
        max: 2,
        step: "0.1",
        placeholder: "Default do provedor",
      },
      {
        scope: "application",
        key: "llmMaxTokens",
        label: "Máximo de tokens da resposta",
        description: "Deixe vazio para não enviar limite explícito ao OmniRoute.",
        kind: "number",
        min: 1,
        max: 100000,
        placeholder: "Sem limite explícito",
      },
    ],
  },
  {
    id: "orchestrator",
    eyebrow: "Modelos",
    title: "Orchestrator",
    description: "Decisões iterativas e limites básicos do planejamento e tool calling.",
    icon: Sparkles,
    fields: [
      {
        scope: "application",
        key: "orchestratorCombo",
        label: "Combo do Orchestrator",
        description: "Usado pelo Orchestrator para emitir decisões estruturadas.",
        kind: "text",
        placeholder: "local-general",
      },
      {
        scope: "application",
        key: "orchestratorMaxIterations",
        label: "Máximo de iterações",
        description: "Proteção contra loops: limita quantas decisões o Orchestrator pode tomar em uma request.",
        kind: "number",
        min: 1,
        max: 20,
      },
      {
        scope: "application",
        key: "orchestratorMaxToolCalls",
        label: "Máximo de chamadas de tools",
        description: "Proteção contra loops: limita quantas tools podem ser executadas em uma request.",
        kind: "number",
        min: 1,
        max: 20,
      },
      {
        scope: "application",
        key: "orchestratorToolResultMaxTokens",
        label: "Máximo de tokens por resultado de tool",
        description: "Limite de conteúdo de uma tool que pode voltar ao Orchestrator; evita estourar o contexto do modelo local. O default é 1000.",
        kind: "number",
        min: 1,
        max: 100000,
      },
    ],
  },
  {
    id: "web-research",
    eyebrow: "Pesquisa",
    title: "Pesquisa na Web",
    description: "Planejamento, fontes, extração e limites da pesquisa executada pelo Search Orchestrator.",
    icon: Globe2,
    fields: [
      {
        scope: "application",
        key: "researchEnabled",
        label: "Ativada",
        description: "Permite que a Luna pesquise fontes da internet quando a conversa precisar de informações externas.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "researchSearchOrchestratorCombo",
        label: "Search Orchestrator Combo",
        description: "Combo enviado ao OmniRoute para planejar a pesquisa, independente do LLM de resposta.",
        kind: "text",
        placeholder: "local-reasoning",
      },
      {
        scope: "application",
        key: "researchDefaultMode",
        label: "Modo padrão",
        description: "Quick prioriza baixa latência; Deep permite rodadas adicionais dentro dos limites configurados.",
        kind: "select",
        options: [
          { label: "Quick", value: "quick" },
          { label: "Deep", value: "deep" },
        ],
      },
      {
        scope: "application",
        key: "researchMaxSources",
        label: "Máximo de fontes",
        description: "Quantidade máxima de fontes selecionadas para extração em cada pesquisa.",
        kind: "number",
        min: 1,
        max: 20,
      },
      {
        scope: "application",
        key: "researchMaxRounds",
        label: "Máximo de rodadas",
        description: "Limita novas buscas quando a verificação encontra lacunas ou conflitos.",
        kind: "number",
        min: 1,
        max: 5,
      },
      {
        scope: "application",
        key: "researchMaxQueries",
        label: "Máximo de queries",
        description: "Limite de consultas que o planner pode gerar durante a execução.",
        kind: "number",
        min: 1,
        max: 12,
      },
      {
        scope: "application",
        key: "researchDefaultRecency",
        label: "Recência padrão",
        description: "Janela temporal preferida para resultados de busca quando a pergunta não especifica uma.",
        kind: "select",
        options: [
          { label: "Automático", value: "auto" },
          { label: "Último dia", value: "day" },
          { label: "Última semana", value: "week" },
          { label: "Último mês", value: "month" },
          { label: "Último ano", value: "year" },
        ],
      },
      {
        scope: "application",
        key: "researchSearchProvider",
        label: "Provider de busca",
        description: "Provedor utilizado para descobrir páginas e metadados.",
        kind: "select",
        options: [{ label: "SearXNG", value: "searxng" }],
      },
      {
        scope: "application",
        key: "researchExtractionProvider",
        label: "Provider de extração",
        description: "Tenta conteúdo estático primeiro e usa o browser quando necessário e permitido.",
        kind: "select",
        options: [{ label: "Static → Browser", value: "static-with-browser-fallback" }],
      },
      {
        scope: "application",
        key: "researchCacheEnabled",
        label: "Cache",
        description: "Reutiliza resultados e documentos recentes quando a pesquisa permite cache.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "researchBrowserFallbackEnabled",
        label: "Browser fallback",
        description: "Permite tentar Chromium quando a extração HTTP não obtém conteúdo útil.",
        kind: "checkbox",
      },
    ],
  },
  {
    id: "retrieval-engine",
    eyebrow: "Retrieval",
    title: "Retrieval Engine",
    description: "Estratégia, candidatos por fase, fusão RRF, cross-encoder local, threshold, deduplicação e orçamento da conversation_retrieval.",
    icon: Wrench,
    fields: [
      {
        scope: "application",
        key: "retrievalDefaultTopK",
        label: "Top K final",
        description: "Quantidade máxima de chunks relevantes depois do ranking, threshold e deduplicação.",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        scope: "application",
        key: "retrievalMaxTopK",
        label: "Top K máximo",
        description: "Limite de segurança para impedir consultas com candidatos ilimitados.",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        scope: "application",
        key: "retrievalDefaultMaxContextTokens",
        label: "Orçamento de contexto padrão",
        description: "Máximo de tokens de conteúdo retornado quando a chamada não informa um valor.",
        kind: "number",
        min: 1,
        max: 100000,
      },
      {
        scope: "application",
        key: "retrievalMaxContextTokens",
        label: "Orçamento de contexto máximo",
        description: "Limite de segurança para o orçamento solicitado pela tool.",
        kind: "number",
        min: 1,
        max: 100000,
      },
      {
        scope: "application",
        key: "retrievalIncludeMessages",
        label: "Incluir mensagens por padrão",
        description: "Retorna mensagens estruturadas além do conteúdo concatenado dos chunks. O Orchestrator usa false para evitar duplicação no prompt.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "retrievalStrategy",
        label: "Estratégia de busca",
        description: "Escolha busca vetorial, lexical ou a fusão híbrida por RRF.",
        kind: "select",
        options: [
          { label: "Híbrida (vector + lexical + RRF)", value: "hybrid" },
          { label: "Somente vetorial", value: "vector-only" },
          { label: "Somente lexical", value: "lexical-only" },
        ],
      },
      {
        scope: "application",
        key: "retrievalVectorTopK",
        label: "Candidatos vetoriais",
        description: "Quantidade inicial de resultados pgvector antes da fusão.",
        kind: "number",
        min: 1,
        max: 200,
      },
      {
        scope: "application",
        key: "retrievalLexicalTopK",
        label: "Candidatos lexicais",
        description: "Quantidade inicial do PostgreSQL Full Text Search.",
        kind: "number",
        min: 1,
        max: 200,
      },
      {
        scope: "application",
        key: "retrievalRrfK",
        label: "RRF k",
        description: "Constante de suavização da Reciprocal Rank Fusion.",
        kind: "number",
        min: 1,
        max: 1000,
      },
      {
        scope: "application",
        key: "retrievalCandidatePoolTopK",
        label: "Pool híbrido",
        description: "Tamanho do pool único passado às próximas etapas.",
        kind: "number",
        min: 1,
        max: 300,
      },
      {
        scope: "application",
        key: "retrievalRerankerEnabled",
        label: "Ativar cross-encoder local",
        description: "Filtra e reorganiza o pool com o modelo local selecionado. Baixe o modelo antes de ativar.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "retrievalRerankerModel",
        label: "Modelo de reranking",
        description: "Ambos são executados localmente e não usam API paga.",
        kind: "select",
        options: [
          { label: "Ettin Reranker 17M", value: "cross-encoder/ettin-reranker-17m-v1" },
          { label: "Qwen3 Reranker 0.6B · Q8_0", value: "qwen3-reranker-0.6b-q8_0" },
        ],
      },
      {
        scope: "application",
        key: "retrievalRerankerTopK",
        label: "Candidatos do cross-encoder",
        description: "Limita quantos candidatos do pool serão avaliados pelo modelo.",
        kind: "number",
        min: 1,
        max: 300,
      },
      {
        scope: "application",
        key: "retrievalRerankerThreshold",
        label: "Threshold de relevância",
        description: "Score mínimo na escala bruta do modelo selecionado. Ettin e Qwen têm escalas diferentes; ajuste pelos traces ou comparação abaixo.",
        kind: "number",
        min: -100,
        max: 100,
        step: "0.1",
      },
      {
        scope: "application",
        key: "retrievalDeduplicationEnabled",
        label: "Deduplicar resultados",
        description: "Remove chunks com sobreposição excessiva de conteúdo ou faixa de mensagens idêntica.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "retrievalDeduplicationThreshold",
        label: "Limiar de deduplicação",
        description: "Jaccard de tokens entre 0 e 1; valores maiores removem somente pares mais parecidos.",
        kind: "number",
        min: 0,
        max: 1,
        step: "0.01",
      },
    ],
  },
  {
    id: "temporal-consolidation",
    eyebrow: "Retrieval",
    title: "Consolidação Temporal",
    description: "Analisa mudanças no histórico em segundo plano e enriquece o Conversation Retrieval com relações temporais.",
    icon: RefreshCw,
    fields: [
      {
        scope: "application",
        key: "temporalConsolidationEnabled",
        label: "Ativar Consolidação Temporal",
        description: "Controla a execução agendada e o enriquecimento temporal da busca. Relações já registradas são preservadas ao desativar.",
        kind: "checkbox",
      },
      {
        scope: "application",
        key: "temporalConsolidationDefaultCombo",
        label: "Combo padrão",
        description: "Combo do OmniRoute para a execução agendada dentro da janela. Configure um combo local quando quiser priorizar custo.",
        kind: "text",
        nullable: true,
        placeholder: "Selecione ou informe um combo configurado",
      },
      {
        scope: "application",
        key: "temporalConsolidationFallbackCombo",
        label: "Combo de fallback",
        description: "Usado após falhas elegíveis e por padrão em execuções manuais fora da janela. Deixe vazio para exigir configuração antes do teste fora da janela.",
        kind: "text",
        nullable: true,
        placeholder: "Selecione ou informe um combo configurado",
      },
      {
        scope: "application",
        key: "temporalConsolidationStartTime",
        label: "Início da janela",
        description: "Horário local no fuso da aplicação para iniciar o processamento agendado.",
        kind: "time",
      },
      {
        scope: "application",
        key: "temporalConsolidationEndTime",
        label: "Fim da janela",
        description: "Horário local no fuso da aplicação para encerrar o processamento agendado.",
        kind: "time",
      },
    ],
  },
  {
    id: "conversation-context",
    eyebrow: "Conversation",
    title: "Contexto imediato",
    description: "Janela cronológica enviada para cada nova iteração da conversa.",
    icon: Layers3,
    fields: [
      {
        scope: "application",
        key: "immediateContextMaxTokens",
        label: "Máximo de tokens do contexto imediato",
        description: "Quando o histórico ultrapassa este limite, somente a sequência mais recente de mensagens segue para a iteração.",
        kind: "number",
        min: 1,
        max: 200000,
      },
    ],
  },
  {
    id: "conversation-chunks",
    eyebrow: "Conversation",
    title: "Chunks e embeddings",
    description: "Parâmetros de segmentação, overlap e atualização dos embeddings históricos.",
    icon: Layers3,
    fields: [
      {
        scope: "conversationChunks",
        key: "maxTokens",
        label: "Máximo de tokens por chunk",
        description: "Limite lógico para fechar um chunk; o padrão atual é 4000.",
        kind: "number",
        min: 1,
        max: 100000,
      },
      {
        scope: "conversationChunks",
        key: "overlapTokens",
        label: "Tokens de overlap",
        description: "Quantidade aproximada reaproveitada do chunk anterior.",
        kind: "number",
        min: 0,
        max: 100000,
      },
      {
        scope: "conversationChunks",
        key: "embeddingRefreshTokens",
        label: "Tokens para recalcular embedding",
        description: "Quanto de tail nova precisa acumular antes de atualizar o embedding aberto.",
        kind: "number",
        min: 1,
        max: 100000,
      },
      {
        scope: "conversationChunks",
        key: "embeddingModel",
        label: "Modelo de embedding",
        description: "Modelo Ollama usado para representar semanticamente cada chunk.",
        kind: "text",
        placeholder: "qwen3-embedding:0.6b",
      },
      {
        scope: "conversationChunks",
        key: "embeddingDimensions",
        label: "Dimensões do embedding",
        description: "Fixo em 1024 porque o banco usa vector(1024).",
        kind: "number",
        readOnly: true,
      },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse>();
  const [draft, setDraft] = useState<SettingsResponse>();
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(configSections.map((section) => [section.id, true])),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [rerankerModels, setRerankerModels] = useState<RerankerModelsResponse>();
  const [downloadingModel, setDownloadingModel] = useState<RerankerModel>();
  const [comparisonQuery, setComparisonQuery] = useState("");
  const [comparisonDocuments, setComparisonDocuments] = useState("");
  const [comparison, setComparison] = useState<RerankerComparisonResponse>();
  const [isComparing, setIsComparing] = useState(false);
  const [temporalRefreshToken, setTemporalRefreshToken] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    const loadInitialSettings = async () => {
      try {
        const [response, models] = await Promise.all([
          getSettings(),
          getRerankerModels().catch(() => undefined),
        ]);

        if (isCurrent) {
          setSettings(response);
          setDraft(response);
          setRerankerModels(models);
          setError(undefined);
        }
      } catch (requestError) {
        if (isCurrent) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Não foi possível carregar as configurações.",
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialSettings();

    return () => {
      isCurrent = false;
    };
  }, []);

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const selectedTtsEngine = draft?.application.voiceTtsEngine ?? settings?.application.voiceTtsEngine;
  const visibleSections = useMemo(
    () =>
      configSections
        .map((section) => ({
          ...section,
          fields: section.fields.filter((field) => {
            if (field.key === "fishAudioReferenceId" && selectedTtsEngine !== "fish") {
              return false;
            }
            if (!normalizedSearch) {
              return true;
            }

            return [
              section.eyebrow,
              section.title,
              section.description,
              field.key,
              field.label,
              field.description,
            ]
              .join(" ")
              .toLocaleLowerCase("pt-BR")
              .includes(normalizedSearch);
          }),
        }))
        .filter((section) => section.fields.length > 0),
    [normalizedSearch, selectedTtsEngine],
  );

  function updateValue(
    field: ConfigField,
    value: string | number | boolean | null,
  ) {
    setSaved(false);
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [field.scope]: {
          ...current[field.scope],
          [field.key]: value,
        },
      };
    });
  }

  function valueFor(field: ConfigField): unknown {
    return draft?.[field.scope][field.key as keyof (SettingsResponse[typeof field.scope])] ?? null;
  }

  async function saveSettings() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setError(undefined);
    setSaved(false);

    try {
      const response = await updateSettings(draft);
      setSettings(response);
      setDraft(response);
      setSaved(true);
      setTemporalRefreshToken((current) => current + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível salvar as configurações.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshRerankerModels() {
    try {
      setRerankerModels(await getRerankerModels());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível consultar os modelos locais.");
    }
  }

  async function downloadSelectedModel() {
    const model = draft?.application.retrievalRerankerModel;
    if (!model) return;
    setDownloadingModel(model);
    setError(undefined);
    try {
      await downloadRerankerModel(model);
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const status = await getRerankerModels();
        setRerankerModels(status);
        const selected = status.models.find((entry) => entry.id === model);
        if (selected?.installed || selected?.status === "failed") {
          if (selected.status === "failed") {
            setError(selected.error ?? "O download do modelo falhou.");
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      setError("O download ainda está em andamento. Atualize o estado do modelo em alguns instantes.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar o download do modelo.");
    } finally {
      setDownloadingModel(undefined);
    }
  }

  async function runRerankerComparison() {
    const documents = comparisonDocuments
      .split("\n")
      .map((document) => document.trim())
      .filter(Boolean);
    if (!comparisonQuery.trim() || documents.length === 0) {
      setError("Informe uma query e pelo menos um documento, um por linha.");
      return;
    }
    setError(undefined);
    setComparison(undefined);
    setIsComparing(true);
    try {
      const response = await compareRerankers({
        query: comparisonQuery.trim(),
        documents,
        threshold: draft?.application.retrievalRerankerThreshold ?? 0.05,
      });
      setComparison(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível comparar os rerankers locais.");
    } finally {
      setIsComparing(false);
    }
  }

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(draft);
  const temporalKeys = [
    "appTimezone",
    "temporalConsolidationEnabled",
    "temporalConsolidationDefaultCombo",
    "temporalConsolidationFallbackCombo",
    "temporalConsolidationStartTime",
    "temporalConsolidationEndTime",
  ] as const;
  const temporalPendingChanges = temporalKeys.some(
    (key) => settings?.application[key] !== draft?.application[key],
  );
  const retrievalSettings = draft?.application;
  const selectedRerankerStatus = rerankerModels?.models.find(
    (model) => model.id === retrievalSettings?.retrievalRerankerModel,
  );

  return (
    <main className="h-dvh overflow-y-auto px-4 py-4 sm:px-7 sm:py-7">
      <div className="pointer-events-none fixed -left-32 top-4 size-96 rounded-full bg-indigo-200/35 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-24 right-0 size-[30rem] rounded-full bg-violet-200/35 blur-3xl" />

      <div className="relative mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-500/20 transition hover:-translate-y-px hover:bg-slate-700"
              href="/"
              aria-label="Voltar para a conversa"
            >
              <Sparkles className="size-4" />
            </Link>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Luna · control center
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                Configurações da aplicação
              </h1>
            </div>
          </div>
          <Link
            className="rounded-xl border border-white/80 bg-white/65 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-px hover:bg-white"
            href="/"
          >
            Voltar para a conversa
          </Link>
        </header>

        <section className="glass mb-6 rounded-[1.7rem] p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Settings2 className="size-4 text-indigo-600" />
                Runtime configurável
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Ajuste parâmetros que ficam persistidos no Postgres. As alterações passam a valer nas próximas operações sem editar arquivos de ambiente.
              </p>
            </div>
            <div className="flex w-full max-w-xl items-center gap-2 rounded-2xl border border-white/90 bg-white/70 px-3 py-2.5 shadow-sm focus-within:border-indigo-200 focus-within:ring-4 focus-within:ring-indigo-100/60">
              <Search className="size-4 shrink-0 text-slate-400" />
              <input
                aria-label="Pesquisar configuração"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar por configuração, categoria ou descrição..."
                value={search}
              />
              {search ? (
                <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-600">
                  filtro ativo
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="glass mb-6 rounded-[1.7rem] border border-indigo-100/80 p-5 shadow-lg shadow-indigo-950/[0.03] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">Pipeline observável</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Retrieval Engine</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Configure o que a conversation_retrieval executa e abra um trace para inspecionar entrada, candidatos de cada etapa, scores, descartes e resultado devolvido à tool.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-500" href="#retrieval-engine">Configurar pipeline</a>
              <Link className="rounded-xl border border-white/80 bg-white/70 px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white" href="/observability">Abrir observabilidade</Link>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SmallSetting label="Estratégia" value={retrievalSettings?.retrievalStrategy ?? "Carregando"} />
            <SmallSetting label="Pool vector / lexical / fusão" value={retrievalSettings ? `${retrievalSettings.retrievalVectorTopK} / ${retrievalSettings.retrievalLexicalTopK} / ${retrievalSettings.retrievalCandidatePoolTopK}` : "—"} />
            <SmallSetting label="Reranker" value={retrievalSettings?.retrievalRerankerEnabled ? `Ativo · ${retrievalSettings.retrievalRerankerModel}` : "Desativado"} />
            <SmallSetting label="Modelo local" value={selectedRerankerStatus ? `${selectedRerankerStatus.status}${selectedRerankerStatus.bytes ? ` · ${(selectedRerankerStatus.bytes / 1024 / 1024).toFixed(0)} MB` : ""}` : "Status indisponível"} />
            <SmallSetting label="Conversation Evidence" value={retrievalSettings?.conversationEvidenceEnabled ? "Ativo" : "Desativado"} />
          </div>
        </section>

        <section className="glass mb-6 rounded-[1.7rem] border border-indigo-100/80 p-5 shadow-lg shadow-indigo-950/[0.03] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">Pipeline observável</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Pesquisa na Web</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Configure o combo do Search Orchestrator e acompanhe planner, buscas, seleção de fontes, extração, evidências e verificação em cada execução.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-500" href="#web-research">Configurar pesquisa</a>
              <Link className="rounded-xl border border-white/80 bg-white/70 px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white" href="/observability?view=research">Ver execuções</Link>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SmallSetting label="Estado" value={retrievalSettings?.researchEnabled == null ? "Indisponível" : retrievalSettings.researchEnabled ? "Ativada" : "Desativada"} />
            <SmallSetting label="Planner combo" value={retrievalSettings?.researchSearchOrchestratorCombo || "Indisponível"} />
            <SmallSetting label="Modo e limites" value={retrievalSettings?.researchDefaultMode && retrievalSettings.researchMaxSources && retrievalSettings.researchMaxRounds ? `${retrievalSettings.researchDefaultMode} · ${retrievalSettings.researchMaxSources} fontes · ${retrievalSettings.researchMaxRounds} rodadas` : "Indisponível"} />
            <SmallSetting label="Busca e extração" value={retrievalSettings?.researchSearchProvider && retrievalSettings.researchExtractionProvider ? `${retrievalSettings.researchSearchProvider} · ${retrievalSettings.researchExtractionProvider}` : "Indisponível"} />
          </div>
        </section>

        {error ? (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="glass sticky top-6 rounded-[1.5rem] p-3">
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Categorias
              </p>
              <nav className="space-y-1">
                {configSections.map((section) => {
                  const Icon = section.icon;

                  return (
                    <a
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-slate-600 transition hover:bg-white/80 hover:text-slate-950"
                      href={`#${section.id}`}
                      key={section.id}
                    >
                      <Icon className="size-3.5 text-indigo-500" />
                      <span className="min-w-0 truncate">{section.title}</span>
                    </a>
                  );
                })}
              </nav>
              <div className="mt-4 border-t border-white/70 px-3 pt-4 text-[11px] leading-5 text-slate-400">
                <p className="flex items-center gap-1.5 font-medium text-slate-500">
                  <Database className="size-3" />
                  Fonte: PostgreSQL
                </p>
                <p className="mt-1">Env serve apenas como bootstrap inicial.</p>
              </div>
            </div>
          </aside>

          <div className="space-y-4">
            {isLoading ? (
              <div className="glass flex min-h-64 items-center justify-center gap-3 rounded-[1.7rem] text-sm text-slate-500">
                <LoaderCircle className="size-4 animate-spin" />
                Carregando configurações
              </div>
            ) : null}

            {!isLoading && visibleSections.length === 0 ? (
              <div className="glass rounded-[1.7rem] px-6 py-14 text-center">
                <Search className="mx-auto size-6 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-slate-700">Nenhuma configuração encontrada</p>
                <p className="mt-1 text-xs text-slate-500">Tente pesquisar por combo, tokens, embedding ou retrieval.</p>
              </div>
            ) : null}

            {!isLoading
              ? visibleSections.map((section) => {
                  const Icon = section.icon;
                  const isOpen = Boolean(openSections[section.id]) || Boolean(normalizedSearch);

                  return (
                    <section className="glass scroll-mt-6 overflow-hidden rounded-[1.7rem]" id={section.id} key={section.id}>
                      <button
                        className="flex w-full items-center gap-4 px-5 py-5 text-left transition hover:bg-white/30 sm:px-7"
                        onClick={() =>
                          setOpenSections((current) => ({
                            ...current,
                            [section.id]: !current[section.id],
                          }))
                        }
                        type="button"
                      >
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                          <Icon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
                            {section.eyebrow}
                          </p>
                          <h2 className="mt-1 text-base font-semibold text-slate-950">{section.title}</h2>
                          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{section.description}</p>
                        </div>
                        <ChevronDown className={`size-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>

                      {isOpen ? (
                        <div className="grid gap-3 border-t border-white/70 p-4 sm:grid-cols-2 sm:p-6">
                          {section.fields.map((field) => (
                            <ConfigField
                              field={field}
                              key={`${field.scope}.${field.key}`}
                              value={valueFor(field)}
                              comboSuggestions={[
                                "local-reasoning",
                                "paid-general",
                                settings?.application.llmCombo,
                                settings?.application.orchestratorCombo,
                                settings?.application.researchSearchOrchestratorCombo,
                                settings?.application.temporalConsolidationDefaultCombo,
                                settings?.application.temporalConsolidationFallbackCombo,
                              ].filter((combo): combo is string => Boolean(combo))}
                              onChange={(value) => {
                                updateValue(field, value);
                                if (field.key === "retrievalRerankerModel") {
                                  updateValue(
                                    {
                                      scope: "application",
                                      key: "retrievalRerankerThreshold",
                                      label: "Threshold de relevância",
                                      description: "Score mínimo do modelo ativo.",
                                      kind: "number",
                                    },
                                    value === "qwen3-reranker-0.6b-q8_0" ? 0.05 : 8,
                                  );
                                }
                              }}
                            />
                          ))}
                          {section.id === "retrieval-engine" ? (
                            <div className="space-y-4 sm:col-span-2">
                              <RerankerModelPanel
                                models={rerankerModels}
                                selectedModel={draft?.application.retrievalRerankerModel}
                                downloadingModel={downloadingModel}
                                onRefresh={() => void refreshRerankerModels()}
                                onDownload={() => void downloadSelectedModel()}
                              />
                              <RerankerComparisonPanel
                                query={comparisonQuery}
                                documents={comparisonDocuments}
                                result={comparison}
                                isComparing={isComparing}
                                onQueryChange={setComparisonQuery}
                                onDocumentsChange={setComparisonDocuments}
                                onCompare={() => void runRerankerComparison()}
                              />
                            </div>
                          ) : null}
                          {section.id === "voice" ? (
                            <>
                              <div className="sm:col-span-2"><WakeModelStatusBadge /></div>
                              <VoiceProfilesSettings engine={draft?.application.voiceTtsEngine ?? "kokoro"} selectedProfileId={draft?.application.voiceProfileId ?? settings?.application.voiceProfileId ?? "pf_dora"} onSelected={(id) => {
                                setSettings((current) => current ? { ...current, application: { ...current.application, voiceProfileId: id } } : current);
                                setDraft((current) => current ? { ...current, application: { ...current.application, voiceProfileId: id } } : current);
                              }} />
                              <WakeTrainingSettings />
                            </>
                          ) : null}
                          {section.id === "temporal-consolidation" ? (
                            <TemporalConsolidationPanel
                              enabled={settings?.application.temporalConsolidationEnabled === true && draft?.application.temporalConsolidationEnabled === true}
                              pendingChanges={temporalPendingChanges}
                              refreshToken={temporalRefreshToken}
                              timeZone={settings?.application.appTimezone ?? "America/Sao_Paulo"}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              : null}

            {!isLoading && draft ? (
              <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/90 bg-slate-950/95 px-4 py-3 text-white shadow-2xl shadow-slate-900/20 backdrop-blur-xl sm:px-5">
                <div className="flex items-center gap-2 text-xs">
                  <SlidersHorizontal className="size-4 text-indigo-300" />
                  {saved ? "Configurações salvas no Postgres." : hasChanges ? "Existem alterações não salvas." : "Configurações sincronizadas."}
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSaving || !hasChanges}
                  onClick={() => void saveSettings()}
                  type="button"
                >
                  {isSaving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  {isSaving ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function TemporalConsolidationPanel({
  enabled,
  pendingChanges,
  refreshToken,
  timeZone,
}: {
  enabled: boolean;
  pendingChanges: boolean;
  refreshToken: number;
  timeZone: string;
}) {
  const [status, setStatus] = useState<TemporalConsolidationStatus>();
  const [runs, setRuns] = useState<TemporalConsolidationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<TemporalConsolidationRunDetails>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (runId?: string) => {
    const [currentStatus, recentRuns, runDetails] = await Promise.all([
      getTemporalConsolidationStatus(),
      getTemporalConsolidationRuns(),
      runId ? getTemporalConsolidationRun(runId) : Promise.resolve(undefined),
    ]);
    setStatus(currentStatus);
    setRuns(recentRuns);
    if (runDetails) setSelectedRun(runDetails);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [currentStatus, recentRuns] = await Promise.all([
          getTemporalConsolidationStatus(),
          getTemporalConsolidationRuns(),
        ]);
        if (active) {
          setStatus(currentStatus);
          setRuns(recentRuns);
          setError(undefined);
        }
      } catch (requestError) {
        if (active) setError(temporalErrorMessage(requestError));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [refreshToken]);

  const shouldPoll = status?.running === true || selectedRun?.status === "running";

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      void refresh(selectedRunId).catch((requestError: unknown) => setError(temporalErrorMessage(requestError)));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, selectedRunId, shouldPoll]);

  async function execute(dryRun: boolean) {
    setIsSubmitting(true);
    setError(undefined);
    setSelectedRun(undefined);
    setSelectedRunId(undefined);
    try {
      const response = await runTemporalConsolidation(dryRun);
      setSelectedRun(response.run);
      setSelectedRunId(response.run.id);
      await refresh(response.run.id);
    } catch (requestError) {
      setError(temporalErrorMessage(requestError));
      try { await refresh(); } catch { /* Keep the actionable run error visible. */ }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function showRun(id: string) {
    setError(undefined);
    try {
      const details = await getTemporalConsolidationRun(id);
      setSelectedRun(details);
      setSelectedRunId(id);
    } catch (requestError) {
      setError(temporalErrorMessage(requestError));
    }
  }

  const actionDisabled = !enabled || pendingChanges || isLoading || isSubmitting || status?.enabled === false || status?.running === true;
  const latestRun = status?.latestRun ?? runs[0];
  const activeRun = status?.running && status.activeRun?.status === "running"
    ? status.activeRun
    : selectedRun?.status === "running" ? selectedRun : undefined;
  const progressRun = activeRun ?? selectedRun;

  return (
    <div className="space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/45 p-4 sm:col-span-2 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Execução e status</h3>
          <p className="mt-1 text-xs text-slate-600">Fuso horário: {timeZone}. Execuções manuais fora da janela usam o combo de fallback configurado.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status?.running ? "bg-amber-100 text-amber-800" : enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
          {status?.running ? "Em execução" : enabled ? "Ativa" : "Desativada"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={actionDisabled} onClick={() => void execute(false)} type="button">
          {isSubmitting ? "Iniciando..." : "Executar agora"}
        </button>
        <button className="rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={actionDisabled} onClick={() => void execute(true)} type="button">
          Dry Run
        </button>
        <button className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isLoading || isSubmitting} onClick={() => void refresh(selectedRunId).catch((requestError: unknown) => setError(temporalErrorMessage(requestError)))} type="button">
          Atualizar status
        </button>
      </div>
      {!enabled ? <p className="text-xs text-slate-600">Ative a Consolidação Temporal e salve para executar.</p> : null}
      {pendingChanges ? <p className="text-xs text-amber-700">Salve as alterações desta seção antes de executar.</p> : null}
      {isLoading ? <p className="text-xs text-slate-500">Carregando status...</p> : null}
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p> : null}

      {progressRun ? <TemporalRunProgress key={`${progressRun.id}:${progressRun.progressUpdatedAt ?? progressRun.startedAt}`} run={progressRun} /> : null}

      {selectedRun ? (
        <div className="rounded-xl border border-indigo-200 bg-white/80 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">{selectedRun.dryRun ? "Dry Run" : "Execução manual"} · {temporalRunStatusLabel(selectedRun.status)}</p>
          <p className="mt-1">ID: {selectedRun.id} · Combo: {selectedRun.actualCombo ?? "Aguardando seleção"}</p>
          <p className="mt-1">Propostas: {selectedRun.relationsProposed ?? 0} · Criadas: {selectedRun.relationsCreated ?? 0} · Rejeitadas: {selectedRun.relationsRejected ?? 0}{selectedRun.hasMore ? " · Há mais mensagens pendentes" : ""}</p>
          {selectedRun.proposed?.length ? (
            <div className="mt-3 space-y-2">
              <p className="font-semibold text-slate-800">Relações propostas</p>
              {selectedRun.proposed.map((item, index) => (
                <div className="rounded-lg bg-indigo-50 px-3 py-2" key={`${item.predecessorMessageId}-${item.successorMessageId}-${index}`}>
                  <p className="font-medium">{item.type} · {item.subject}: {item.oldValue} → {item.newValue}</p>
                  <p className="mt-1 text-slate-600">{item.reason}</p>
                  <p className="mt-1 text-slate-500">Anterior: {item.predecessorExcerpt} · Posterior: {item.successorExcerpt}</p>
                </div>
              ))}
            </div>
          ) : null}
          {selectedRun.rejected?.length ? (
            <div className="mt-3 space-y-1">
              <p className="font-semibold text-slate-800">Relações rejeitadas</p>
              {selectedRun.rejected.map((item, index) => <p key={`${item.successorMessageId}-${index}`}>{item.successorMessageId}: {item.reason}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <h4 className="text-xs font-semibold text-slate-800">Última execução</h4>
        {latestRun ? <TemporalRunSummary onSelect={() => void showRun(latestRun.id)} run={latestRun} timeZone={timeZone} /> : <p className="mt-2 text-xs text-slate-500">Nenhuma execução registrada.</p>}
      </div>
      {runs.length > 1 ? (
        <details className="rounded-xl border border-white/80 bg-white/55 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">Execuções anteriores ({runs.length - 1})</summary>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {runs.filter((run) => run.id !== latestRun?.id).map((run) => <TemporalRunSummary key={run.id} onSelect={() => void showRun(run.id)} run={run} timeZone={timeZone} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const TEMPORAL_RUN_PHASES = [
  ["starting", "Iniciando"],
  ["loading_messages", "Carregando mensagens"],
  ["detecting_candidates", "Detectando mudanças"],
  ["extracting_change", "Extraindo mudança"],
  ["retrieving_history", "Buscando histórico"],
  ["validating_antecedent", "Validando antecedente"],
  ["persisting_relation", "Gravando relação"],
  ["finalizing", "Finalizando"],
] as const;

function TemporalRunProgress({ run }: { run: TemporalConsolidationRun }) {
  const [localNow, setLocalNow] = useState(() => Date.now());
  const [clockAnchor] = useState(() => ({
    serverMs: Date.parse(run.progressUpdatedAt ?? run.startedAt),
    clientMs: Date.now(),
  }));

  useEffect(() => {
    if (run.status !== "running") return;
    const timer = window.setInterval(() => setLocalNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [run.status]);

  const serverNow = Number.isFinite(clockAnchor.serverMs)
    ? clockAnchor.serverMs + Math.max(0, localNow - clockAnchor.clientMs)
    : localNow;
  const currentPhase = run.currentPhase ?? null;
  const durations = run.phaseDurationsMs ?? {};
  const phaseStartedAt = run.currentPhaseStartedAt ? Date.parse(run.currentPhaseStartedAt) : NaN;
  const currentPhaseElapsed = currentPhase && Number.isFinite(phaseStartedAt)
    ? Math.max(0, serverNow - phaseStartedAt)
    : 0;
  const totalMs = run.status === "running"
    ? Math.max(0, serverNow - Date.parse(run.startedAt))
    : run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : 0;
  const currentIndex = TEMPORAL_RUN_PHASES.findIndex(([phase]) => phase === currentPhase);

  return (
    <div className="rounded-xl border border-indigo-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">Progresso da execução · {run.id.slice(0, 8)}</p>
        <span className="tabular-nums text-slate-500">Tempo total {formatElapsedMs(totalMs)}</span>
      </div>
      <p className="mt-1 text-slate-600">
        Mensagens {run.messagesScanned ?? 0} · Chunks {run.chunksScanned ?? 0} · Candidatos {run.candidatesDetected ?? 0} · Chamadas LLM {run.llmCalls ?? 0} · Buscas históricas {run.historicalRetrievalCalls ?? 0}
      </p>
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {TEMPORAL_RUN_PHASES.map(([phase, label], index) => {
          const elapsed = Number(durations[phase] ?? 0) + (phase === currentPhase ? currentPhaseElapsed : 0);
          const isCurrent = phase === currentPhase && run.status === "running";
          const wasReached = currentIndex >= 0 ? index <= currentIndex : elapsed > 0;
          return (
            <div className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${isCurrent ? "bg-indigo-100 text-indigo-900" : wasReached ? "bg-slate-50 text-slate-700" : "text-slate-400"}`} key={phase}>
              <span className="flex min-w-0 items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${isCurrent ? "animate-pulse bg-indigo-600" : wasReached ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className="truncate">{label}{isCurrent ? " · atual" : ""}</span>
              </span>
              <span className="shrink-0 tabular-nums">{elapsed > 0 ? formatElapsedMs(elapsed) : "—"}</span>
            </div>
          );
        })}
      </div>
      {run.status !== "running" && Object.keys(durations).length === 0 ? <p className="mt-2 text-[10px] text-slate-500">Esta execução não registrou tempos por fase; o acompanhamento detalhado vale para novas execuções.</p> : null}
      <p className="mt-2 text-[10px] text-slate-500">Os tempos das fases são exclusivos e acumulados. O tempo de LLM está contido nas fases de extração e validação.</p>
    </div>
  );
}

function formatElapsedMs(value: number): string {
  const totalSeconds = Math.floor(Math.max(0, value) / 1000);
  if (totalSeconds < 1) return `${Math.round(Math.max(0, value))} ms`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function TemporalRunSummary({ run, timeZone, onSelect }: { run: TemporalConsolidationRun; timeZone: string; onSelect: () => void }) {
  const outsideWindow = run.fallbackReason === "manual_outside_window";
  return (
    <div className="mt-2 rounded-xl border border-white/80 bg-white/75 p-3 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{run.trigger === "scheduled" ? "Agendada" : "Manual"}{run.dryRun ? " · Dry Run" : ""}</span>
        <span>· {temporalRunStatusLabel(run.status)}</span>
        <span>· {formatTemporalDateTime(run.startedAt, timeZone)}</span>
      </div>
      <p className="mt-1">Combo usado: {run.actualCombo ?? "Nenhum"}{run.model ? ` · Modelo: ${run.model}` : ""}</p>
      {outsideWindow ? <p className="mt-1 font-medium text-amber-700">Fora da janela · fallback escolhido para execução manual</p> : run.fallbackUsed ? <p className="mt-1 font-medium text-amber-700">Fallback usado: {run.fallbackReason ?? "falha do combo padrão"}</p> : null}
      <p className="mt-1">Mensagens: {run.messagesScanned ?? 0} · Candidatos: {run.candidatesDetected ?? 0} · Chamadas LLM: {run.llmCalls ?? 0}</p>
      <p className="mt-1">Propostas: {run.relationsProposed ?? 0} · Criadas: {run.relationsCreated ?? 0} · Rejeitadas: {run.relationsRejected ?? 0} · Ignoradas: {run.relationsSkipped ?? 0}</p>
      {run.errorMessage ? <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-700">Erro: {run.errorMessage}</p> : null}
      <button className="mt-2 font-semibold text-indigo-700 hover:text-indigo-500" onClick={onSelect} type="button">Ver detalhes</button>
    </div>
  );
}

function temporalRunStatusLabel(status: string): string {
  return ({ running: "Em execução", completed: "Concluída", cancelled: "Cancelada", failed: "Falhou" } as Record<string, string>)[status] ?? status;
}

function formatTemporalDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(date);
  } catch {
    return date.toISOString();
  }
}

function temporalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível consultar ou executar a Consolidação Temporal.";
}

function ConfigField({
  field,
  value,
  comboSuggestions,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  comboSuggestions?: string[];
  onChange: (value: string | number | boolean | null) => void;
}) {
  const inputValue = value === null || value === undefined ? "" : String(value);
  const comboListId = (field.key.startsWith("temporalConsolidation") || field.key.startsWith("research")) && field.key.endsWith("Combo")
    ? `${field.key}-suggestions`
    : undefined;

  if (field.kind === "checkbox") {
    return (
      <label className="flex min-h-28 cursor-pointer items-start gap-3 rounded-2xl border border-white/80 bg-white/48 p-4 transition hover:bg-white/72">
        <input
          checked={value === true}
          className="mt-1 size-4 accent-indigo-600"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block text-sm font-semibold text-slate-800">{field.label}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">{field.description}</span>
        </span>
      </label>
    );
  }

  if (field.kind === "select") {
    return (
      <label className="rounded-2xl border border-white/80 bg-white/48 p-4">
        <span className="block text-sm font-semibold text-slate-800">{field.label}</span>
        <span className="mt-1 block min-h-10 text-xs leading-5 text-slate-500">{field.description}</span>
        <select
          className="mt-3 h-10 w-full rounded-xl border border-slate-200/80 bg-white/70 px-3 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/70"
          onChange={(event) => onChange(event.target.value)}
          value={inputValue}
        >
          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }

  return (
    <label className="rounded-2xl border border-white/80 bg-white/48 p-4 transition focus-within:border-indigo-200 focus-within:bg-white/72">
      <span className="block text-sm font-semibold text-slate-800">{field.label}</span>
      <span className="mt-1 block min-h-10 text-xs leading-5 text-slate-500">{field.description}</span>
      <input
        className="mt-3 h-10 w-full rounded-xl border border-slate-200/80 bg-white/70 px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/70 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        disabled={field.readOnly}
        max={field.max}
        min={field.min}
        list={comboListId}
        onChange={(event) => {
          if (field.kind === "number") {
            onChange(event.target.value === "" ? null : Number(event.target.value));
            return;
          }

          onChange(field.nullable && event.target.value === "" ? null : event.target.value);
        }}
        placeholder={field.placeholder}
        step={field.step}
        type={field.kind}
        value={inputValue}
      />
      {comboListId ? (
        <datalist id={comboListId}>
          {[...new Set(comboSuggestions)].map((combo) => <option key={combo} value={combo} />)}
        </datalist>
      ) : null}
    </label>
  );
}

function SmallSetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/90 bg-white/60 px-3 py-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-slate-800" title={value}>{value}</p>
    </div>
  );
}

function RerankerModelPanel({
  models,
  selectedModel,
  downloadingModel,
  onRefresh,
  onDownload,
}: {
  models?: RerankerModelsResponse;
  selectedModel?: RerankerModel;
  downloadingModel?: RerankerModel;
  onRefresh: () => void;
  onDownload: () => void;
}) {
  const selected = models?.models.find((model) => model.id === selectedModel);
  const statusLabel = selected?.status === "loaded" ? "Carregado na memória"
    : selected?.status === "loading" ? "Carregando"
      : selected?.status === "downloading" ? "Baixando"
        : selected?.status === "failed" ? "Falhou"
          : selected?.installed ? "Instalado, ainda não carregado" : "Precisa de download";
  return (
    <section className="rounded-2xl border border-white/80 bg-white/48 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Modelo local selecionado</h3>
          <p className="mt-1 text-xs text-slate-500">
            {models?.available ? `${statusLabel}${selected?.bytes ? ` · ${(selected.bytes / 1024 / 1024).toFixed(0)} MB` : ""}` : "Serviço local de reranking indisponível"}
          </p>
          {selected?.error ? <p className="mt-1 text-xs text-red-600">{selected.error}</p> : null}
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onRefresh} type="button">
            <RefreshCw className="size-3.5" /> Atualizar estado
          </button>
          <button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={!selectedModel || !models?.available || selected?.installed || downloadingModel === selectedModel} onClick={onDownload} type="button">
            {downloadingModel === selectedModel || selected?.status === "downloading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {selected?.installed ? "Disponível localmente" : "Baixar modelo"}
          </button>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">O download é iniciado sob demanda e fica no volume persistente `luna-v2-reranker-models`.</p>
    </section>
  );
}

function RerankerComparisonPanel({
  query,
  documents,
  result,
  isComparing,
  onQueryChange,
  onDocumentsChange,
  onCompare,
}: {
  query: string;
  documents: string;
  result?: RerankerComparisonResponse;
  isComparing: boolean;
  onQueryChange: (value: string) => void;
  onDocumentsChange: (value: string) => void;
  onCompare: () => void;
}) {
  return (
    <section className="rounded-2xl border border-white/80 bg-white/48 p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Comparar os dois rerankers</h3>
        <p className="mt-1 text-xs text-slate-500">Use a mesma query e um documento por linha. Os dois modelos locais retornam ranking, scores, quantidade acima do threshold e latência.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <textarea className="min-h-20 rounded-xl border border-slate-200 bg-white/80 p-3 text-sm outline-none focus:border-indigo-300" onChange={(event) => onQueryChange(event.target.value)} placeholder="Query" value={query} />
        <textarea className="min-h-20 rounded-xl border border-slate-200 bg-white/80 p-3 text-sm outline-none focus:border-indigo-300" onChange={(event) => onDocumentsChange(event.target.value)} placeholder="Documento 1&#10;Documento 2&#10;Documento 3" value={documents} />
      </div>
      <button className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50" disabled={isComparing} onClick={onCompare} type="button">
        {isComparing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {isComparing ? "Comparando..." : "Executar comparação local"}
      </button>
      {result ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {result.runs.map((run) => (
            <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3" key={run.model}>
              <div className="flex flex-wrap justify-between gap-2 text-xs font-semibold text-slate-700"><span>{run.model}</span><span>{run.latencyMs} ms · {run.aboveThreshold} acima do threshold</span></div>
              <ol className="mt-2 space-y-1 text-[11px] text-slate-600">
                {run.results.map((entry, rank) => <li className="flex justify-between gap-3" key={`${run.model}-${entry.index}`}><span>{rank + 1}. Documento {entry.index + 1}</span><span>{entry.score?.toFixed(4) ?? "—"}</span></li>)}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
