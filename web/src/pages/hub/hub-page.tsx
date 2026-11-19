import { LoaderCircle, MessageSquareDashed } from 'lucide-react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { FileViewer } from '../../features/file-viewer/file-viewer';
import { useWide } from '../../shared/lib/use-wide';
import { AppBar } from '../../widgets/app-bar/app-bar';
import { Chat } from '../../widgets/chat/chat';
import { Drawer } from '../../widgets/drawer/drawer';
import { SessionList } from '../../widgets/session-list/session-list';
import { NewChatPage } from '../new-chat/new-chat-page';
import './hub-page.css';

function Placeholder({ waiting }: { waiting: boolean }) {
   const Icon = waiting ? LoaderCircle : MessageSquareDashed;
   return (
      <section className="hub-page-placeholder-screen">
         <AppBar>{null}</AppBar>
         <div className="hub-page-placeholder" role={waiting ? 'status' : undefined}>
            <Icon className="hub-page-placeholder-icon" data-waiting={waiting} aria-hidden="true" />
            <p className="hub-page-placeholder-title">{t(waiting ? 'chat.starting' : 'chat.missing')}</p>
            {!waiting && <p className="hub-page-placeholder-body">{t('chat.missing.body')}</p>}
         </div>
      </section>
   );
}

// The screen is always a chat, as in a chat app: an open one, or a new one. The list sits beside it on a wide screen
// and behind the menu on a phone.
export function HubPage() {
   const wide = useWide();
   const openId = useHub((state) => state.openId);
   const startedId = useHub((state) => state.startedId);
   const sessions = useHub((state) => state.sessions);
   const connection = useHub((state) => state.connection);
   const open = sessions.find((session) => session.id === openId) ?? null;
   const main = open ? (
      <Chat key={open.id} session={open} />
   ) : openId ? (
      <Placeholder waiting={connection !== 'open' || openId === startedId} />
   ) : (
      <NewChatPage />
   );

   return (
      <div className="hub-page" data-layout={wide ? 'split' : 'single'}>
         {connection !== 'open' && (
            <p className="hub-page-banner" role="status">
               {t(connection === 'connecting' ? 'connection.connecting' : 'connection.lost')}
            </p>
         )}
         {wide && (
            <aside className="hub-page-sidebar">
               <SessionList />
            </aside>
         )}
         <main className="hub-page-main">{main}</main>
         <FileViewer />
         {!wide && <Drawer />}
      </div>
   );
}
