import { Brain, CircleHelp, PenLine, SquareTerminal } from 'lucide-react';
import { memo } from 'react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { AgentMark } from '../../entities/session/agent-mark';
import { agentLabel, dotState, sessionTitle } from '../../entities/session/session-meta';
import { t } from '../../shared/i18n';
import { formatAgo } from '../../shared/lib/format';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import { StatusDot } from '../../shared/ui/status-dot';
import './session-item.css';

const ACTIVITY_ICONS = { thinking: Brain, tool: SquareTerminal, writing: PenLine, waiting: CircleHelp } as const;

export const SessionItem = memo(function SessionItem({ session, active, now }: { session: SessionSummary; active: boolean; now: number }) {
   const title = sessionTitle(session);
   const activity = session.online && session.status === 'running' ? (session.activity ?? 'thinking') : null;
   const ActivityIcon = activity ? ACTIVITY_ICONS[activity] : null;
   return (
      <a
         className="session-item"
         href={`#/s/${encodeURIComponent(session.id)}`}
         aria-current={active ? 'page' : undefined}
         data-active={active}
         data-running={Boolean(activity)}
      >
         <AgentMark agent={session.agent} />
         <span className="session-item-body">
            <span className="session-item-head">
               <span className="session-item-title" title={title}>
                  {title}
               </span>
               <time className="session-item-time" dateTime={new Date(session.updatedAt).toISOString()}>
                  {formatAgo(session.updatedAt, now)}
               </time>
            </span>
            {activity && ActivityIcon ? (
               <span className="session-item-activity" data-activity={activity}>
                  <ActivityIcon className="session-item-activity-icon" aria-hidden="true" />
                  <ShimmerText>{t(`activity.${activity}`)}</ShimmerText>
                  {session.preview && <span className="session-item-preview">{session.preview}</span>}
               </span>
            ) : (
               session.preview && <span className="session-item-preview">{session.preview}</span>
            )}
            <span className="session-item-meta">{agentLabel(session)}</span>
         </span>
         <StatusDot state={dotState(session)} />
      </a>
   );
});
