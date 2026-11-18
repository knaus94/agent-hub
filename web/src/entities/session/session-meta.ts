import type { SessionSummary } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import type { DotState } from '../../shared/ui/status-dot';

export function agentLabel(session: SessionSummary) {
   const name = t(`agent.${session.agent}`);
   return session.account ? `${name} · ${session.account}` : name;
}

export function sessionTitle(session: SessionSummary) {
   return session.title?.trim() || t('list.untitled');
}

export function dotState(session: SessionSummary): DotState {
   if (!session.online) return 'offline';
   return session.status;
}
