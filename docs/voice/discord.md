# Luna em canal de voz do Discord

A primeira versão é um piloto para um canal de voz comum de um servidor privado. Configure o canal em **Configurações → Discord**. O botão de ativação permite que o bot receba comandos no canal escolhido.

## Usar na call

- Entre no canal configurado e use **/luna entrar** para conectar o bot.
- Cada pessoa que quiser ser ouvida usa **/luna participar** na call. Depois, diga “Luna” com a pergunta ou espere o bip antes de falar.
- Todos no canal ouvem o bip e a resposta. Um participante por vez ganha o turno. **/luna parar** encerra sua participação. **/luna sair** desconecta a Luna.

O piloto trata os pacotes de cada conta separadamente. Duas pessoas usando o mesmo microfone e a mesma conta chegam como uma única fonte. A transcrição, a geração e a síntese passam pelos serviços locais. O processamento usa o contexto temporário do turno e mantém as memórias e o histórico do perfil pessoal separados. As métricas de diagnóstico dispensam o áudio e o texto falado.

## Instalação e diagnóstico

Crie um aplicativo de bot no [Developer Portal](https://discord.com/developers/applications). Use instalação no servidor com os escopos `bot` e `applications.commands` e as permissões **Ver canais**, **Conectar** e **Falar** no canal de teste. Mantenha as intenções privilegiadas desligadas.

O operador coloca a credencial do bot e um segredo interno aleatório no `.env` local. A interface só recebe o estado da integração e os destinos disponíveis. O segredo interno é usado entre a API e o serviço `discord-voice` e a credencial Discord é lida pelo serviço de voz. A integração inicia desativada. Para reverter o piloto, desative a integração pela interface. Os dados de configuração ficam em uma tabela aditiva.

Teste o transporte com dois clientes, incluindo o bot entrando com alguém já no canal e a saída e reentrada de um participante. O canal de voz exige DAVE e mídia UDP. Verifique o bip nos dois clientes e a resposta para cada falante, além de falar antes de optar pela participação, comandos contínuos, sobreposição e desconexão durante um turno. [Discord Voice](https://docs.discord.com/developers/topics/voice-connections) · [Recepção de áudio do discord.js](https://discord.js.org/docs/packages/voice/0.19.2/VoiceReceiver:Class)

