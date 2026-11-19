import { create } from 'zustand';
import type {
   AgentOption,
   ClientMessage,
   Command,
   ConfigOption,
   DeniedReason,
   Entry,
   FileError,
   LimitAccount,
   ProjectOption,
   QuickAction,
   QuestionResponse,
   ServerMessage,
   SessionSummary,
   TransferTarget,
} from '../../shared/protocol.ts';

type Connection = 'connecting' | 'open' | 'lost';
type Failure = Extract<ServerMessage, { type: 'failed' }>;

// A chat open in a pane, or null for the new-chat screen, of which there is at most one.
export type Pane = string | null;

// A chat as this browser holds it: its entries from index start on, as a long chat is loaded a page at a time from the
// end, and its slash commands and settings. A chat comes to hold them while it is shown.
export type ChatData = { entries: Entry[] | null; start: number; commands: Command[]; options: ConfigOption[] };

export const MAX_PANES = 4;

type HubState = {
   token: string | null;
   // A code from the authenticator app waiting for the socket to open.
   code: string | null;
   denied: DeniedReason | null;
   connection: Connection;
   sessions: SessionSummary[];
   agents: AgentOption[];
   projects: ProjectOption[];
   // The panes from left to right and the one in use, whose chat the address names as openId. shown is how many fit on
   // the screen: those around the one in use are shown, the rest wait for room.
   panes: Pane[];
   focused: number;
   shown: number;
   openId: string | null;
   chats: Record<string, ChatData>;
   drawerOpen: boolean;
   // The chat started from here last; it shows as starting until the hub lists it.
   startedId: string | null;
   // The chat the hub prepared for the new-chat screen, as Zed opens a session for a new thread, and what it offers.
   draft: { agentId: string; cwd: string; sessionId: string | null } | null;
   draftCommands: Command[];
   draftOptions: ConfigOption[];
   // What went wrong in each chat, by its id; a new chat that did not start is under "".
   failures: Record<string, Failure>;
   quick: QuickAction[];
   // Whether the hub recognises speech, so the composer offers voice input.
   voice: boolean;
   // The key to subscribe to notifications with; empty while the hub cannot send them.
   push: string;
   limits: LimitAccount[];
   // A chat being moved to another agent: where it can go, once the hub says, and whether the move is under way.
   transfer: { sessionId: string; targets: TransferTarget[] | null; busy: boolean } | null;
   // A Markdown file of a chat's project being read: its text or why not, once the hub answers.
   file: { sessionId: string; path: string; text: string | null; error: FileError | null } | null;
   enter: (code: string) => void;
   logout: () => void;
   send: (sessionId: string, text: string) => void;
   cancel: (sessionId: string) => void;
   prepare: (agentId: string, cwd: string) => void;
   sendDraft: (text: string) => void;
   answer: (sessionId: string, entryId: string, response: QuestionResponse) => void;
   configure: (sessionId: string, configId: string, value: string | boolean) => void;
   openDrawer: () => void;
   closeDrawer: () => void;
   dismissFailure: (sessionId: string) => void;
   loadOlder: (sessionId: string) => void;
   archive: (sessionId: string, archived: boolean) => void;
   saveQuick: (actions: QuickAction[]) => void;
   pushSubscribe: (subscription: PushSubscriptionJSON) => void;
   openTransfer: (sessionId: string) => void;
   closeTransfer: () => void;
   startTransfer: (agentId: string) => void;
   openFile: (sessionId: string, path: string) => void;
   closeFile: () => void;
   pushUnsubscribe: (endpoint: string) => void;
   focusPane: (index: number) => void;
   // Opens a chat in a new pane at index, or puts the pane it is in to use.
   openBeside: (chat: Pane, index: number) => void;
   // Puts a chat in the pane at index in place of its chat, or puts the pane it is in to use.
   showIn: (index: number, chat: Pane) => void;
   closePane: (index: number) => void;
   setShown: (shown: number) => void;
};

const TOKEN_KEY = 'agent-hub.token';
const PANES_KEY = 'agent-hub.panes';
const RETRY_MIN = 1000;
const RETRY_MAX = 10_000;
const LIMITS_EVERY = 5 * 60_000;

// "#/s/<id>" is a chat; anything else is a new chat.
function readOpenId() {
   const match = /^#\/s\/(.+)$/.exec(location.hash);
   return match ? decodeURIComponent(match[1]) : null;
}

function hashOf(chat: Pane) {
   return chat === null ? '#/' : `#/s/${encodeURIComponent(chat)}`;
}

// The panes kept from the last visit, with the chat the address names in use: in its pane if it has one, in place of
// the chat that was in use if not.
function readPanes(openId: Pane) {
   let panes: Pane[] = [null];
   let focused = 0;
   try {
      const kept: unknown = JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null');
      if (kept && typeof kept === 'object' && 'panes' in kept && 'focused' in kept && Array.isArray(kept.panes)) {
         const list = kept.panes.filter((pane): pane is Pane => pane === null || typeof pane === 'string').slice(0, MAX_PANES);
         if (list.length > 0 && new Set(list).size === list.length) {
            panes = list;
            focused = typeof kept.focused === 'number' ? Math.min(Math.max(kept.focused, 0), list.length - 1) : 0;
         }
      }
   } catch {
      // A broken record starts over with one pane.
   }
   const at = panes.indexOf(openId);
   if (at >= 0) return { panes, focused: at };
   panes = panes.slice();
   panes[focused] = openId;
   return { panes, focused };
}

// shownPanes are the indexes of the panes on screen: as many as fit, the one in use among them.
export function shownPanes(count: number, focused: number, shown: number) {
   const size = Math.min(count, Math.max(shown, 1));
   const first = Math.min(Math.max(focused - size + 1, 0), count - size);
   return Array.from({ length: size }, (_, index) => first + index);
}

// roomBeside is whether another pane fits on screen beside those open.
export function roomBeside(state: { panes: Pane[]; shown: number }) {
   return state.panes.length < Math.min(state.shown, MAX_PANES);
}

// A link printed by the hub carries the token once; keep it and drop it from the address bar.
function takeTokenFromUrl() {
   const match = /^#token=(.+)$/.exec(location.hash);
   if (!match) return null;
   history.replaceState(null, '', `${location.pathname}${location.search}#/`);
   return decodeURIComponent(match[1]);
}

const initialToken = takeTokenFromUrl() ?? localStorage.getItem(TOKEN_KEY);
if (initialToken) localStorage.setItem(TOKEN_KEY, initialToken);
const initialOpenId = readOpenId();
const initialPanes = readPanes(initialOpenId);

let socket: WebSocket | null = null;
let retry = RETRY_MIN;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
// The chats the hub was last told are shown; only their entries are taken.
let viewed: string[] = [];
// Chats whose older page was asked for and has not come; a lost reply is forgotten with its socket or pane.
const olderPending = new Set<string>();
export type VoiceEvent = { text?: string; end?: boolean; error?: string };
let ticketWaiter: { resolve: (ticket: string) => void; reject: (error: Error) => void } | null = null;
const voiceListeners = new Map<string, (event: VoiceEvent) => void>();

// voiceTicket asks the hub for a ticket to upload one recording with.
export function voiceTicket() {
   return new Promise<string>((resolve, reject) => {
      ticketWaiter?.reject(new Error('superseded'));
      ticketWaiter = { resolve, reject };
      if (!post({ type: 'voice' })) {
         ticketWaiter = null;
         reject(new Error('no connection to the hub'));
      }
   });
}

// listenVoice hears the text of the recording uploaded with ticket, until its end.
export function listenVoice(ticket: string, listener: (event: VoiceEvent) => void) {
   voiceListeners.set(ticket, listener);
   return () => voiceListeners.delete(ticket);
}

// Quick actions saved while the socket was down, sent once it is back instead of being replaced by the hub's list.
let quickUnsent: QuickAction[] | null = null;

function post(message: ClientMessage) {
   if (socket?.readyState !== WebSocket.OPEN) return false;
   socket.send(JSON.stringify(message));
   return true;
}

function without<T>(record: Record<string, T>, key: string) {
   if (!(key in record)) return record;
   const rest = { ...record };
   delete rest[key];
   return rest;
}

// Changing the chat in use writes the address without a step back for every pane clicked.
function writeHash(chat: Pane) {
   if (hashOf(chat) !== (location.hash || '#/')) history.replaceState(null, '', hashOf(chat));
}

export const useHub = create<HubState>()((set, get) => ({
   token: initialToken,
   code: null,
   denied: null,
   connection: 'connecting',
   sessions: [],
   agents: [],
   projects: [],
   panes: initialPanes.panes,
   focused: initialPanes.focused,
   shown: 1,
   openId: initialOpenId,
   chats: {},
   drawerOpen: false,
   startedId: null,
   draft: null,
   draftCommands: [],
   draftOptions: [],
   failures: {},
   quick: [],
   limits: [],
   voice: false,
   push: '',
   transfer: null,
   file: null,
   enter: (code) => {
      set({ code, denied: null });
      connect();
   },
   logout: () => {
      // The hub forgets this device first, so the token is useless even if it was copied.
      post({ type: 'logout' });
      localStorage.removeItem(TOKEN_KEY);
      set({ token: null, sessions: [], chats: {}, limits: [], file: null });
      socket?.close();
   },
   send: (sessionId, text) => {
      post({ type: 'send', sessionId, text });
   },
   cancel: (sessionId) => {
      post({ type: 'cancel', sessionId });
   },
   prepare: (agentId, cwd) => {
      const draft = get().draft;
      if (draft?.agentId !== agentId || draft.cwd !== cwd)
         set({ draft: { agentId, cwd, sessionId: null }, draftCommands: [], draftOptions: [] });
      if (get().failures['']?.reason === 'start-failed') set({ failures: without(get().failures, '') });
      post({ type: 'prepare', agentId, cwd });
   },
   sendDraft: (text) => {
      const sessionId = get().draft?.sessionId;
      if (!sessionId) return;
      post({ type: 'send', sessionId, text });
      // The new chat takes the place of the new-chat screen it was started from.
      const { panes } = get();
      const at = Math.max(panes.indexOf(null), 0);
      set({
         startedId: sessionId,
         draft: null,
         draftCommands: [],
         draftOptions: [],
         panes: panes.with(at, sessionId),
         focused: at,
         openId: sessionId,
      });
      location.hash = hashOf(sessionId);
   },
   answer: (sessionId, entryId, response) => {
      set({ failures: without(get().failures, sessionId) });
      post({ type: 'answer', sessionId, entryId, response });
   },
   configure: (sessionId, configId, value) => {
      set({ failures: without(get().failures, sessionId) });
      post({ type: 'configure', sessionId, configId, value });
   },
   openDrawer: () => set({ drawerOpen: true }),
   closeDrawer: () => set({ drawerOpen: false }),
   dismissFailure: (sessionId) => set({ failures: without(get().failures, sessionId) }),
   pushSubscribe: (subscription) => post({ type: 'push-subscribe', subscription }),
   openTransfer: (sessionId) => {
      set({ transfer: { sessionId, targets: null, busy: false }, failures: without(get().failures, sessionId) });
      post({ type: 'transfer-options', sessionId });
   },
   closeTransfer: () => set({ transfer: null }),
   startTransfer: (agentId) => {
      const transfer = get().transfer;
      if (!transfer || transfer.busy) return;
      set({ transfer: { ...transfer, busy: true }, failures: without(get().failures, transfer.sessionId) });
      post({ type: 'transfer', sessionId: transfer.sessionId, agentId });
   },
   // A file asked for while the socket is down is asked for again once it is back.
   openFile: (sessionId, path) => {
      set({ file: { sessionId, path, text: null, error: null } });
      post({ type: 'file', sessionId, path });
   },
   closeFile: () => set({ file: null }),
   pushUnsubscribe: (endpoint) => post({ type: 'push-unsubscribe', endpoint }),
   saveQuick: (actions) => {
      set({ quick: actions });
      quickUnsent = post({ type: 'quick', actions }) ? null : actions;
   },
   archive: (sessionId, archived) => {
      post({ type: 'archive', sessionId, archived });
      // An archived chat is put away: its pane closes, or goes on to a new chat when it is the only one.
      const at = get().panes.indexOf(sessionId);
      if (!archived || at < 0) return;
      if (get().panes.length > 1) get().closePane(at);
      else location.hash = '#/';
   },
   loadOlder: (sessionId) => {
      const chat = get().chats[sessionId];
      if (!chat?.entries || chat.start === 0 || olderPending.has(sessionId)) return;
      olderPending.add(sessionId);
      post({ type: 'older', sessionId, before: chat.start });
   },
   focusPane: (index) => {
      const { panes, focused } = get();
      if (index === focused || index < 0 || index >= panes.length) return;
      set({ focused: index, openId: panes[index], drawerOpen: false });
      writeHash(panes[index]);
   },
   openBeside: (chat, index) => {
      const { panes } = get();
      const at = panes.indexOf(chat);
      if (at >= 0) return get().focusPane(at);
      if (panes.length >= MAX_PANES) return;
      const place = Math.min(Math.max(index, 0), panes.length);
      set({ panes: panes.toSpliced(place, 0, chat), focused: place, openId: chat, drawerOpen: false });
      writeHash(chat);
   },
   showIn: (index, chat) => {
      const { panes } = get();
      const at = panes.indexOf(chat);
      if (at >= 0) return get().focusPane(at);
      if (index < 0 || index >= panes.length) return;
      set({ panes: panes.with(index, chat), focused: index, openId: chat, drawerOpen: false, file: null });
      writeHash(chat);
   },
   closePane: (index) => {
      const { panes, focused } = get();
      if (panes.length < 2 || index < 0 || index >= panes.length) return;
      const next = panes.toSpliced(index, 1);
      const nextFocused = index < focused || focused === next.length ? focused - 1 : focused;
      set({ panes: next, focused: nextFocused, openId: next[nextFocused] });
      writeHash(next[nextFocused]);
   },
   setShown: (shown) => {
      if (shown !== get().shown) set({ shown });
   },
}));

// syncView tells the hub which chats are on screen, so it sends their entries as they change and spares notifications
// of them. Chats leaving the screen are forgotten here and sent whole when they come back; after a reconnect each chat
// asks only for what it lacks.
function syncView(reconnect: boolean) {
   const { panes, focused, shown, chats, connection } = useHub.getState();
   if (connection !== 'open') return;
   const ids = shownPanes(panes.length, focused, shown)
      .map((index) => panes[index])
      .filter((pane): pane is string => pane !== null);
   if (!reconnect && ids.length === viewed.length && ids.every((id, index) => id === viewed[index])) return;
   const sent = post({
      type: 'view',
      panes: ids.map((sessionId) => {
         const held = chats[sessionId]?.entries;
         return reconnect && held ? { sessionId, from: chats[sessionId].start } : { sessionId };
      }),
   });
   if (!sent) return;
   viewed = ids;
   for (const id of olderPending) if (!ids.includes(id)) olderPending.delete(id);
   const kept = Object.fromEntries(Object.entries(chats).filter(([id]) => ids.includes(id)));
   if (Object.keys(kept).length !== Object.keys(chats).length) useHub.setState({ chats: kept });
}

useHub.subscribe((state, previous) => {
   if (state.panes !== previous.panes || state.focused !== previous.focused || state.shown !== previous.shown) {
      localStorage.setItem(PANES_KEY, JSON.stringify({ panes: state.panes, focused: state.focused }));
      syncView(false);
   }
});

function updateChat(sessionId: string, change: (chat: ChatData) => Partial<ChatData>) {
   if (!viewed.includes(sessionId)) return;
   const chats = useHub.getState().chats;
   const chat = chats[sessionId] ?? { entries: null, start: 0, commands: [], options: [] };
   useHub.setState({ chats: { ...chats, [sessionId]: { ...chat, ...change(chat) } } });
}

function receive(message: ServerMessage) {
   const state = useHub.getState();
   switch (message.type) {
      case 'ready':
         retry = RETRY_MIN;
         useHub.setState({
            connection: 'open',
            sessions: message.sessions,
            agents: message.agents,
            projects: message.projects,
            voice: message.voice,
            push: message.push,
         });
         reportVisible();
         if (quickUnsent) {
            post({ type: 'quick', actions: quickUnsent });
            quickUnsent = null;
         } else useHub.setState({ quick: message.quick });
         syncView(true);
         post({ type: 'limits' });
         if (state.file && state.file.text === null && state.file.error === null)
            post({ type: 'file', sessionId: state.file.sessionId, path: state.file.path });
         return;
      case 'denied':
         if (message.reason === 'token') localStorage.removeItem(TOKEN_KEY);
         useHub.setState({ token: null, code: null, denied: message.reason });
         return;
      case 'session':
         localStorage.setItem(TOKEN_KEY, message.token);
         useHub.setState({ token: message.token, code: null });
         return;
      case 'sessions':
         useHub.setState({ sessions: message.sessions });
         return;
      case 'limits':
         useHub.setState({ limits: message.accounts });
         return;
      case 'quick':
         useHub.setState({ quick: message.actions });
         return;
      case 'voice-ticket':
         ticketWaiter?.resolve(message.ticket);
         ticketWaiter = null;
         return;
      case 'voice-text':
         voiceListeners.get(message.ticket)?.({ text: message.text });
         return;
      case 'voice-end':
         if (message.ticket === '') {
            ticketWaiter?.reject(new Error(message.error ?? 'voice input is off'));
            ticketWaiter = null;
         } else voiceListeners.get(message.ticket)?.({ end: true, error: message.error });
         return;
      case 'timeline':
         olderPending.delete(message.sessionId);
         updateChat(message.sessionId, () => ({ entries: message.entries, start: message.start }));
         return;
      case 'older':
         olderPending.delete(message.sessionId);
         // A page that no longer joins the entries held, after the chat was reloaded meanwhile, is dropped.
         updateChat(message.sessionId, (chat) =>
            chat.entries && message.start + message.entries.length === chat.start
               ? { entries: [...message.entries, ...chat.entries], start: message.start }
               : {},
         );
         return;
      case 'patch':
         updateChat(message.sessionId, (chat) => {
            if (!chat.entries) return {};
            const entries = chat.entries.slice();
            // Changes to entries not loaded yet come with them when they are.
            for (const { index, entry } of message.changes) if (index >= chat.start) entries[index - chat.start] = entry;
            return { entries };
         });
         return;
      case 'commands':
         updateChat(message.sessionId, () => ({ commands: message.commands }));
         if (message.sessionId === state.draft?.sessionId) useHub.setState({ draftCommands: message.commands });
         return;
      case 'options':
         updateChat(message.sessionId, () => ({ options: message.options }));
         if (message.sessionId === state.draft?.sessionId) useHub.setState({ draftOptions: message.options });
         return;
      case 'prepared': {
         const draft = state.draft;
         // A reply for an agent or project the user has since moved away from is left alone.
         if (draft?.agentId === message.agentId && draft.cwd === message.cwd)
            useHub.setState({ draft: { ...draft, sessionId: message.sessionId } });
         return;
      }
      case 'failed':
         useHub.setState({ failures: { ...state.failures, [message.sessionId]: message } });
         if (state.transfer?.sessionId === message.sessionId) useHub.setState({ transfer: { ...state.transfer, busy: false } });
         return;
      case 'transfer-options':
         if (state.transfer?.sessionId === message.sessionId) useHub.setState({ transfer: { ...state.transfer, targets: message.targets } });
         return;
      case 'file':
         if (state.file?.sessionId === message.sessionId && state.file.path === message.path)
            useHub.setState({ file: { ...state.file, text: message.text, error: message.error } });
         return;
      case 'transferred': {
         // The move ends in the new chat, in the pane of the chat it was moved from.
         if (state.transfer?.sessionId !== message.from) return;
         const at = state.panes.indexOf(message.from);
         if (at >= 0 && !state.panes.includes(message.sessionId))
            useHub.setState({ transfer: null, panes: state.panes.with(at, message.sessionId), focused: at, openId: message.sessionId });
         else useHub.setState({ transfer: null });
         location.hash = hashOf(message.sessionId);
         return;
      }
   }
}

function connect() {
   const { token, code } = useHub.getState();
   if ((!token && !code) || socket) return;
   clearTimeout(retryTimer);
   const next = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
   socket = next;
   next.onopen = () => next.send(JSON.stringify((code ? { type: 'auth', code } : { type: 'auth', token: token ?? '' }) satisfies ClientMessage));
   next.onmessage = (event) => receive(JSON.parse(String(event.data)) as ServerMessage);
   next.onclose = () => {
      socket = null;
      viewed = [];
      olderPending.clear();
      // The text of a recording goes to the socket that asked for it; with that socket gone it will not come.
      ticketWaiter?.reject(new Error('connection lost'));
      ticketWaiter = null;
      for (const listener of voiceListeners.values()) listener({ end: true, error: 'connection lost' });
      voiceListeners.clear();
      if (!useHub.getState().token) return;
      useHub.setState({ connection: 'lost' });
      retryTimer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, RETRY_MAX);
   };
}

function reportVisible() {
   post({ type: 'visible', visible: document.visibilityState === 'visible' });
}

document.addEventListener('visibilitychange', reportVisible);

// Limits are asked for while the page is on screen.
function askLimits() {
   if (document.visibilityState === 'visible') post({ type: 'limits' });
}

document.addEventListener('visibilitychange', askLimits);
setInterval(askLimits, LIMITS_EVERY);

// The address names the chat in use: a chat already in a pane puts that pane to use, any other replaces the chat in
// the pane in use.
window.addEventListener('hashchange', () => {
   const openId = readOpenId();
   const { panes, focused, failures } = useHub.getState();
   const at = panes.indexOf(openId);
   if (at === focused) {
      useHub.setState({ drawerOpen: false });
      return;
   }
   if (at >= 0) {
      useHub.setState({ focused: at, openId, drawerOpen: false });
      return;
   }
   const replaced = panes[focused];
   useHub.setState({
      panes: panes.with(focused, openId),
      openId,
      drawerOpen: false,
      file: null,
      failures: replaced === null ? failures : without(failures, replaced),
   });
});

connect();
