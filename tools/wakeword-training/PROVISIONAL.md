# Estado do modelo Luna instalado

O modelo atualmente carregado é **provisório**, SHA-256
`FBA1B6EC0BC3E00BE351A76A464D02B9CCA9FDC1AFD43723044E94BBC9245025`.
O Wake está ativo com limiar `0.6`, verificador pessoal habilitado e limiar do
verificador `0.5`. O ONNX e o verificador instalados correspondem aos artefatos
gerados pelo treino atual.

## Evidência obtida

| Medida | Resultado | Limite da evidência |
| --- | ---: | --- |
| Gravações reais do usuário pelo endpoint do serviço | 32/32 “Luna” detectadas; 0/27 negativos aceitos | Inclui arquivos de treino; a maioria veio da mesma sessão de gravação |
| Positivos reais nos splits de validação e teste | 4/4 detectados | Só 1 positivo no split de teste; não são sessões totalmente independentes |
| Negativos reais nos splits de validação e teste | 0/5 falsos disparos | Os clipes são frases diferentes da mesma sessão de gravação |
| Avaliação sintética reservada, limiar 0,6 e verificador 0,5 | 121/121 positivos; 0 falsos disparos em ~0,04 h | Vozes Kokoro brasileiras; poucas horas de negativos sintéticos |
| Ambiente real reservado | 0 h | Ainda não há taxa de falsos despertares por hora no quarto |

O teste real enviou os clipes em frames de 80 ms para `POST /detect`, com o
mesmo limiar e verificador usados pelo gateway da Luna. O detalhamento está em
`reports/real_recordings_http.json`.

Os primeiros testes encontraram falsos disparos em “Luta!”, “Loura!” e em uma
frase curta. Também encontraram confusão sintética com “lona” e “lunares”. O
treino passou a usar esses negativos difíceis durante a mineração em streaming,
imitando o pré-roll, o bloqueio de silêncio e o hangover do serviço. A última
mineração selecionou 602 trechos negativos difíceis de treino e 64 de validação.
A avaliação sintética final, alinhada ao serviço, teve 0 falsos disparos em
aproximadamente 0,04 h de negativos.

## Por que continua provisório

Os 32 positivos reais não equivalem a 32 sessões independentes: só um positivo
está no split de teste e a maioria dos exemplos foi gravada na mesma sessão e
no mesmo ambiente. Ainda falta validar o comportamento em outro dia, distância,
nível de voz e microfone. O conjunto também não tem uma hora de áudio ambiente
real reservada para teste. O estado do serviço permanece `provisional` até essa
medição independente.

## Próximos dados para validar

1. Grave pelo menos 20 “Luna” em outra sessão e reserve-os em
   `data/recordings/positive/test/`.
2. Grave pelo menos 60 minutos inéditos do ambiente real em
   `data/background/test/`, com os sons comuns do cômodo e sem dizer “Luna”.
3. Rode `prepare_data.py`, `train.py`, `train_verifier.py` e
   `evaluate.py --threshold 0.6 --verifier --verifier-threshold 0.5`.
4. Só promova o modelo sem `--allow-unvalidated` quando o relatório do mesmo
   SHA-256 atingir os critérios configurados.

Repetir o mesmo minuto de áudio não substitui uma hora de ambiente inédita.
