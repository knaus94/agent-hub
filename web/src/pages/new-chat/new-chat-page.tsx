import { useEffect, useState } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { AgentMark } from '../../entities/session/agent-mark';
import { ChatSettings } from '../../features/chat-settings/chat-settings';
import { Composer } from '../../features/composer/composer';
import { QuickBar } from '../../features/quick-actions/quick-bar';
import { QuickManager } from '../../features/quick-actions/quick-manager';
import { VoiceInput } from '../../features/voice-input/voice-input';
import { AgentPicker } from '../../features/pickers/agent-picker';
import { ProjectPicker } from '../../features/pickers/project-picker';
import { t } from '../../shared/i18n';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import { AppBar } from '../../widgets/app-bar/app-bar';
import './new-chat-page.css';

const AGENT_KEY = 'agent-hub.new.agent';
const PROJECT_KEY = 'agent-hub.new.project';
// Picking through agents and projects should not start an agent for each one passed on the way.
const PREPARE_DELAY = 400;

// The choice made last time, while it is still on offer.
function pick(chosen: string | null, key: string, offered: string[]) {
   if (chosen && offered.includes(chosen)) return chosen;
   const remembered = localStorage.getItem(key);
   return remembered && offered.includes(remembered) ? remembered : (offered[0] ?? null);
}

// A new chat is an empty chat: pick the agent in the title and the project in the composer, then just write. The hub
// prepares the chat at once, as Zed does for a new thread, so the agent's own settings and commands are offered here.
export function NewChatPage() {
   const agents = useHub((state) => state.agents);
   const projects = useHub((state) => state.projects);
   const failure = useHub((state) => state.failures['']);
   const connected = useHub((state) => state.connection === 'open');
   const draft = useHub((state) => state.draft);
   const draftOptions = useHub((state) => state.draftOptions);
   const draftCommands = useHub((state) => state.draftCommands);
   const prepare = useHub((state) => state.prepare);
   const sendDraft = useHub((state) => state.sendDraft);
   const configure = useHub((state) => state.configure);
   const voice = useHub((state) => state.voice);
   const [agentChoice, setAgentChoice] = useState<string | null>(null);
   const [projectChoice, setProjectChoice] = useState<string | null>(null);
   const agent = pick(
      agentChoice,
      AGENT_KEY,
      agents.map((option) => option.id),
   );
   const project = pick(
      projectChoice,
      PROJECT_KEY,
      projects.map((option) => option.path),
   );
   const agentOption = agents.find((option) => option.id === agent);
   const sessionId = draft?.agentId === agent && draft.cwd === project ? draft.sessionId : null;
   const failed = failure?.reason === 'start-failed';

   useEffect(() => {
      if (!connected || !agent || !project) return;
      const timer = setTimeout(() => prepare(agent, project), PREPARE_DELAY);
      // The hub closes a draft left alone for a while; coming back to the page asks for it again.
      const onVisible = () => document.visibilityState === 'visible' && prepare(agent, project);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
         clearTimeout(timer);
         document.removeEventListener('visibilitychange', onVisible);
      };
   }, [connected, agent, project, prepare]);

   const send = (text: string) => {
      if (!agent || !project) return;
      localStorage.setItem(AGENT_KEY, agent);
      localStorage.setItem(PROJECT_KEY, project);
      sendDraft(text);
   };

   return (
      <section className="new-chat">
         <AppBar>
            <AgentPicker agents={agents} value={agent} onChange={setAgentChoice} />
         </AppBar>
         <div className="new-chat-body">
            <div className="new-chat-greeting">
               {agentOption && <AgentMark agent={agentOption.agent} />}
               <h1 className="new-chat-title">{t('new.greeting')}</h1>
               {failed ? (
                  <p className="new-chat-error" role="alert">
                     {t('failed.start-failed')}
                  </p>
               ) : (
                  !sessionId &&
                  agent &&
                  project && (
                     <p className="new-chat-status" role="status">
                        <ShimmerText>{t('chat.starting')}</ShimmerText>
                     </p>
                  )
               )}
            </div>
         </div>
         <div className="new-chat-footer">
            <Composer
               placeholder={t('new.placeholder')}
               onSend={send}
               disabled={!sessionId}
               accessory={
                  <div className="picker-row">
                     <ProjectPicker projects={projects} value={project} onChange={setProjectChoice} />
                     {sessionId && <ChatSettings options={draftOptions} onChange={(configId, value) => configure(sessionId, configId, value)} />}
                     <QuickManager commands={draftCommands} />
                  </div>
               }
               commands={sessionId ? draftCommands : undefined}
               voice={voice ? (append) => <VoiceInput onText={append} /> : undefined}
               quick={(insert) => (
                  <QuickBar agent={agentOption?.agent ?? null} commands={draftCommands} onSend={send} onInsert={insert} disabled={!sessionId} />
               )}
            />
         </div>
      </section>
   );
}
