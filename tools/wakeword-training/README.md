# Treinamento da wake word “Luna”

Este diretório prepara um **modelo customizado** do openWakeWord. O runtime em
`services/wakeword` carrega apenas `luna.onnx` e as duas redes de extração de
features do openWakeWord. Ele não instala PyTorch, datasets ou Kokoro.

Um `luna.onnx` gerado apenas com vozes sintéticas é **provisório**. A aprovação
para uso contínuo exige gravações reais de “Luna” e pelo menos uma hora de
áudio ambiente **reservada para teste**. A métrica principal é falsos despertares
por hora no ambiente real.

## Dependências e origem dos modelos

- Python 3.11, `ffmpeg`, e os pacotes em `requirements.txt` para treinar.
- Kokoro já em execução na Luna. `generate_synthetic.py` usa somente
  `POST /v1/audio/speech` (`model`, `input`, `voice`, `speed`, WAV) do serviço;
  não instala outra cópia de Kokoro. Na rede Compose: `http://kokoro:8000`.
  Pelo host, defina `KOKORO_BASE_URL` para a porta local publicada.
- `openwakeword==0.6.0`. `services/wakeword/install_features.py` baixa apenas
  `embedding_model.onnx` e `melspectrogram.onnx` da [release oficial v0.5.1](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1)
  e verifica SHA-256. Faça isso uma vez no ambiente de treinamento.

O [runtime oficial](https://github.com/dscripka/openWakeWord/blob/v0.6.0/openwakeword/model.py)
recebe PCM16 mono 16 kHz, prefere blocos múltiplos de 80 ms e aceita modelos
customizados em `wakeword_models=[".../luna.onnx"]` com
`inference_framework="onnx"`. O classificador deste projeto é treinado sobre
as features `16 × 96` do backbone congelado do próprio openWakeWord.

## Execução pelo Compose

O perfil opcional `wakeword-training` usa imagem própria; seus dados e artefatos
ficam em volumes de diretório separados do build normal da Luna:

```powershell
docker compose --profile wakeword-training build wakeword-training
docker compose --profile wakeword-training run --rm wakeword-training python scripts/generate_synthetic.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/generate_synthetic.py --negative
docker compose --profile wakeword-training run --rm wakeword-training python scripts/prepare_data.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/train.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/evaluate.py
docker compose --profile wakeword-training run --rm wakeword-training python scripts/install_model.py
```

Também pode usar Python 3.11 no host:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt openwakeword==0.6.0
.venv\Scripts\python ..\..\services\wakeword\install_features.py
$env:KOKORO_BASE_URL = "http://127.0.0.1:8002"
.venv\Scripts\python scripts\generate_synthetic.py
```

O serviço de Kokoro pode expor outra porta; ajuste a variável sem baixar
modelos de novo. Edite `config/luna.yml` para vozes, velocidades, quantidade de
amostras, frases negativas e critérios de avaliação. Confirme as vozes em
`GET /v1/audio/voices`. Os positivos sintéticos devem usar somente vozes
marcadas como **Brazilian Portuguese**. A preparação exclui arquivos Kokoro
cuja voz esteja fora da lista configurada e registra cada exclusão em
`reports/prepare.json`; a geração também falha se a API reportar outro idioma.
O upstream recomenda **dezenas de milhares** de positivos para bons modelos;
200 por combinação de voz/velocidade é apenas um início. Aumente e avalie com
áudio real.

## Dados reais

Organize arquivos de áudio assim (WAV, FLAC, MP3, OGG, M4A, Opus ou WebM):

```text
data/positive/             amostras sintéticas ou importadas de “Luna”
data/negative/             fala, música, TV e palavras parecidas sem “Luna”
data/recordings/positive/  sua voz dizendo “Luna”
data/recordings/negative/  sua fala normal e falsos despertares
data/background/           gravação contínua do ambiente real
data/rir/                  respostas de impulso de salas (opcional)
```

Para reservar áudio **nunca usado no treino**, coloque em subpastas `test`:
`data/recordings/positive/test/` e `data/background/test/`. Use `train` para
o restante. A divisão automática é determinística (80/10/10), mas pastas
explícitas evitam vazamento entre sessões. Gere real positivo com distância,
microfones e ruído variados; não use os mesmos takes em treino e teste.

O gravador CLI salva PCM16 mono 16 kHz e pode parar por tempo ou Ctrl+C:

```powershell
.venv\Scripts\python scripts\collect.py --kind positive --split train --seconds 3
.venv\Scripts\python scripts\collect.py --kind negative --split train --seconds 30
.venv\Scripts\python scripts\collect.py --kind background --split test --seconds 3600
```

Grave cada “Luna” isolada em um arquivo positivo. Uma gravação ambiente longa
fica em fluxo no disco, sem acumular a hora inteira na RAM. O Docker não tem
acesso automático ao microfone do Windows; execute `collect.py` no host ou
importe WAVs da UI de treinamento.

Uploads da UI em `data/recordings/positive/` e
`data/recordings/negative/`, inclusive WebM de até 2 minutos para negativos,
são descobertos recursivamente. Um positivo de até
30 segundos é aceito na preparação, mas o trecho com voz precisa caber na
janela de treino de 2 segundos; grave a palavra isolada e silencie o resto.

`prepare_data.py` converte tudo com ffmpeg para mono 16 kHz PCM16, valida
formato e duração, grava `data/manifest.jsonl` e `reports/prepare.json`. Um
arquivo inválido faz o comando falhar com detalhe no relatório. A pasta
`data/prepared` é derivada e pode ser reconstruída.
Gravações reais com apenas silêncio digital (pico de até dois valores PCM)
são omitidas do manifesto e listadas em `quality_warnings`; elas não contam
como teste ambiente nem como exemplos reais de “Luna”.

## Treino, avaliação e instalação

`train.py` pede positivos, negativos e background de treino suficientes.
Ele aplica variações de ganho, ruído, mistura de ambiente e RIR opcional,
treina um classificador pequeno sobre as features oficiais, minera janelas
difíceis **somente de train/validation** em streaming e exporta
`models/luna.onnx`. A saída é validada com `openwakeword.Model`.

`evaluate.py` reproduz o streaming em 80 ms em dados de teste, contabiliza
recall, falsos rejects, falsos accepts, **falsos accepts por hora**, e latência
aproximada. Produz `reports/evaluation.json` e `.md`. A latência usa o fim da
fala estimado por energia, pois não há anotações manuais. Para medir latência
precisa, anote o instante da palavra em cada gravação.

Para avaliar o mesmo verificador pessoal e limiares do gateway, passe
`--verifier --verifier-threshold 0.5`; por exemplo:
`python scripts/evaluate.py --threshold 0.6 --verifier --verifier-threshold 0.5`.
O relatório registra se o verificador estava ativo. A simulação de streaming
também reproduz o pré-roll de 480 ms, o gate RMS e o hangover do serviço.

`install_model.py` só promove o modelo para
`services/wakeword/models/luna.onnx` quando o relatório comprovar os critérios
em `config/luna.yml`: 20 testes positivos reais, ≥1 h de background real,
recall ≥95% e ≤0,5 falsos accepts/hora. Use `--allow-unvalidated` **somente**
para instalar e experimentar um modelo provisório; o script imprime esse
estado. Com o modelo montado, ele chama `POST /reload` no serviço wake e não
exige rebuild do runtime.
O serviço mostra `validationState=provisional` em `/status` até que um
relatório de avaliação do **mesmo SHA-256** prove os critérios reais.

Com o modelo instalado, confira todos os arquivos de teste pelo HTTP real do
serviço, em frames de 80 ms com reset entre arquivos:

```powershell
docker compose --profile wakeword-training run --rm wakeword-training python scripts/smoke_runtime.py --all --threshold 0.97
```

O comando deve listar positivos, negativos próximos, scores e número de
falsos aceites/rejeições. Ele não substitui o teste com voz real.

Um verifier opcional usa pelo menos três “Luna” reais e fala normal do usuário:

```powershell
.venv\Scripts\python scripts\train_verifier.py
.venv\Scripts\python scripts\install_model.py --verifier
```

O verifier é um pickle local do scikit-learn, carregado **apenas** de arquivo
gerado e confiável. O gateway pode passar `verifier_enabled=true`,
`verifier_model=luna_verifier.pkl` e `verifier_threshold=0.1` para `/detect`.
Este threshold é o score do classificador base que **aciona** o verifier,
seguindo a API do openWakeWord; o `threshold` normal decide a aceitação final.
Um verifier solicitado e ausente causa erro 503. Ele não é necessário para o
primeiro funcionamento.

O serviço expõe `GET /status` (inclusive sem modelo), `GET /health` (503 sem
modelo), `POST /detect` com PCM16 bruto e cabeçalho `X-Voice-Session-Id`,
`POST /reset` e `POST /reload`. O query `threshold` é configurável. Uma sessão
sem modelo recebe 503 explícito; nenhuma palavra pronta genérica é usada.

## Consumo em idle

Após instalar o modelo, faça 10, 30 e 60 minutos de baseline com o script:

```powershell
.venv\Scripts\python scripts\benchmark_idle.py --minutes 10
.venv\Scripts\python scripts\benchmark_idle.py --minutes 30
.venv\Scripts\python scripts\benchmark_idle.py --minutes 60
```

Ele envia silêncio a 12,5 frames/s e registra latência, falsos wakes e
`docker stats` em `reports/idle-*.json`. Para testar a **Voice UI**, rode no
host, a partir da raiz do repositório:

```powershell
node tools/wakeword-training/scripts/benchmark_browser_idle.mjs --minutes 10
node tools/wakeword-training/scripts/benchmark_browser_idle.mjs --minutes 60 --system-microphone
```

O teste abre Edge/Chromium com microfone simulado pelo WAV indicado em
`--ambient-file` (por padrão, o arquivo audível de 60 segundos usado no treino).
O arquivo é repetido até completar o tempo
de relógio. O relatório `reports/browser-idle-*.json` registra a
`VoiceSession`, frames e bytes WebSocket, eventos de sessão, estado da UI,
`docker stats` a cada 30 segundos, GPU via `nvidia-smi` e FPS do navegador.
Uma execução de
60 minutos grava checkpoints aos 10, 30 e 60 minutos. Os eventos downstream
da **mesma sessão** devem ser zero: wake detectado, STT, LLM e TTS. CPU, GPU e
rede dos contêineres são compartilhadas com outras sessões; faça a medição
definitiva em janela sem outros testes. Para ensaiar silêncio digital,
selecione o WAV de teste com `--ambient-file`; esse arquivo tem amplitude
quase nula. Repetir a mesma gravação não aumenta
as horas independentes de background para validar a taxa de falsos wakes.
Com `--system-microphone`, o script usa o microfone real do Windows e verifica
o nível RMS durante três segundos antes de iniciar. Rode
`node tools/wakeword-training/scripts/benchmark_browser_idle.mjs --seconds 30 --system-microphone`
para testar acesso ao dispositivo antes da hora completa.

O benchmark de silêncio do serviço e o teste com browser medem caminhos
diferentes. Nenhum dos dois substitui uma hora inédita de áudio ambiente ou
exemplos reais de “Luna” reservados para avaliação. Os resultados atuais do
modelo instalado estão em [PROVISIONAL.md](PROVISIONAL.md).
