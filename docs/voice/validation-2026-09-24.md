# Validação da camada de voz — 24/09/2026

## Stack e verificações

- `docker compose config -q`: passou.
- API: build passou; 36 suítes e 184 testes passaram.
- Web: lint e build passaram.
- `GET /voice/wake/status`: `modelReady=true`, `validationState=provisional`.
- Ambiente da API: `SPEACHES_STT_LANGUAGE=pt`. O multipart enviado ao
  Speaches também contém `language=pt`, coberto por teste unitário.

## Integração real

Os testes abaixo usaram a stack Docker em execução. A entrada de microfone do
Edge foi um WAV reproduzido como dispositivo simulado, exceto quando indicado.

| Teste | Resultado |
| --- | --- |
| Browser Wake → STT → LLM → Kokoro → reprodução → Idle | Passou. “Qual é a capital da Austrália?” foi transcrito corretamente e Luna respondeu “Canberra.”, com duas mensagens de voz na mesma Conversation e zero erros de página. |
| Texto → Live → texto → outra VoiceSession Live | Passou. As duas sessões e todas as mensagens usaram uma Conversation. O nome fictício “Aurora Sete” permaneceu no contexto após cada troca. |
| “Luna, pesquise por que o preço da memória RAM aumentou.” em uma fala contínua | Passou pelo browser Wake, STT, SearchOrchestrator, ResearchRun concluído, Kokoro, reprodução e retorno a Idle. A sigla saiu como “R&M” na transcrição; a pesquisa ainda foi acionada. |
| Live com várias perguntas | Passou no browser: duas perguntas e duas respostas na mesma Conversation, com retorno ao estado `listening` após a reprodução. |
| Barge-in | Passou no browser: áudio cancelado, evento `voice.barge_in`, buffers limpos e retorno à escuta. |
| Vozes | Prévia, seleção, troca e persistência após reload passaram; pack oficial baixado e pack local `.pt` produziram prévia e TTS. |
| Falhas de UI | Permissão de microfone negada, reconexão de WebSocket e saída/troca rápida de modo mostraram mensagem ou encerraram a sessão corretamente. |
| Gravação de treinamento | Upload WebM pelo browser passou, duração e contagem apareceram nas estatísticas; o arquivo temporário de teste foi removido. |
| URL com sessão de outra Conversation | A UI recusou a sessão, manteve o microfone desativado e não abriu WebSocket. |

O script `apps/api/scripts/smoke-voice-browser.mjs` cobre o teste Wake normal e,
com as variáveis descritas em [voice.md](voice.md), a pesquisa contínua.
`apps/api/scripts/smoke-voice-e2e.mjs` cobre a continuidade de contexto.
`apps/api/scripts/smoke-voice-session-binding.mjs` cobre o vínculo da sessão
recebida por URL. O smoke de continuidade usa um nome fictício como marcador;
uma versão anterior usava a palavra “senha” e o LLM evitou repeti-la por
privacidade, tornando essa asserção inadequada para medir contexto.

## Wake e limites da evidência

O modelo versionado em `services/wakeword/models/luna.onnx` é provisório. Na
avaliação sintética, detectou 49/49 positivos e aceitou 0/39 negativos
próximos no limiar 0,97. Os negativos foram reproduzidos no runtime HTTP em
blocos de 80 ms. Isso não estima a taxa de falsos despertares no ambiente do
usuário nem o recall da voz dele. Veja [PROVISIONAL.md](../../tools/wakeword-training/PROVISIONAL.md).

O teste de 10 minutos de Wake/Idle em Edge registrou 603,945 segundos com a
VoiceSession em Idle: zero `wake.detected`, STT, LLM, TTS ou erros. A fonte era
quase silêncio digital. O coletor não salvou as séries de recursos por uma
falha no seletor do checkpoint final; os eventos persistidos foram recuperados
em `tools/wakeword-training/reports/browser-idle-10min-recovered.json`.

O dispositivo físico Windows `Microfone (ME6S)` foi acessível via ffmpeg e
Edge, mas forneceu silêncio digital (RMS zero no WebAudio). O benchmark de 60
minutos usa uma gravação de treino audível em loop para medir carga e
roteamento, sem contar esse loop como uma hora inédita de ambiente real.

## Benchmark de browser Wake/Idle por 60 minutos

O Edge abriu `/voice`, ativou o microfone WAV simulado e permaneceu 3603,7 s
na mesma VoiceSession. Os checkpoints aos 10, 30 e 60 minutos passaram:
`idle`, WebSocket conectado, zero `voice.wake.detected` e zero eventos de
STT, thinking, TTS, áudio de resposta ou pesquisa. Não houve erros de página.
A sessão foi encerrada e o serviço wake voltou a zero sessões ativas.

| Medida | Resultado |
| --- | ---: |
| CPU do container wake, média / mediana / p95 | 1,30% / 0,15% / 5,83% |
| RAM wake após aquecimento / máxima | 237 / 238,3 MiB |
| CPU da API, média / mediana | 2,42% / 0,41% |
| GPU, utilização mediana / p95 | 0% / 3% |
| UI, FPS / intervalo p95 entre frames | 60 / 16,8 ms |
| Áudio enviado pelo browser no WebSocket | 60,2 MB |
| Tráfego recebido pelo container wake | 75,4 MB |
| Tráfego recebido pelo Speaches | 0 B |

CPU/GPU e rede de `docker stats`/`nvidia-smi` incluem trabalhos de outros
containers e do host. O áudio repetido era um trecho audível de 60 s já usado
no treino; este teste comprova a estabilidade e o roteamento idle do browser,
mas **não** mede FAR em uma hora de ambiente independente. O relatório bruto
fica em `tools/wakeword-training/reports/browser-idle-60min-2026-09-24T17-08-34-802Z.json`
(fora do Git por conter amostras volumosas). Um diagnóstico anterior revelou
que resets recriavam o modelo ONNX e elevavam a RAM; o runtime agora mantém o
modelo carregado durante a sessão e libera-o no encerramento.
Após essa medição, a auditoria acrescentou invalidação de detecções pendentes
em troca de modo/fechamento e verificação do vínculo sessão–Conversation na
URL. O caminho contínuo de Wake/Idle medido não mudou; o browser Wake normal,
o fluxo de pesquisa contínua e a continuidade texto–voz passaram novamente
depois do rebuild.
