import { FileText } from 'lucide-react';
import { memo } from 'react';
import type { Entry } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { ImageGallery } from '../../shared/ui/image-gallery';
import './user-message.css';

type UserEntry = Extract<Entry, { kind: 'user' }>;

// Where a message came from does not matter in the chat; a correction sent into a running turn does.
export const UserMessage = memo(function UserMessage({ entry }: { entry: UserEntry }) {
   return (
      <div className="user-message" data-steer={entry.steer}>
         {entry.images && entry.images.length > 0 && <ImageGallery images={entry.images} />}
         {entry.files && entry.files.length > 0 && (
            <ul className="user-message-files" aria-label={t('attach.list')}>
               {entry.files.map((file, index) => (
                  <li key={index} className="user-message-file" title={file}>
                     <FileText className="user-message-file-icon" aria-hidden="true" />
                     <span className="user-message-file-name">{file}</span>
                  </li>
               ))}
            </ul>
         )}
         {entry.text && <p className="user-message-bubble">{entry.text}</p>}
         {entry.steer && <span className="user-message-tag">{t('entry.user.steer')}</span>}
      </div>
   );
});
