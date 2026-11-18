import { Asterisk, Bot, Braces, Hexagon } from 'lucide-react';
import type { AgentKind } from '../../shared/protocol.ts';
import './agent-mark.css';

const ICONS = { claude: Asterisk, codex: Hexagon, opencode: Braces, other: Bot } as const;

export function AgentMark({ agent }: { agent: AgentKind }) {
   const Icon = ICONS[agent];
   return (
      <span className="agent-mark" data-agent={agent} aria-hidden="true">
         <Icon className="agent-mark-icon" strokeWidth={2.2} />
      </span>
   );
}
