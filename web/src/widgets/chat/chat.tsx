import { X } from 'lucide-react';
import { useState } from 'react';
import type { SessionSummary } from '../../shared/protocol.ts';
import { useHub } from '../../entities/hub/hub-store';
import { Composer } from '../../features/composer/composer';
import { ChatSettings } from '../../features/chat-settings/chat-settings';
import { QuickBar } from '../../features/quick-actions/quick-bar';
import { QuickManager } from '../../features/quick-actions/quick-manager';
import { VoiceInput } from '../../features/voice-input/voice-input';
import { t } from '../../shared/i18n';
import { ChatHeader } from './chat-header';
import { PlanPanel } from './plan-panel';
import { Timeline } from './timeline';
import './chat.css';

function FailureBar({ sessionId }: { sessionId: string }) {
   const failure = useHub((state) => state.failure);
   const dismiss = useHub((state) => state.dismissFailure);
   if (failure?.sessionId !== sessionId) return null;
   return (
      <div className="chat-failure" role="alert">
         <span className="chat-failure-text">{t(`failed.${failure.reason}`)}</span>
         <button className="chat-failure-dismiss" type="button" onClick={dismiss} aria-label={t('failed.dismiss')} title={t('failed.dismiss')}>
            <X className="chat-failure-icon" aria-hidden="true" />
         </button>
      </div>
   );
}

export function Chat({ session }: { session: SessionSummary }) {
   const entries = useHub((state) => state.entries);
   const entriesStart = useHub((state) => state.entriesStart);
   const loadOlder = useHub((state) => state.loadOlder);
   const send = useHub((state) => state.send);
   const cancel = useHub((state) => state.cancel);
   const commands = useHub((state) => state.commands);
   const options = useHub((state) => state.options);
   const configure = useHub((state) => state.configure);
   const failure = useHub((state) => state.failure);
   const voice = useHub((state) => state.voice);
   const running = session.online && session.status === 'running';
   // A slash command sent during a turn waits in the hub for the turn to end; until it shows in the chat, say so.
   const [queued, setQueued] = useState<string | null>(null);
   const lastUser = entries?.findLast((entry) => entry.kind === 'user');
   if (queued && ((lastUser?.kind === 'user' && lastUser.text.trim() === queued) || failure?.sessionId === session.id)) setQueued(null);

   const onSend = (text: string) => {
      const name = text.trim().split(/\s/)[0];
      if (running && commands.some((command) => `/${command.name}` === name)) setQueued(text.trim());
      send(text);
   };

   return (
      <section className="chat">
         <ChatHeader session={session} />
         <Timeline entries={entries} start={entriesStart} session={session} onOlder={loadOlder} />
         <div className="chat-footer">
            <FailureBar sessionId={session.id} />
            {session.plan.length > 0 && <PlanPanel plan={session.plan} />}
            <Composer
               placeholder={t(running ? 'composer.placeholder.running' : 'composer.placeholder')}
               sendLabel={t(running ? 'composer.steer' : 'composer.send')}
               onSend={onSend}
               running={running}
               onStop={cancel}
               disabled={!session.online}
               note={!session.online ? t('composer.offline') : queued ? t('composer.queued', { command: queued.split(/\s/)[0] }) : null}
               commands={commands}
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
      </section>
   );
}
