import type { AgentKind, Command, QuickAction } from '../../shared/protocol.ts';

export const AGENT_KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'other'];

// The slash command an action's text calls, if it calls one.
export function commandOf(action: QuickAction) {
   return /^\/(\S+)/.exec(action.text.trim())?.[1] ?? null;
}

// An action is offered for the chat's kind of agent, and not when it calls a command that agent does not have. Until
// the agent has listed its commands nothing is known to be missing.
export function offered(action: QuickAction, agent: AgentKind | null, commands: Command[]) {
   if (action.agents.length > 0 && (!agent || !action.agents.includes(agent))) return false;
   const command = commandOf(action);
   return !command || commands.length === 0 || commands.some((known) => known.name === command);
}
