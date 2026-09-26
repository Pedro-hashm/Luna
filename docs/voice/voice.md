# Voz da Luna V2

A tela `/voice/:conversationId` usa a mesma `Conversation` da tela de chat.
O navegador envia áudio PCM16 mono a 16 kHz pelo WebSocket
`/voice/ws?sessionId=...`. Uma `VoiceSession` registra modo, estado, eventos e
tempos; somente a transcrição do usuário e a resposta textual da Luna viram
`Message`s da `Conversation`. O histórico e o `conversation_context` continuam
no fluxo existente do `UserAgent`/Orchestrator.

## Serviços

| Serviço | Função | Chamada em Wake/Idle |
| --- | --- | --- |
| `wakeword` | openWakeWord local; modelo `services/wakeword/models/luna.onnx` | Sim, somente para áudio com energia |
| `speaches` | STT `Systran/faster-whisper-small` | Não |
| `kokoro` | TTS `hexgrad/Kokoro-82M` | Não |
| `api` | Gateway, Conversation e eventos | Apenas gateway/wake |
| `web` | AudioWorklet, estados e reprodução | Apenas captura local |

O Kokoro usa CPU para deixar a GPU disponível para o LLM/STT. Seus pesos e os
modelos Speaches ficam em volumes persistentes. A imagem Kokoro local deriva
da imagem existente e só adiciona o carregamento de packs `.pt` guardados no
volume `/voices`; o modelo e a instalação original são reutilizados. O
Compose fixa os digests das imagens Speaches e Kokoro usadas nesta validação.
`WakeWordProvider`, `STTProvider` e `TTSProvider` isolam as APIs específicas.
O STT envia `language=pt` ao Speaches para manter a transcrição em português,
inclusive em falas curtas; `SPEACHES_STT_LANGUAGE` permite ajustar esse código
se necessário. O detector mantém o modelo openWakeWord carregado durante os
resets de uma VoiceSession e o libera ao encerrar a sessão.

O primeiro `docker compose up -d --build` baixa os modelos ausentes. A API
espera Kokoro e Speaches ficarem prontos. O repositório inclui um `luna.onnx`
**provisório** para que Wake funcione em um clone novo. Se o arquivo for
removido, Wake falha fechado e apresenta erro de modelo ausente; Live pode
continuar disponível. O runtime nunca carrega os datasets de treinamento.

O motor opcional Fish Audio usa a API hospedada `POST https://api.fish.audio/v1/tts`
com o modelo `s2.1-pro-free` para developers. A variável `FISH_AUDIO_API_KEY` na
`.env` raiz é encaminhada ao container da API. Selecione **Fish Audio · S2.1 Pro
grátis** em Configurações → Voz e Wake Word e cole o ID em `Fish Audio
reference_id`. Esse identificador fica salvo nas configurações; a chave permanece
no ambiente do container e não é enviada ao navegador.

## Modos e eventos

Wake usa `idle → wake_detected → listening → transcribing → thinking →
speaking → idle`. Live usa `listening → transcribing → thinking → speaking →
listening`. O backend persiste mudanças de estado e eventos em `VoiceSession`.
O frontend apresenta o estado de uma só sessão e permite trocar entre os
modos. O microfone permanece ativo durante TTS para detectar barge-in; a
interrupção cancela a resposta pendente e o áudio em reprodução.
Na tela de voz, o seletor lista os dispositivos de entrada do navegador, permite
usar o padrão do sistema ou fixar um microfone, e troca a captura ao vivo sem
criar outra Conversation. A escolha fica salva neste navegador; a tela de
treinamento usa a mesma seleção. Os nomes podem aparecer somente depois que o
navegador liberar a permissão de microfone.

`outputMode=voice` acrescenta instruções de resposta curta somente ao prompt
final da Luna. Os limites de frases/palavras, velocidade, voz, sensibilidade
e barge-in ficam nas configurações persistentes. Pesquisa continua usando o
Search Orchestrator e suas configurações existentes.
Os campos de palavra e identificador do modelo mostram `Luna` e `luna` como
somente leitura: este deployment carrega `luna.onnx`. A API rejeita valores
diferentes para não sugerir que alterar o texto troca o modelo em execução.
Ao receber uma sessão pela URL `/voice/:conversationId?session=...`, a UI
confirma no backend que a sessão pertence à Conversation aberta.

## Vozes e packs Kokoro

A Luna fixa seu seletor e suas respostas em `pf_dora`. O endpoint da Luna
retorna apenas esse perfil e corrige uma seleção anterior para `pf_dora`. O
serviço Kokoro mantém as vozes próprias do modelo para chamadas diretas.

Packs locais `.pt` são resolvidos apenas dentro de `/voices` por meio de
`pack://<id>`. O fluxo de importação de packs da interface foi removido para
manter o seletor da Luna enxuto.

### Pack pessoal

O fluxo isolado em
[`tools/kokoro-voice-training/README.md`](../../tools/kokoro-voice-training/README.md)
ajusta um pack Kokoro a partir de `Downloads/Luna-Voice.mp3`, usa a GPU
disponível e instala o `.pt` no volume compartilhado. O pack pode ser enviado
diretamente à API do Kokoro com `voice="pack://pf_luna_user_pt"`; ele não aparece
no seletor da Luna, que continua usando somente `pf_dora`.

O afinador Inno Kokoro documenta suporte somente para inglês. Este fluxo grava
o identificador `pf_` para que o modelo use a rota de português brasileiro,
mas o ajuste da identidade a partir de fala em português é experimental.
Consulte o [afinador upstream](https://github.com/remsky/inno-kokoro) e seus
[limites de idioma](https://github.com/remsky/Kokoro-FastAPI/blob/master/docs/inno-tune.md).

## Treinamento e avaliação

O pipeline separado fica em [`tools/wakeword-training/README.md`](../../tools/wakeword-training/README.md).
O profile opcional instala as dependências pesadas sem incorporá-las à API:

```powershell
docker compose --profile wakeword-training build wakeword-training
docker compose --profile wakeword-training run --rm wakeword-training python scripts/generate_synthetic.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/prepare_data.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/train.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/evaluate.py
```

O modelo sintético inicial precisa ser avaliado com gravações reais do usuário
e horas de ambiente real antes de ser tratado como wake word confiável.
`false accepts/hour` é o indicador principal de Wake/Idle. O script
`tools/wakeword-training/scripts/benchmark_browser_idle.mjs` mantém a Voice UI
aberta por 10, 30 ou 60 minutos, mede recursos e verifica se não houve chamadas
de STT, LLM, TTS ou pesquisa. O áudio ambiente padrão desse teste é repetido e
pertence ao treino, portanto não mede falsos despertares em áudio independente.
O `GET /voice/wake/status` informa `modelReady` e `validationState`; a UI
mostra quando o modelo instalado ainda é provisório. O limiar persistido de
0,97 foi calibrado **somente** para o modelo sintético local de teste. Ajuste-o
depois de avaliar sua própria voz e seu ambiente.

## Teste dos providers e da Conversation

Com a stack no ar, o teste curto abaixo gera um WAV no Kokoro e o envia ao
Speaches para transcrição:

```powershell
docker cp scripts/smoke-voice-providers.py luna-v2-speaches:/tmp/smoke-voice-providers.py
docker exec luna-v2-speaches python /tmp/smoke-voice-providers.py
```

`node apps/api/scripts/smoke-voice-e2e.mjs` verifica o caminho
texto → VoiceSession Live → STT → Conversation → Kokoro → texto → outra
VoiceSession Live, com contexto e mensagens persistidos na mesma Conversation.
`node apps/api/scripts/smoke-voice-research.mjs` envia uma pergunta falada de
pesquisa e confirma um `ResearchRun`, duas mensagens de voz e áudio TTS.
`node apps/api/scripts/smoke-voice-browser.mjs` usa o Microsoft Edge no Windows
com microfone WAV simulado para testar `/voice` → Wake → STT → resposta falada;
requer que o pipeline de treinamento tenha criado `data/manifest.jsonl` e
instalado `luna.onnx`.
Para exercitar uma solicitação contínua de pesquisa iniciada por “Luna”, rode:

```powershell
$env:VOICE_BROWSER_QUESTION = 'Pesquise na web por que o preço da memória RAM aumentou.'
$env:VOICE_BROWSER_EXPECT_RESEARCH = '1'
$env:VOICE_BROWSER_CONTINUOUS = '1'
node apps/api/scripts/smoke-voice-browser.mjs
```

Na validação de 24/09/2026, o browser concluiu Wake → STT → ResearchRun →
Kokoro → reprodução → Idle, com duas mensagens persistidas e sem erros de
página. A transcrição da sigla RAM ainda pode variar (“R&M” no teste), embora
o idioma português esteja fixado e a pesquisa tenha sido executada.

Para acesso remoto ao navegador, defina `NEXT_PUBLIC_VOICE_WS_URL` no build do
web com o endereço público `ws://` ou `wss://` da API. Por padrão, a interface
usa o hostname aberto no navegador com a porta `8000`.
