# Personalidade

Abra **Configurações → Personalidade**. **Luna atual** é o comportamento original. **Luna Sagaz** é elegante, confiante e próxima, com humor discreto quando a conversa dá abertura. Duplique um original ou crie um preset para editar o jeito de conversar. Salve a edição e use **Ativar preset**. Alterações salvas no preset ativo também entram na próxima resposta, em conversas e sessões de voz já abertas.

A prévia usa o modelo da Luna para responder à mesma mensagem com o preset ativo e o rascunho. Ela compara estilo sem acionar ferramentas ou gravar a mensagem no histórico. A página avisa quando a prévia está gerando as duas respostas.

O preset entra na geração final. O pedido de formato, as regras de evidência, as citações e os limites de fala têm prioridade. O inspetor registra nome, ID e revisão do preset aplicado com o `requestId`. A configuração de personalidade é independente da memória pessoal e do histórico de conversas.

## Validação

Use a stack de [avaliação isolada](../feature-workflow.md) com a migration aplicada. Para comparar os dois presets com o mesmo provedor, indique a API descartável em `LUNA_PERSONALITY_EVAL_URL`, um diretório local ignorado em `LUNA_PERSONALITY_EVAL_OUTPUT` e, opcionalmente, o modelo esperado em `LUNA_PERSONALITY_EVAL_MODEL`. Execute `node scripts/eval/personality.mjs` e revise os pares em `blind.json` antes de abrir a chave em `personality-report.json`.

O smoke de navegador `apps/api/scripts/smoke-personality-browser.mjs` usa `WEB_URL` apontando para a interface descartável e testa criação, edição, prévia, ativação, persistência e retorno ao padrão. Use os smokes de voz e pesquisa para mudanças nos respectivos fluxos.

A reversão operacional é ativar **Luna atual**. Se for preciso reverter o código, a migration é aditiva e as tabelas de presets podem permanecer no banco para preservar configurações criadas.
