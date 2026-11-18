import { memo } from 'react';
import type { Entry } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import './user-message.css';

type UserEntry = Extract<Entry, { kind: 'user' }>;

// Where a message came from does not matter in the chat; a correction sent into a running turn does.
export const UserMessage = memo(function UserMessage({ entry }: { entry: UserEntry }) {
   return (
      <div className="user-message" data-steer={entry.steer}>
         <p className="user-message-bubble">{entry.text}</p>
         {entry.steer && <span className="user-message-tag">{t('entry.user.steer')}</span>}
      </div>
   );
});
