# Memórias da Luna

Em **Configurações → Memórias da Luna**, use Meu perfil para consultar e editar as memórias, Mapa para navegar por assunto e data, e Sugestões para aprovar ou rejeitar o que a Luna encontrou em mensagens novas.

## Usar no chat

Peça “Lembre que meu editor padrão é X” ou “Esqueça meu editor padrão”. A Luna confirma operações que o backend concluiu. Na configuração inicial, os pedidos de lembrar criam memórias privadas. Autorize o item em **Permitir uso no chat**, ou habilite a autorização padrão para novos pedidos explícitos. Conteúdo autorizado pode entrar no prompt do modelo configurado, inclusive um modelo externo. Itens privados aparecem no painel. Fixar um item global reserva espaço no contexto, com limite de três.

O Orchestrator decide entre memória, contexto imediato e busca de conversas. A busca de memórias passa as afirmações à geração final, com identificação de item e revisão no inspetor. A consulta web não recebe os campos da memória a partir dessa busca. O texto já existente no chat tem seu próprio ciclo de retenção.

## Aprender em segundo plano

**Sugerir novas memórias** começa desativado. Quando ligado, a resposta salva e o job da mensagem do usuário entram na mesma transação. O worker analisa até oito mensagens por rodada, depois de um intervalo, usando o Ollama local direto. O modelo padrão é `qwen3:4b-instruct`; `LUNA_MEMORY_MODEL` permite escolher outro instalado. **Analisar agora** trabalha sobre a fila. Os chats anteriores à ativação ficam no histórico. Uma sugestão precisa de um trecho literal e de revisão humana antes de criar ou atualizar um fato.

Confirmações literais do mesmo valor podem acrescentar uma fonte ao item existente. Uma **mudança real** fecha a versão anterior com a data informada, ou deixa o término sem data confirmada. Uma **correção** retrata a versão anterior. A linha do tempo mostra quando a Luna registrou e quando a afirmação valia. **Esquecer** remove o item, suas revisões e sugestões relacionadas, mantendo chaves resumidas para bloquear reaprendizado das mesmas fontes. A conversa original é independente.

## Acesso e reversão

O Compose publica API e interface em loopback por padrão. Para disponibilizar dados pessoais pela rede, coloque um controle de acesso autenticado à frente da aplicação. Desligar **Memória no chat** pausa o uso e o processamento em segundo plano. A migration é aditiva; o código anterior pode rodar com as tabelas preservadas.

Os casos sintéticos usam a stack isolada de avaliação. A rotina `scripts/eval/memory.mjs` precisa de uma API descartável, nome de projeto Compose `luna-eval-*` e diretório local de relatórios. Ela cobre gravação explícita, consulta em outro chat, controles de privacidade, revisões, aprovação, exclusão e repetição do processamento.
