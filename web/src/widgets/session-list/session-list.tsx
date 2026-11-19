import { Archive, ArchiveRestore, ChevronDown, Columns2, LogOut, MessagesSquare, SquarePen } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { roomBeside, shownPanes, useHub } from '../../entities/hub/hub-store';
import { CHAT_DRAG } from '../../entities/session/chat-drag';
import { NotificationsToggle } from '../../features/notifications/notifications-toggle';
import { t } from '../../shared/i18n';
import { projectName } from '../../shared/lib/format';
import { useNow } from '../../shared/lib/use-now';
import { LimitsPanel } from './limits-panel';
import { SessionItem } from './session-item';
import './session-list.css';

type Group = { name: string | null; sessions: SessionSummary[] };

// Sessions arrive newest first, so groups come out ordered by their latest activity.
function groupByProject(sessions: SessionSummary[]) {
   const groups = new Map<string | null, Group>();
   for (const session of sessions) {
      const name = projectName(session.cwd);
      let group = groups.get(name);
      if (!group) groups.set(name, (group = { name, sessions: [] }));
      group.sessions.push(session);
   }
   return [...groups.values()];
}

// A chat in the list, with its buttons: always there on a touch screen, on hover or focus with a mouse. Dragged onto
// the chats, or clicked with Ctrl, it opens beside them.
function SessionRow({ session, openId, now }: { session: SessionSummary; openId: string | null; now: number }) {
   const archive = useHub((state) => state.archive);
   const openBeside = useHub((state) => state.openBeside);
   const focused = useHub((state) => state.focused);
   const room = useHub(roomBeside);
   const shown = useHub((state) =>
      shownPanes(state.panes.length, state.focused, state.shown).some((index) => state.panes[index] === session.id),
   );
   const label = t(session.archived ? 'chat.unarchive' : 'chat.archive');
   const Icon = session.archived ? ArchiveRestore : Archive;
   const beside = () => openBeside(session.id, focused + 1);
   return (
      <li
         className="session-list-row"
         onDragStart={(event) => {
            event.dataTransfer.setData(CHAT_DRAG, session.id);
            event.dataTransfer.effectAllowed = 'move';
         }}
         onClick={(event) => {
            // Without room, Ctrl opens the chat in a new browser tab, as for any link.
            if (!(event.ctrlKey || event.metaKey) || !(room || shown) || !(event.target instanceof Element) || !event.target.closest('a'))
               return;
            event.preventDefault();
            beside();
         }}
      >
         <SessionItem session={session} active={session.id === openId} shown={shown} now={now} />
         <span className="session-list-row-actions">
            {room && !shown && (
               <button className="session-list-row-action" type="button" onClick={beside} aria-label={t('pane.beside')} title={t('pane.beside')}>
                  <Columns2 className="session-list-row-action-icon" aria-hidden="true" />
               </button>
            )}
            <button
               className="session-list-row-action"
               type="button"
               onClick={() => archive(session.id, !session.archived)}
               aria-label={label}
               title={label}
            >
               <Icon className="session-list-row-action-icon" aria-hidden="true" />
            </button>
         </span>
      </li>
   );
}

function ProjectGroup({ group, openId, now }: { group: Group; openId: string | null; now: number }) {
   const headingId = useId();
   return (
      <section className="session-list-group" aria-labelledby={headingId}>
         <h2 className="session-list-group-title" id={headingId}>
            {group.name ?? t('list.noProject')}
         </h2>
         <ul className="session-list-items">
            {group.sessions.map((session) => (
               <SessionRow key={session.id} session={session} openId={openId} now={now} />
            ))}
         </ul>
      </section>
   );
}

// Archived chats wait under one fold at the end of the list; it starts open when the open chat is one of them.
function ArchiveSection({ sessions, openId, now }: { sessions: SessionSummary[]; openId: string | null; now: number }) {
   const [open, setOpen] = useState(() => sessions.some((session) => session.id === openId));
   const listId = useId();
   return (
      <section className="session-list-archive">
         <button
            className="session-list-archive-toggle"
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
         >
            <Archive className="session-list-archive-icon" aria-hidden="true" />
            <span className="session-list-archive-label">{t('list.archive')}</span>
            <span className="session-list-archive-count">{sessions.length}</span>
            <ChevronDown className="session-list-archive-chevron" aria-hidden="true" />
         </button>
         {open && (
            <ul className="session-list-items" id={listId}>
               {sessions.map((session) => (
                  <SessionRow key={session.id} session={session} openId={openId} now={now} />
               ))}
            </ul>
         )}
      </section>
   );
}

export function SessionList() {
   const sessions = useHub((state) => state.sessions);
   const openId = useHub((state) => state.openId);
   const logout = useHub((state) => state.logout);
   const now = useNow(30_000);
   const active = useMemo(() => sessions.filter((session) => !session.archived), [sessions]);
   const archived = useMemo(() => sessions.filter((session) => session.archived), [sessions]);
   const groups = useMemo(() => groupByProject(active), [active]);
   const running = active.filter((session) => session.online && session.status === 'running').length;

   return (
      <nav className="session-list" aria-label={t('list.title')}>
         <header className="session-list-header">
            <span className="session-list-brand">
               <span className="session-list-logo" data-running={running > 0} aria-hidden="true" />
               {t('app.name')}
            </span>
            {running > 0 && <span className="session-list-running">{t('list.running', { count: running })}</span>}
            <NotificationsToggle />
            <button className="session-list-logout" type="button" onClick={logout} aria-label={t('app.logout')} title={t('app.logout')}>
               <LogOut className="session-list-logout-icon" aria-hidden="true" />
            </button>
         </header>
         <a className="session-list-new" href="#/" aria-current={openId === null ? 'page' : undefined}>
            <SquarePen className="session-list-new-icon" aria-hidden="true" />
            {t('list.new')}
         </a>
         <div className="session-list-groups">
            {active.length === 0 ? (
               <div className="session-list-empty">
                  <MessagesSquare className="session-list-empty-icon" aria-hidden="true" />
                  <p className="session-list-empty-title">{t('list.empty.title')}</p>
                  <p className="session-list-empty-body">{t('list.empty.body')}</p>
               </div>
            ) : (
               groups.map((group) => <ProjectGroup key={group.name ?? ''} group={group} openId={openId} now={now} />)
            )}
            {archived.length > 0 && <ArchiveSection sessions={archived} openId={openId} now={now} />}
         </div>
         <LimitsPanel now={now} />
      </nav>
   );
}
