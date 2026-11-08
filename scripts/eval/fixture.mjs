import { createServer } from 'node:http';

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.end('ok');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { model, messages } = JSON.parse(body);
    const users = messages.filter(({ role }) => role === 'user').map(({ content }) => content);
    const input = users.at(-1) ?? '';
    let content;
    if (model === 'eval-orchestrator') {
      content = JSON.stringify({ type: 'finalize' });
    } else if (input.includes('Jatobá 17')) {
      content = 'Jatobá 17';
    } else if (input.includes('Qual foi o codinome') && users.slice(0, -1).some(text => text.includes('Neblina 47'))) {
      content = 'Neblina 47';
    } else if (input.includes('Neblina 47')) {
      content = 'Entendido.';
    } else {
      content = 'Sem resposta de fixture para este contexto.';
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model,
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  } catch {
    response.writeHead(400).end('Invalid fixture request');
  }
}).listen(8080, '0.0.0.0');
