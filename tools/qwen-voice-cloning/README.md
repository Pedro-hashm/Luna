# Clonagem de voz em português com Qwen3-TTS

O Kokoro não aceita o prompt de clonagem do Qwen como um arquivo `.pt`. O método desta pasta usa o Qwen3-TTS Base para sintetizar diretamente em português a partir do áudio de referência. Ele não retreina pesos: constrói um prompt de voz a partir do áudio e da transcrição correspondente.

O sample de `Downloads/Luna-Voice.mp3` foi reconhecido como português brasileiro. Com o Qwen3-TTS 0.6B Base, a frase de validação foi gerada em português e o transcritor confirmou o texto esperado. O áudio de demonstração local fica em `output/luna-ptbr-clone-fullref.wav`.

## Windows + NVIDIA

O modelo oficial lista português entre os idiomas aceitos e documenta clonagem com áudio de referência e sua transcrição. A versão 0.6B é a opção menor para GPUs de 8 GB. Nesta máquina, BF16 funcionou; FP16 acionou uma falha CUDA durante a geração. O código e o modelo Base 0.6B declaram licença Apache 2.0.

```powershell
py -3.12 -m venv tools/qwen-voice-cloning/.venv
& tools/qwen-voice-cloning/.venv/Scripts/python.exe -m pip install -r tools/qwen-voice-cloning/requirements.txt
& tools/qwen-voice-cloning/.venv/Scripts/python.exe -m pip uninstall -y torch torchaudio
& tools/qwen-voice-cloning/.venv/Scripts/python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu130
```

Gere fala com a gravação original e a transcrição literal dela:

```powershell
& tools/qwen-voice-cloning/.venv/Scripts/python.exe tools/qwen-voice-cloning/clone_voice.py `
  --reference "$env:USERPROFILE/Downloads/Luna-Voice.mp3" `
  --reference-text "Olá, meu nome é Luna, e esta é uma pequena amostra da minha voz. Eu consigo falar de maneira calma e natural, mantendo um ritmo confortável durante uma conversa. Quando você me faz uma pergunta, eu tento responder de forma clara e direta. Se o assunto for mais complexo, posso explicar os detalhes passo a passo, mas sem complicar desnecessariamente. Também consigo conversar de maneira mais descontraída. Podemos falar sobre qualquer coisa." `
  --text "Oi! Eu sou a Luna. Posso conversar com você em português brasileiro usando a minha voz." `
  --output tools/qwen-voice-cloning/output/luna-clone.wav
```

O modelo é carregado com BF16 no dispositivo CUDA. O primeiro uso baixa os pesos do modelo Base 0.6B e do tokenizer. Não é necessário treinar com este sample; o modelo aceita uma referência curta e reutiliza as características vocais na síntese. A transcrição de referência deve corresponder ao áudio, porque o modo de maior qualidade usa os dois.

## Uso na Luna

Em Configurações → Voz, selecione **Kokoro · pf_dora** ou **Qwen3-TTS · minha voz clonada**. O Qwen é iniciado sem carregar pesos na GPU; na primeira síntese ele carrega o modelo e cria o prompt de clonagem. Após cinco minutos sem uso, libera o modelo e a VRAM. O Kokoro continua usando `pf_dora`.

O prompt Qwen não se converte em embedding `.pt` do Kokoro. São formatos e motores diferentes; a alternância muda o motor de síntese.

## Armazenamento

O cache que esta instalação baixou para o modelo Base 0.6B ocupa cerca de 2,52 GB, já incluindo o tokenizer de fala. O serviço Docker monta o cache Hugging Face local existente, portanto não cria uma segunda cópia desses pesos. Nesta máquina, a imagem Qwen ficou em 3,39 GB e a imagem Kokoro em 5,53 GB (`docker image inspect`); em uma instalação nova, some os 2,52 GB do cache dos pesos Qwen.

Modelo e implementação Qwen3-TTS: Apache-2.0. O projeto oficial lista português entre os dez idiomas e fornece `generate_voice_clone` com `ref_audio`, `ref_text` e `language="Portuguese"`. Referências: [documentação oficial de idiomas e clonagem](https://github.com/QwenLM/Qwen3-TTS#voice-clone) e [licença declarada pelo modelo Base 0.6B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base).
