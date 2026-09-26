# Pack de voz pessoal para Kokoro

`create-voice.ps1` usa a gravação local `Downloads/Luna-Voice.mp3`, gera um
tensor de voz `.pt` e o instala no volume compartilhado com o serviço Kokoro.
O fluxo usa a GPU NVIDIA disponível no Docker. O modelo e os serviços normais
da Luna não são retreinados.

Na raiz do repositório, rode no PowerShell:

```powershell
.\tools\kokoro-voice-training\create-voice.ps1
```

O identificador padrão é `pf_luna_user_pt`. Para usar outro, passe
`-VoiceId pm_luna_user_pt`. O primeiro caractere `p` seleciona português
brasileiro; `f` ou `m` é a convenção de nome do catálogo. O pack final fica no
volume do Kokoro. Uma cópia local e uma prévia ficam em
`tools/kokoro-voice-training/output/`, que o Git ignora.

O pack pode ser chamado diretamente no endpoint OpenAI compatível do Kokoro:

```json
{
  "model": "kokoro",
  "input": "Texto para sintetizar.",
  "voice": "pack://pf_luna_user_pt",
  "response_format": "wav"
}
```

## Variante de estilo da Luna

`create_style_voice.py` cria uma segunda voz em português sem retreinar o Kokoro:
por padrão, mistura 12% do timbre feminino de `if_sara` com `pf_dora`, mantendo
intacta a prosódia brasileira da Dora. A Luna registra esse perfil como
`pf_luna_nobre` e aplica uma redução de 4% na velocidade. A frase de prévia fica
em `output/pf_luna_nobre-preview.mp3`.

Com PyTorch e `huggingface_hub` instalados, o pack pode ser recriado assim:

```powershell
& .\tools\qwen-voice-cloning\.venv\Scripts\python.exe `
  .\tools\kokoro-voice-training\create_style_voice.py `
  --output .\tools\kokoro-voice-training\output\pf_luna_nobre.pt
```

Kokoro não recebe instruções em linguagem natural para emoção. A mistura altera
o timbre de forma sutil; o ritmo mais calmo é um ajuste fixo do perfil, e não um
controle de interpretação frase a frase.

## Alcance do ajuste

O gerador usa `inno-kokoro` 0.2.0 para ajustar o timbre e mantém a metade de
prosódia do tensor a partir de uma voz nativa de português brasileiro do
Kokoro (`pf_dora` para `pf_`, `pm_alex` para `pm_`). A gravação de 26 segundos
atende ao limite de 3–30 segundos do afinador. O ajuste roda na GPU, mas leva
pouco tempo; mais horas de GPU não treinariam a voz mais profundamente.

O projeto upstream documenta o afinador de timbre como disponível somente
para inglês. A saída agora usa prosódia nativa do Kokoro em português e passa
por uma síntese real na rota `pf`, mas a semelhança da identidade em português
continua experimental. Um treinamento supervisionado de alta fidelidade
exigiria um corpus maior com gravações limpas e transcrições alinhadas; 26
segundos tenderiam a sobreajustar o modelo completo.

A amostra e o pack não entram no Git. O afinador é Apache-2.0 e seu encoder de
falante tem atribuição CC BY-SA 3.0; consulte o
[projeto upstream](https://github.com/remsky/inno-kokoro).
