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

type HubState = {
   token: string | null;
   // A code from the authenticator app waiting for the socket to open.
   code: string | null;
   denied: DeniedReason | null;
   connection: Connection;
   sessions: SessionSummary[];
   agents: AgentOption[];
   projects: ProjectOption[];
   openId: string | null;
   drawerOpen: boolean;
   // The chat started from here last; it shows as starting until the hub lists it.
   startedId: string | null;
   // The open chat's entries from index entriesStart on: a long chat is loaded a page at a time, from the end.
   entries: Entry[] | null;
   entriesStart: number;
   // The slash commands and settings of the open chat.
   commands: Command[];
   options: ConfigOption[];
   // The chat the hub prepared for the new-chat screen, as Zed opens a session for a new thread, and what it offers.
   draft: { agentId: string; cwd: string; sessionId: string | null } | null;
   draftCommands: Command[];
   draftOptions: ConfigOption[];
   failure: Failure | null;
   quick: QuickAction[];
   // Whether the hub recognises speech, so the composer offers voice input.
   voice: boolean;
   // The key to subscribe to notifications with; empty while the hub cannot send them.
   push: string;
   limits: LimitAccount[];
   // A chat being moved to another agent: where it can go, once the hub says, and whether the move is under way.
   transfer: { sessionId: string; targets: TransferTarget[] | null; busy: boolean } | null;
   // A Markdown file of the open chat's project being read: its text or why not, once the hub answers.
   file: { sessionId: string; path: string; text: string | null; error: FileError | null } | null;
   enter: (code: string) => void;
   logout: () => void;
   send: (text: string) => void;
   cancel: () => void;
   prepare: (agentId: string, cwd: string) => void;
   sendDraft: (text: string) => void;
   answer: (entryId: string, response: QuestionResponse) => void;
   configure: (sessionId: string, configId: string, value: string | boolean) => void;
   openDrawer: () => void;
   closeDrawer: () => void;
   dismissFailure: () => void;
   loadOlder: () => void;
   archive: (sessionId: string, archived: boolean) => void;
   saveQuick: (actions: QuickAction[]) => void;
   pushSubscribe: (subscription: PushSubscriptionJSON) => void;
   openTransfer: (sessionId: string) => void;
   closeTransfer: () => void;
   startTransfer: (agentId: string) => void;
   openFile: (sessionId: string, path: string) => void;
   closeFile: () => void;
   pushUnsubscribe: (endpoint: string) => void;
};

const TOKEN_KEY = 'agent-hub.token';
const RETRY_MIN = 1000;
const RETRY_MAX = 10_000;
const LIMITS_EVERY = 5 * 60_000;

// "#/s/<id>" is a chat; anything else is a new chat.
function readOpenId() {
   const match = /^#\/s\/(.+)$/.exec(location.hash);
   return match ? decodeURIComponent(match[1]) : null;
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

let socket: WebSocket | null = null;
let retry = RETRY_MIN;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
// An older page asked for and not yet come; a lost reply is forgotten with its socket or chat.
let olderPending = false;
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

export const useHub = create<HubState>()((set, get) => ({
   token: initialToken,
   code: null,
   denied: null,
   connection: 'connecting',
   sessions: [],
   agents: [],
   projects: [],
   openId: readOpenId(),
   drawerOpen: false,
   startedId: null,
   entries: null,
   entriesStart: 0,
   commands: [],
   options: [],
   draft: null,
   draftCommands: [],
   draftOptions: [],
   failure: null,
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
      set({ token: null, sessions: [], entries: null, limits: [], file: null });
      socket?.close();
   },
   send: (text) => {
      const sessionId = get().openId;
      if (sessionId) post({ type: 'send', sessionId, text });
   },
   cancel: () => {
      const sessionId = get().openId;
      if (sessionId) post({ type: 'cancel', sessionId });
   },
   prepare: (agentId, cwd) => {
      const draft = get().draft;
      if (draft?.agentId !== agentId || draft.cwd !== cwd)
         set({ draft: { agentId, cwd, sessionId: null }, draftCommands: [], draftOptions: [] });
      if (get().failure?.reason === 'start-failed') set({ failure: null });
      post({ type: 'prepare', agentId, cwd });
   },
   sendDraft: (text) => {
      const sessionId = get().draft?.sessionId;
      if (!sessionId) return;
      post({ type: 'send', sessionId, text });
      set({ startedId: sessionId, draft: null, draftCommands: [], draftOptions: [] });
      location.hash = `#/s/${encodeURIComponent(sessionId)}`;
   },
   answer: (entryId, response) => {
      const sessionId = get().openId;
      if (!sessionId) return;
      set({ failure: null });
      post({ type: 'answer', sessionId, entryId, response });
   },
   configure: (sessionId, configId, value) => {
      set({ failure: null });
      post({ type: 'configure', sessionId, configId, value });
   },
   openDrawer: () => set({ drawerOpen: true }),
   closeDrawer: () => set({ drawerOpen: false }),
   dismissFailure: () => set({ failure: null }),
   pushSubscribe: (subscription) => post({ type: 'push-subscribe', subscription }),
   openTransfer: (sessionId) => {
      set({ transfer: { sessionId, targets: null, busy: false }, failure: null });
      post({ type: 'transfer-options', sessionId });
   },
   closeTransfer: () => set({ transfer: null }),
   startTransfer: (agentId) => {
      const transfer = get().transfer;
      if (!transfer || transfer.busy) return;
      set({ transfer: { ...transfer, busy: true }, failure: null });
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
      // An archived chat is put away: the screen goes on to a new chat.
      if (archived && get().openId === sessionId) location.hash = '#/';
   },
   loadOlder: () => {
      const { openId, entries, entriesStart } = get();
      if (!openId || !entries || entriesStart === 0 || olderPending) return;
      olderPending = true;
      post({ type: 'older', sessionId: openId, before: entriesStart });
   },
}));

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
         post({ type: 'open', sessionId: state.openId, ...(state.entries ? { from: state.entriesStart } : {}) });
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
         if (message.sessionId !== state.openId) return;
         olderPending = false;
         useHub.setState({ entries: message.entries, entriesStart: message.start });
         return;
      case 'older':
         if (message.sessionId !== state.openId) return;
         olderPending = false;
         // A page that no longer joins the entries held, after the chat was reloaded meanwhile, is dropped.
         if (state.entries && message.start + message.entries.length === state.entriesStart)
            useHub.setState({ entries: [...message.entries, ...state.entries], entriesStart: message.start });
         return;
      case 'patch': {
         if (message.sessionId !== state.openId || !state.entries) return;
         const entries = state.entries.slice();
         // Changes to entries not loaded yet come with them when they are.
         for (const { index, entry } of message.changes) if (index >= state.entriesStart) entries[index - state.entriesStart] = entry;
         useHub.setState({ entries });
         return;
      }
      case 'commands':
         if (message.sessionId === state.openId) useHub.setState({ commands: message.commands });
         if (message.sessionId === state.draft?.sessionId) useHub.setState({ draftCommands: message.commands });
         return;
      case 'options':
         if (message.sessionId === state.openId) useHub.setState({ options: message.options });
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
         useHub.setState({ failure: message });
         if (state.transfer?.sessionId === message.sessionId) useHub.setState({ transfer: { ...state.transfer, busy: false } });
         return;
      case 'transfer-options':
         if (state.transfer?.sessionId === message.sessionId) useHub.setState({ transfer: { ...state.transfer, targets: message.targets } });
         return;
      case 'file':
         if (state.file?.sessionId === message.sessionId && state.file.path === message.path)
            useHub.setState({ file: { ...state.file, text: message.text, error: message.error } });
         return;
      case 'transferred':
         // The move ends in the new chat.
         if (state.transfer?.sessionId === message.from) {
            useHub.setState({ transfer: null });
            location.hash = `#/s/${encodeURIComponent(message.sessionId)}`;
         }
         return;
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
      olderPending = false;
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

window.addEventListener('hashchange', () => {
   const openId = readOpenId();
   if (openId === useHub.getState().openId) {
      useHub.setState({ drawerOpen: false });
      return;
   }
   olderPending = false;
   useHub.setState({ openId, drawerOpen: false, entries: null, entriesStart: 0, commands: [], options: [], failure: null, file: null });
   // Asked only now: a reply that came before openId changed would be taken for the previous chat.
   post({ type: 'open', sessionId: openId });
});

connect();
