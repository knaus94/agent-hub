import { Archive, ArchiveRestore, ArrowRightLeft, Columns2 } from 'lucide-react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { roomBeside, shownPanes, useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import './chat-menu.css';

// What can be done with a chat as a whole, from its own bar or from its row in the list on a touch screen.
export function ChatMenu({ session, open, onClose }: { session: SessionSummary; open: boolean; onClose: () => void }) {
   const archive = useHub((state) => state.archive);
   const openTransfer = useHub((state) => state.openTransfer);
   const openBeside = useHub((state) => state.openBeside);
   const focused = useHub((state) => state.focused);
   const beside = useHub(
      (state) =>
         roomBeside(state) && !shownPanes(state.panes.length, state.focused, state.shown).some((index) => state.panes[index] === session.id),
   );
   const ArchiveIcon = session.archived ? ArchiveRestore : Archive;
   return (
      <Sheet open={open} title={t('chat.menu')} onClose={onClose}>
         <ul className="chat-menu">
            {beside && (
               <li>
                  <button
                     className="chat-menu-item"
                     type="button"
                     onClick={() => {
                        onClose();
                        openBeside(session.id, focused + 1);
                     }}
                  >
                     <Columns2 className="chat-menu-icon" aria-hidden="true" />
                     {t('pane.beside')}
                  </button>
               </li>
            )}
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
