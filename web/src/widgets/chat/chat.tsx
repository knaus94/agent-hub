import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { projectFiles, useHub } from '../../entities/hub/hub-store';
import { ChatSessionId } from '../../entities/session/chat-session';
import { sendWithAttachments, type Attachment } from '../../features/composer/attachments';
import { Composer } from '../../features/composer/composer';
import { ChatSettings } from '../../features/chat-settings/chat-settings';
import { QuickBar } from '../../features/quick-actions/quick-bar';
import { QuickManager } from '../../features/quick-actions/quick-manager';
import { VoiceInput } from '../../features/voice-input/voice-input';
import { t } from '../../shared/i18n';
import { MarkdownFiles } from '../../shared/ui/markdown';
import { ChatHeader } from './chat-header';
import { PlanPanel } from './plan-panel';
import { Timeline } from './timeline';
import './chat.css';

const NONE: never[] = [];

function FailureBar({ sessionId }: { sessionId: string }) {
   const failure = useHub((state) => state.failures[sessionId]);
   const dismiss = useHub((state) => state.dismissFailure);
   if (!failure) return null;
   return (
      <div className="chat-failure" role="alert">
         <span className="chat-failure-text">{t(`failed.${failure.reason}`)}</span>
         <button
            className="chat-failure-dismiss"
            type="button"
            onClick={() => dismiss(sessionId)}
            aria-label={t('failed.dismiss')}
            title={t('failed.dismiss')}
         >
            <X className="chat-failure-icon" aria-hidden="true" />
         </button>
      </div>
   );
}

export function Chat({ session }: { session: SessionSummary }) {
   const chat = useHub((state) => state.chats[session.id]);
   const loadOlder = useHub((state) => state.loadOlder);
   const send = useHub((state) => state.send);
   const cancel = useHub((state) => state.cancel);
   const configure = useHub((state) => state.configure);
   const failure = useHub((state) => state.failures[session.id]);
   const entries = chat?.entries ?? null;
   const commands = chat?.commands ?? NONE;
   const options = chat?.options ?? NONE;
   const voice = useHub((state) => state.voice);
   const openFile = useHub((state) => state.openFile);
   // Kept the same between renders: every message reads it, and a new one would draw them all again.
   // Kept the same too: the timeline asks for older entries from an effect that would run again for a new one.
   const older = useCallback(() => loadOlder(session.id), [loadOlder, session.id]);
   const files = useMemo(() => ({ open: (path: string) => openFile(session.id, path), base: '' }), [session.id, openFile]);
   // Kept the same too: the composer looks for files again whenever it changes.
   const findFiles = useCallback((query: string) => projectFiles(session.id, query), [session.id]);
   const running = session.online && session.status === 'running';
   // A slash command sent during a turn waits in the hub for the turn to end; until it shows in the chat, say so.
   const [queued, setQueued] = useState<string | null>(null);
   // Reading further up folds the composer away for more room; it comes back at the end, and stays while typed in.
   const [reading, setReading] = useState(false);
   const [typing, setTyping] = useState(false);
   const docked = !reading || typing;
   const lastUser = entries?.findLast((entry) => entry.kind === 'user');
   if (queued && ((lastUser?.kind === 'user' && lastUser.text.trim() === queued) || failure)) setQueued(null);

   const onSend = (text: string, attachments: Attachment[] = []) => {
      if (attachments.length > 0) return sendWithAttachments(session.id, text, attachments);
      const name = text.trim().split(/\s/)[0];
      if (running && commands.some((command) => `/${command.name}` === name)) setQueued(text.trim());
      send(session.id, text);
   };

   return (
      <section className="chat">
         <ChatHeader session={session} />
         <ChatSessionId.Provider value={session.id}>
            <MarkdownFiles.Provider value={files}>
               <Timeline
                  entries={entries}
                  start={chat?.start ?? 0}
                  session={session}
                  onOlder={older}
                  onFollow={(following) => setReading(!following)}
               />
            </MarkdownFiles.Provider>
         </ChatSessionId.Provider>
         <div
            className="chat-dock"
            data-docked={docked}
            inert={!docked}
            onFocus={() => setTyping(true)}
            // The window losing focus, as GNOME's input source switcher takes it for a moment, is not leaving the field.
            onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && document.hasFocus() && setTyping(false)}
         >
            <div className="chat-footer">
               <FailureBar sessionId={session.id} />
               {session.plan.length > 0 && <PlanPanel plan={session.plan} />}
               <Composer
                  placeholder={t(running ? 'composer.placeholder.running' : 'composer.placeholder')}
                  sendLabel={t(running ? 'composer.steer' : 'composer.send')}
                  onSend={onSend}
                  running={running}
                  onStop={() => cancel(session.id)}
                  disabled={!session.online}
                  note={!session.online ? t('composer.offline') : queued ? t('composer.queued', { command: queued.split(/\s/)[0] }) : null}
                  commands={commands}
                  attach={session.online ? session.attach : null}
                  findFiles={session.attach.links ? findFiles : undefined}
                  voice={voice ? (append) => <VoiceInput onText={append} /> : undefined}
                  quick={(insert) => (
                     <QuickBar agent={session.agent} commands={commands} onSend={onSend} onInsert={insert} disabled={!session.online} />
                  )}
                  accessory={
                     <div className="picker-row">
                        <ChatSettings
                           options={options}
                           onChange={(configId, value) => configure(session.id, configId, value)}
                           disabled={!session.online}
                        />
                        <QuickManager commands={commands} />
                     </div>
                  }
               />
            </div>
         </div>
      </section>
   );
}
