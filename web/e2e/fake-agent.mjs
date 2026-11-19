// A stand-in ACP agent for the end-to-end tests: it answers over stdio the way Zed's agents do, without a model.
// A prompt's words choose what it does:
//    "ask"  asks for a permission first and says which option was chosen;
//    "slow" writes its reply over a few seconds;
//    "doc"  names a Markdown file of the project;
// anything else is answered at once with "Ответ: <prompt>".
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const pending = new Map();
let sequence = 0;
const cancelled = new Set();

function write(message) {
   process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function request(method, params) {
   const id = `agent-${++sequence}`;
   write({ id, method, params });
   return new Promise((resolve) => pending.set(id, resolve));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function say(sessionId, text) {
   write({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
}

async function prompt(sessionId, text) {
   cancelled.delete(sessionId);
   if (/\bask\b/.test(text)) {
      const reply = await request('session/request_permission', {
         sessionId,
         toolCall: { toolCallId: randomUUID(), title: `Проверка: ${text}`, kind: 'execute', status: 'pending' },
         options: [
            { optionId: 'allow', name: 'Разрешить', kind: 'allow_once' },
            { optionId: 'deny', name: 'Запретить', kind: 'reject_once' },
         ],
      });
      say(sessionId, `Выбрано: ${reply?.outcome?.optionId ?? reply?.outcome?.outcome ?? 'ничего'}`);
      return 'end_turn';
   }
   if (/\bslow\b/.test(text)) {
      for (let part = 1; part <= 6; part++) {
         if (cancelled.has(sessionId)) return 'cancelled';
         say(sessionId, `${part === 1 ? '' : ' '}часть ${part}`);
         await sleep(500);
      }
      say(sessionId, ` — готово: ${text}`);
      return 'end_turn';
   }
   if (/\bdoc\b/.test(text)) {
      say(sessionId, 'Бриф лежит в `docs/brief.md`.');
      return 'end_turn';
   }
   say(sessionId, `Ответ: ${text}`);
   return 'end_turn';
}

async function handle(message) {
   if (message.method === undefined) {
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
      return;
   }
   const { id, method, params } = message;
   switch (method) {
      case 'initialize':
         return write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] } });
      case 'session/new':
         return write({ id, result: { sessionId: randomUUID() } });
      case 'session/prompt': {
         const text = params.prompt
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('');
         return write({ id, result: { stopReason: await prompt(params.sessionId, text) } });
      }
      case 'session/cancel':
         cancelled.add(params.sessionId);
         return;
      default:
         if (id !== undefined) write({ id, result: {} });
   }
}

createInterface({ input: process.stdin }).on('line', (line) => {
   if (line.trim()) void handle(JSON.parse(line));
});
