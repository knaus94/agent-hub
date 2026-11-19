// A stand-in ACP agent for the end-to-end tests: it answers over stdio the way Zed's agents do, without a model.
// A prompt's words choose what it does:
//    "ask"  asks for a permission first and says which option was chosen;
//    "slow" writes its reply over a few seconds;
//    "doc"  names a Markdown file of the project;
//    "many" takes 120 steps first, more than a page of the hub's history;
//    "picture" reads an image file and replays a picture of the user's, as a chat loaded from history does;
// anything else is answered at once with "Ответ: <prompt>".
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

// A checkerboard, 640 by 360.
const PICTURE =
   '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';

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
   if (/\bmany\b/.test(text)) {
      for (let step = 1; step <= 120; step++)
         write({
            method: 'session/update',
            params: {
               sessionId,
               update: { sessionUpdate: 'tool_call', toolCallId: randomUUID(), title: `Шаг ${step}`, kind: 'read', status: 'completed' },
            },
         });
      say(sessionId, 'Все шаги сделаны');
      return 'end_turn';
   }
   if (/\bpicture\b/.test(text)) {
      const image = { type: 'image', mimeType: 'image/png', data: PICTURE };
      write({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'user_message_chunk', content: image } } });
      write({
         method: 'session/update',
         params: {
            sessionId,
            update: {
               sessionUpdate: 'tool_call',
               toolCallId: randomUUID(),
               title: 'Read shot.png',
               kind: 'read',
               status: 'completed',
               content: [{ type: 'content', content: image }],
            },
         },
      });
      say(sessionId, 'Картинка прочитана');
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
