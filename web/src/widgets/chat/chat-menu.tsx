import { Archive, ArchiveRestore, ArrowRightLeft } from 'lucide-react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import './chat-menu.css';

// What can be done with the open chat as a whole.
export function ChatMenu({ session, open, onClose }: { session: SessionSummary; open: boolean; onClose: () => void }) {
   const archive = useHub((state) => state.archive);
   const openTransfer = useHub((state) => state.openTransfer);
   const ArchiveIcon = session.archived ? ArchiveRestore : Archive;
   return (
      <Sheet open={open} title={t('chat.menu')} onClose={onClose}>
         <ul className="chat-menu">
            <li>
               <button
                  className="chat-menu-item"
                  type="button"
                  onClick={() => {
                     onClose();
                     openTransfer(session.id);
                  }}
               >
                  <ArrowRightLeft className="chat-menu-icon" aria-hidden="true" />
                  {t('transfer.title')}
               </button>
            </li>
            <li>
               <button
                  className="chat-menu-item"
                  type="button"
                  onClick={() => {
                     onClose();
                     archive(session.id, !session.archived);
                  }}
               >
                  <ArchiveIcon className="chat-menu-icon" aria-hidden="true" />
                  {t(session.archived ? 'chat.unarchive' : 'chat.archive')}
               </button>
            </li>
         </ul>
      </Sheet>
   );
}
