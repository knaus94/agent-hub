// What the hub sends to the browser and back; internal/protocol/protocol.go is its Go twin and must match it field for
// field. The browser only ever sees these built fields, never raw ACP messages, which carry MCP configs and credentials.

export type AgentKind = 'claude' | 'codex' | 'opencode' | 'other';

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type ToolContent =
   { type: 'text'; text: string } | { type: 'diff'; path: string; oldText: string | null; newText: string } | { type: 'terminal' };

export type NoticeCode = 'cancelled' | 'turn-failed' | 'steer-failed' | 'history-cut';

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
   | { kind: 'user'; id: string; text: string; origin: 'zed' | 'hub' | 'history'; steer: boolean }
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
   | { type: 'voice-ticket'; ticket: string }
   | { type: 'voice-text'; ticket: string; text: string }
   | { type: 'voice-end'; ticket: string; error?: string }
   | { type: 'quick'; actions: QuickAction[] }
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
        reason: 'offline' | 'steer-failed' | 'send-failed' | 'start-failed' | 'answer-failed' | 'configure-failed';
     };

export type ClientMessage =
   | { type: 'auth'; token: string }
   | { type: 'auth'; code: string }
   | { type: 'logout' }
   // from: the first entry this browser already holds, kept on a reconnect.
   | { type: 'open'; sessionId: string | null; from?: number }
   | { type: 'older'; sessionId: string; before: number }
   | { type: 'archive'; sessionId: string; archived: boolean }
   | { type: 'quick'; actions: QuickAction[] }
   | { type: 'send'; sessionId: string; text: string }
   | { type: 'cancel'; sessionId: string }
   | { type: 'prepare'; agentId: string; cwd: string }
   | { type: 'answer'; sessionId: string; entryId: string; response: QuestionResponse }
   | { type: 'configure'; sessionId: string; configId: string; value: string | boolean }
   | { type: 'voice' }
   // Whether the page is on screen: a chat open on a visible page is not notified of.
   | { type: 'visible'; visible: boolean }
   | { type: 'push-subscribe'; subscription: PushSubscriptionJSON }
   | { type: 'push-unsubscribe'; endpoint: string };
