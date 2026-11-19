import { ArrowRightLeft } from 'lucide-react';
import { memo, useContext } from 'react';
import type { Entry } from '../../shared/protocol.ts';
import { useHub } from '../hub/hub-store';
import { ChatSessionId } from '../session/chat-session';
import { locale, t } from '../../shared/i18n';
import './notice.css';

type NoticeEntry = Extract<Entry, { kind: 'notice' }>;

const TONES = {
   cancelled: 'info',
   'turn-failed': 'error',
   'rate-limited': 'error',
   'steer-failed': 'error',
   'history-cut': 'info',
   'tool-unfinished': 'info',
} as const;

const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// When a limit resets: the time today, the date and time later.
function resetsAt(value: string) {
   const when = new Date(value);
   if (Number.isNaN(when.getTime())) return value;
   return when.toDateString() === new Date().toDateString() ? clock.format(when) : day.format(when);
}

// A failed turn, an account out of its limits above all, offers to go on with another agent.
export const Notice = memo(function Notice({ entry }: { entry: NoticeEntry }) {
   const sessionId = useContext(ChatSessionId);
   const openTransfer = useHub((state) => state.openTransfer);
   const tone = TONES[entry.code];
   const detail =
      entry.code === 'rate-limited' && entry.detail ? t('notice.rate-limited.until', { when: resetsAt(entry.detail) }) : entry.detail;
   const movable = (entry.code === 'turn-failed' || entry.code === 'rate-limited') && sessionId !== '';
   return (
      <div className="notice" data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
         <p className="notice-line">
            <span className="notice-text">{t(`notice.${entry.code}`)}</span>
            {detail && <span className="notice-detail">{detail}</span>}
         </p>
         {movable && (
            <button className="notice-action" type="button" onClick={() => openTransfer(sessionId)}>
               <ArrowRightLeft className="notice-action-icon" aria-hidden="true" />
               {t('notice.transfer')}
            </button>
         )}
      </div>
   );
});
