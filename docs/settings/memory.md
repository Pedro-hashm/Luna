# Memórias da Luna

Em **Configurações → Memórias da Luna**, use Meu perfil para consultar e editar as memórias, Mapa para navegar por assunto e data, e Sugestões para aprovar ou rejeitar o que a Luna encontrou em mensagens novas.

## Usar no chat

Peça “Lembre que meu editor padrão é X” ou “Esqueça meu editor padrão”. A Luna confirma operações que o backend concluiu. Na configuração inicial, os pedidos de lembrar criam memórias privadas. Autorize o item em **Permitir uso no chat**, ou habilite a autorização padrão para novos pedidos explícitos. Conteúdo autorizado pode entrar no prompt do modelo configurado, inclusive um modelo externo. Itens privados aparecem no painel.

O Orchestrator decide entre memória, contexto imediato e busca de conversas. A busca de memórias passa as afirmações à geração final, com identificação de item e revisão no inspetor. A consulta web não recebe os campos da memória a partir dessa busca. O texto já existente no chat tem seu próprio ciclo de retenção.

## Memória fixa

O painel mostra quais itens cabem no bloco habitual e por quê. O limite começa em 512 tokens estimados e aceita valores entre 0 e 4.096. O valor zero mantém a busca sob demanda. As fixações manuais têm prioridade. A base também pode incluir fatos vigentes, globais e autorizados, como o nome preferido e o idioma de resposta. Outras preferências e fatos do perfil qualificam quando a revisão vigente chega à resposta final a partir de buscas em pelo menos três chats nos últimos 45 dias, com pelo menos dois pedidos distintos. A presença na base por si só não conta como consulta.

A geração usa o mesmo estimador do contexto imediato e conta o bloco serializado, incluindo instruções e metadados. O orçamento efetivo é reduzido pela conversa, pelas ferramentas e pela reserva de saída. A busca compartilha o teto total com a base. O perfil de orçamento local usa 8.192 tokens de janela e limita a memória a 1.024 tokens. O `paid-general` usa 2.048 tokens como teto normal da busca ou 4.096 quando há mais de uma busca, respeitando a folga da resposta. O inspetor exibe o uso estimado e os limites do turno.

## Aprender em segundo plano

**Sugerir novas memórias** começa desativado. Quando ligado, a resposta salva e o job da mensagem do usuário entram na mesma transação. O worker analisa até oito mensagens por rodada, depois de um intervalo, usando o Ollama local direto. O modelo padrão é `qwen3:4b-instruct`; `LUNA_MEMORY_MODEL` permite escolher outro instalado. **Analisar agora** trabalha sobre a fila. Os chats anteriores à ativação ficam no histórico. Uma sugestão precisa de um trecho literal e de revisão humana antes de criar ou atualizar um fato.

Confirmações literais do mesmo valor podem acrescentar uma fonte ao item existente. Uma **mudança real** fecha a versão anterior com a data informada, ou deixa o término sem data confirmada. Uma **correção** retrata a versão anterior. A linha do tempo mostra quando a Luna registrou e quando a afirmação valia. **Esquecer** remove o item, suas revisões e sugestões relacionadas, mantendo chaves resumidas para bloquear reaprendizado das mesmas fontes. A conversa original é independente.

## Acesso e reversão

O Compose publica API e interface em loopback por padrão. Para disponibilizar dados pessoais pela rede, coloque um controle de acesso autenticado à frente da aplicação. Desligar **Memória no chat** pausa o uso e o processamento em segundo plano. A migration é aditiva; o código anterior pode rodar com as tabelas preservadas.

Os casos sintéticos usam a stack isolada de avaliação. A rotina `scripts/eval/memory.mjs` precisa de uma API descartável, nome de projeto Compose `luna-eval-*` e diretório local de relatórios. Ela cobre gravação explícita, consulta em outro chat, controles de privacidade, revisões, aprovação, exclusão e repetição do processamento.
