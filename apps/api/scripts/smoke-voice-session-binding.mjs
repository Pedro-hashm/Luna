/** A URL must not display one Conversation while using another's VoiceSession. */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const api = (process.env.API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/u, '');
const web = (process.env.WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/$/u, '');

async function startSession() {
  const response = await fetch(`${api}/voice/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'wake' }),
  });
  if (!response.ok) throw new Error(`Could not start VoiceSession: ${response.status}`);
  return response.json();
}

const sessions = [];
let browser;
try {
  const first = await startSession(); sessions.push(first);
  const second = await startSession(); sessions.push(second);
  if (first.conversationId === second.conversationId) throw new Error('Expected distinct Conversations');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  let voiceSockets = 0;
  page.on('websocket', (socket) => { if (socket.url().includes('/voice/ws')) voiceSockets += 1; });
  await page.goto(`${web}/voice/${first.conversationId}?session=${second.id}`);
  const alert = page.getByRole('alert').filter({ hasText: 'não pertence à conversa' });
  await alert.waitFor({ timeout: 20_000 });
  const message = await alert.innerText();
  if (!message.includes('não pertence à conversa')) throw new Error(`Wrong-session warning missing: ${message}`);
  if (voiceSockets !== 0) throw new Error('Wrong-session URL opened a voice WebSocket');
  if (await page.getByRole('button', { name: 'Ativar microfone' }).isEnabled()) {
    throw new Error('Wrong-session URL enabled microphone activation');
  }
  console.log(JSON.stringify({ passed: true, firstConversationId: first.conversationId,
    secondConversationId: second.conversationId, warning: message, voiceSockets }, null, 2));
} finally {
  await browser?.close();
  for (const session of sessions) {
    await fetch(`${api}/voice/sessions/${encodeURIComponent(session.id)}/end`, { method: 'POST' }).catch(() => undefined);
  }
}
