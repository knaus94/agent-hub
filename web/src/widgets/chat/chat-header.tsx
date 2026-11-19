import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { agentLabel, dotState, sessionTitle } from '../../entities/session/session-meta';
import { t } from '../../shared/i18n';
import { projectName } from '../../shared/lib/format';
import { StatusDot } from '../../shared/ui/status-dot';
import { AppBar } from '../app-bar/app-bar';
import { ChatMenu } from './chat-menu';
import { ContextMeter } from './context-meter';
import './chat-header.css';

const STATUS_KEYS = { running: 'status.running', idle: 'status.idle', offline: 'status.offline' } as const;

// The chat's title is in the list beside it, and its model and mode in the composer's chips and settings; the top
// shows which agent and project the chat runs on and how full its context is.
export function ChatHeader({ session }: { session: SessionSummary }) {
   const state = dotState(session);
   const source = [agentLabel(session), projectName(session.cwd)].filter(Boolean).join(' · ');
   const [menu, setMenu] = useState(false);
   return (
      <>
         <AppBar action={{ icon: Ellipsis, label: t('chat.menu'), onClick: () => setMenu(true) }}>
            <div className="chat-header">
               <h1 className="visually-hidden">{sessionTitle(session)}</h1>
               <span className="chat-header-row">
                  <StatusDot state={state} />
                  <span className="visually-hidden">{t(STATUS_KEYS[state])}</span>
                  <span className="chat-header-source" title={source}>
                     {source}
                  </span>
               </span>
               {session.context && <ContextMeter used={session.context.used} size={session.context.size} />}
            </div>
         </AppBar>
         <ChatMenu session={session} open={menu} onClose={() => setMenu(false)} />
      </>
   );
}
