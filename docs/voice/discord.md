# Luna em canal de voz do Discord

Configure o canal de voz em **Configurações → Discord**. A integração permite enviar perguntas pelo chat do Discord e ouvir as respostas da Luna na call.

## Usar na call

- Entre no canal configurado e use **/luna entrar** para conectar o bot.
- Quem está no canal usa **/luna perguntar query:** e escreve a pergunta. O campo `query` é obrigatório.
- Todos no canal ouvem a resposta na voz configurada na Luna. O bot responde a uma pergunta por vez. **/luna sair** desconecta a Luna.

O bot entra com a escuta desativada. A pergunta segue pela API normal da Luna, com o ID e o nome de exibição da conta que enviou o comando. A Luna distingue contas com o mesmo nome e mantém uma conversa por conta em cada call. Cada convidado tem seu próprio escopo de memória. A conta vinculada na interface usa as memórias do perfil principal. As perguntas e respostas aparecem no chat da Luna e nos fluxos de execução.

## Instalação e diagnóstico

Crie um aplicativo de bot no [Developer Portal](https://discord.com/developers/applications). Use instalação no servidor com os escopos `bot` e `applications.commands` e as permissões **Ver canais**, **Conectar** e **Falar** no canal de teste. Mantenha as intenções privilegiadas desligadas.

O operador coloca a credencial do bot e um segredo interno aleatório no `.env` local. A interface só recebe o estado da integração e os destinos disponíveis. O segredo interno é usado entre a API e o serviço `discord-voice` e a credencial Discord é lida pelo serviço de voz. A integração inicia desativada. Para reverter o piloto, desative a integração pela interface. Os dados de configuração ficam em uma tabela aditiva.

Teste com duas contas no mesmo canal. Envie duas perguntas seguidas pela primeira conta e uma pela segunda. Confira a resposta em voz, a continuidade da primeira conversa e a separação das mensagens e memórias da segunda conta. [Comandos de aplicativo do Discord](https://docs.discord.com/developers/docs/interactions/slash-commands)

