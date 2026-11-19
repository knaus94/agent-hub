import { FileCode, FileText, X } from 'lucide-react';
import { t } from '../../shared/i18n';
import { attachmentName, type Attachment } from './attachments';
import './attachment-list.css';

// The attachments of the message being written, each with a button to take it off.
export function AttachmentList({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (id: string) => void }) {
   if (attachments.length === 0) return null;
   return (
      <ul className="attachment-list" aria-label={t('attach.list')}>
         {attachments.map((attachment) => {
            const name = attachmentName(attachment);
            return (
               <li
                  key={attachment.id}
                  className="attachment"
                  data-kind={attachment.kind}
                  title={attachment.kind === 'link' ? attachment.path : name}
               >
                  {attachment.kind === 'picture' ? (
                     <img className="attachment-picture" src={attachment.url} alt={name} />
                  ) : (
                     <>
                        {attachment.kind === 'link' ? (
                           <FileCode className="attachment-icon" aria-hidden="true" />
                        ) : (
                           <FileText className="attachment-icon" aria-hidden="true" />
                        )}
                        <span className="attachment-name">{name}</span>
                     </>
                  )}
                  <button
                     className="attachment-remove"
                     type="button"
                     onClick={() => onRemove(attachment.id)}
                     aria-label={t('attach.remove', { name })}
                     title={t('attach.remove', { name })}
                  >
                     <X className="attachment-remove-icon" aria-hidden="true" />
                  </button>
               </li>
            );
         })}
      </ul>
   );
}
