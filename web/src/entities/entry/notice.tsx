import { memo } from 'react';
import type { Entry } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import './notice.css';

type NoticeEntry = Extract<Entry, { kind: 'notice' }>;

const TONES = { cancelled: 'info', 'turn-failed': 'error', 'steer-failed': 'error', 'history-cut': 'info' } as const;

export const Notice = memo(function Notice({ entry }: { entry: NoticeEntry }) {
   return (
      <p className="notice" data-tone={TONES[entry.code]} role={TONES[entry.code] === 'error' ? 'alert' : undefined}>
         <span className="notice-text">{t(`notice.${entry.code}`)}</span>
         {entry.detail && <span className="notice-detail">{entry.detail}</span>}
      </p>
   );
});
