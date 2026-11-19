// What the hub sends to the browser and back; internal/protocol/protocol.go is its Go twin and must match it field for
// field. The browser only ever sees these built fields, never raw ACP messages, which carry MCP configs and credentials.

export type AgentKind = 'claude' | 'codex' | 'opencode' | 'other';

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// A picture in a chat, its data in base64.
export type Image = { mimeType: string; data: string };

export type ToolContent =
   | { type: 'text'; text: string }
   | { type: 'diff'; path: string; oldText: string | null; newText: string }
   | { type: 'terminal' }
   | ({ type: 'image' } & Image);

// rate-limited: the account is out of its limits; detail is when they reset, RFC 3339.
export type NoticeCode = 'cancelled' | 'turn-failed' | 'rate-limited' | 'steer-failed' | 'history-cut';

// Where a chat can be moved: "full" continues the whole conversation on another Claude account, "retell" starts a
// new chat with its history.
export type TransferTarget = { agentId: string; mode: 'full' | 'retell' };

export type QuestionOption = { id: string; label: string; kind: string | null; description: string | null };

export type QuestionField = {
   key: string;
   kind: 'choice' | 'text';
   type: string;
   title: string | null;
   description: string | null;
   multiple: boolean;
   options: QuestionOption[];
};

// An agent's request for the user: a permission, a form (the questions of Claude's AskUserQuestion), or a link to open.
export type QuestionEntry = {
   kind: 'question';
   id: string;
   mode: 'permission' | 'form' | 'url';
   message: string;
   options: QuestionOption[];
   fields: QuestionField[];
   url: string | null;
   status: 'pending' | 'answered' | 'cancelled';
   answer: string | null;
};

export type QuestionResponse =
   { optionId: string } | { action: 'decline' | 'cancel' } | { action: 'accept'; content?: Record<string, string | string[]> };

export type Command = { name: string; description: string; hint: string | null };

// A chat setting as the agent offers it, the way Zed shows it: a choice ("select") such as the model or the reasoning
// effort (category "thought_level"), or a switch ("boolean") such as fast mode.
export type ConfigOption = {
   id: string;
   name: string;
   category: string | null;
   type: 'select' | 'boolean';
   current: string | boolean | null;
   choices: { value: string; name: string; description: string | null }[];
};

export type Entry =
   // images: the pictures sent with the message.
   | { kind: 'user'; id: string; text: string; origin: 'zed' | 'hub' | 'history'; steer: boolean; images?: Image[] }
   | { kind: 'agent'; id: string; text: string }
   | { kind: 'thought'; id: string; text: string }
   | {
        kind: 'tool';
        id: string;
        title: string;
        toolKind: string;
        status: ToolStatus;
        command: string | null;
        output: string | null;
        exitCode: number | null;
        content: ToolContent[];
     }
   | { kind: 'notice'; id: string; code: NoticeCode; detail: string | null }
   | QuestionEntry;

export type PlanItem = { content: string; status: 'pending' | 'in_progress' | 'completed' };

export type SessionSummary = {
   id: string;
   agent: AgentKind;
   label: string;
   account: string | null;
   cwd: string | null;
   title: string | null;
   status: 'running' | 'idle';
   activity: 'thinking' | 'tool' | 'writing' | 'waiting' | null;
   preview: string | null;
   online: boolean;
   updatedAt: number;
   model: string | null;
   mode: string | null;
   context: { used: number; size: number } | null;
   plan: PlanItem[];
   // Archived here or in Zed: listed apart, under the archive.
   archived: boolean;
};

// A button the user made: it sends its text to the chat, or puts it in the composer to finish. agents lists the
// kinds of agent it is offered for; empty means every agent.
export type QuickAction = { id: string; label: string; text: string; agents: AgentKind[]; send: boolean };

// A subscription account the agents run on. error: "login" when its CLI has to sign in again, "unavailable" when the
// service did not answer; limits are then the last ones read, at checked.
export type LimitAccount = {
   id: string;
   agent: AgentKind;
   email: string;
   error?: 'login' | 'unavailable';
   checked: number;
   limits: Limit[];
};

// One limit of an account: the whole subscription's week, or a model's own share. Times are Unix milliseconds.
export type Limit = { kind: 'week' | 'model'; model?: string; percent: number; resetsAt: number; window: number; active: boolean };

// Why a Markdown file of a chat's project was not given: no such file, not Markdown or outside the project, too large.
export type FileError = 'missing' | 'denied' | 'large';

export type AgentOption = { id: string; agent: AgentKind; label: string; account: string | null };

export type ProjectOption = { path: string; name: string };

// "token": the saved token is not (or no longer) valid; "code": a wrong code; "locked": too many wrong codes in a row.
export type DeniedReason = 'token' | 'code' | 'locked';

export type ServerMessage =
   | {
        type: 'ready';
        sessions: SessionSummary[];
        agents: AgentOption[];
        projects: ProjectOption[];
        quick: QuickAction[];
        voice: boolean;
        push: string;
     }
   // Voice input: a ticket to upload one recording, then its text a piece at a time, then its end.
   | { type: 'transfer-options'; sessionId: string; targets: TransferTarget[] }
   | { type: 'transferred'; from: string; sessionId: string }
   | { type: 'file'; sessionId: string; path: string; text: string | null; error: FileError | null }
   | { type: 'voice-ticket'; ticket: string }
   | { type: 'voice-text'; ticket: string; text: string }
   | { type: 'voice-end'; ticket: string; error?: string }
   | { type: 'quick'; actions: QuickAction[] }
   | { type: 'limits'; accounts: LimitAccount[] }
   | { type: 'denied'; reason: DeniedReason }
   | { type: 'session'; token: string }
   | { type: 'sessions'; sessions: SessionSummary[] }
   // The chat's entries from index start on; "older" is the page that ends where they begin.
   | { type: 'timeline'; sessionId: string; start: number; entries: Entry[] }
   | { type: 'older'; sessionId: string; start: number; entries: Entry[] }
   | { type: 'patch'; sessionId: string; changes: { index: number; entry: Entry }[] }
   | { type: 'prepared'; agentId: string; cwd: string; sessionId: string }
   | { type: 'commands'; sessionId: string; commands: Command[] }
   | { type: 'options'; sessionId: string; options: ConfigOption[] }
   | {
        type: 'failed';
        sessionId: string;
        reason:
           | 'offline'
           | 'steer-failed'
           | 'send-failed'
           | 'start-failed'
           | 'answer-failed'
           | 'configure-failed'
           | 'transfer-failed'
           | 'transfer-running';
     };

export type ClientMessage =
   | { type: 'auth'; token: string }
   | { type: 'auth'; code: string }
   | { type: 'logout' }
   // The chats on screen, side by side. from: the first entry this browser already holds, kept on a reconnect.
   | { type: 'view'; panes: { sessionId: string; from?: number }[] }
   | { type: 'older'; sessionId: string; before: number }
   | { type: 'archive'; sessionId: string; archived: boolean }
   | { type: 'quick'; actions: QuickAction[] }
   | { type: 'send'; sessionId: string; text: string }
   | { type: 'cancel'; sessionId: string }
   | { type: 'prepare'; agentId: string; cwd: string }
   | { type: 'answer'; sessionId: string; entryId: string; response: QuestionResponse }
   | { type: 'configure'; sessionId: string; configId: string; value: string | boolean }
   | { type: 'voice' }
   // The agents' limits: sent at once, and read anew when they are older than a few minutes.
   | { type: 'limits' }
   | { type: 'transfer-options'; sessionId: string }
   | { type: 'transfer'; sessionId: string; agentId: string }
   // A Markdown file of the chat's project, by its path in the project, its absolute path or one starting with ~/.
   | { type: 'file'; sessionId: string; path: string }
   // Whether the page is on screen: a chat open on a visible page is not notified of.
   | { type: 'visible'; visible: boolean }
   | { type: 'push-subscribe'; subscription: PushSubscriptionJSON }
   | { type: 'push-unsubscribe'; endpoint: string };
