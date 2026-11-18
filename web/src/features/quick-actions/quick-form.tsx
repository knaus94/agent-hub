import { useId, useState, type FormEvent } from 'react';
import type { AgentKind, Command, QuickAction } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { AGENT_KINDS } from './model';
import './quick-form.css';

const LABEL_MAX = 40;
const TEXT_MAX = 4000;
const SUGGESTIONS = 6;

// One quick action being made or changed. It stays a draft until saved; cancelling or closing the sheet drops it.
export function QuickForm({
   action,
   commands,
   onSave,
   onCancel,
}: {
   action: QuickAction;
   commands: Command[];
   onSave: (action: QuickAction) => void;
   onCancel: () => void;
}) {
   const [label, setLabel] = useState(action.label);
   const [text, setText] = useState(action.text);
   const [agents, setAgents] = useState<AgentKind[]>(action.agents);
   const [send, setSend] = useState(action.send);
   const labelId = useId();
   const textId = useId();
   const hintId = useId();
   const agentsHintId = useId();
   const modeName = useId();
   // While the text is "/" and a name, the commands of this chat that fit are offered, as in the composer.
   const typed = /^\/(\S*)$/.exec(text)?.[1]?.toLowerCase();
   const suggestions =
      typed === undefined ? [] : commands.filter((command) => command.name.toLowerCase().startsWith(typed)).slice(0, SUGGESTIONS);
   const ready = label.trim() !== '' && text.trim() !== '';

   const submit = (event: FormEvent) => {
      event.preventDefault();
      // React carries the submit out of the sheet's portal to the composer's form, which would send its text.
      event.stopPropagation();
      if (ready) onSave({ ...action, label: label.trim(), text: text.trim(), agents, send });
   };

   const toggle = (agent: AgentKind, on: boolean) =>
      setAgents(on ? AGENT_KINDS.filter((kind) => kind === agent || agents.includes(kind)) : agents.filter((kind) => kind !== agent));

   return (
      <form className="quick-form" onSubmit={submit}>
         <div className="quick-form-field">
            <label className="quick-form-label" htmlFor={labelId}>
               {t('quick.label')}
            </label>
            <input
               id={labelId}
               className="quick-form-input"
               value={label}
               maxLength={LABEL_MAX}
               required
               autoComplete="off"
               onChange={(event) => setLabel(event.target.value)}
            />
         </div>
         <div className="quick-form-field">
            <label className="quick-form-label" htmlFor={textId}>
               {t('quick.text')}
            </label>
            <textarea
               id={textId}
               className="quick-form-input quick-form-text"
               value={text}
               rows={3}
               maxLength={TEXT_MAX}
               required
               aria-describedby={hintId}
               onChange={(event) => setText(event.target.value)}
            />
            <p className="quick-form-hint" id={hintId}>
               {t('quick.text.hint')}
            </p>
            {suggestions.length > 0 && (
               <div className="quick-form-suggestions" role="group" aria-label={t('quick.suggestions')}>
                  {suggestions.map((command) => (
                     <button key={command.name} className="quick-form-suggestion" type="button" onClick={() => setText(`/${command.name} `)}>
                        /{command.name}
                     </button>
                  ))}
               </div>
            )}
         </div>
         <fieldset className="quick-form-group" aria-describedby={agentsHintId}>
            <legend className="quick-form-label">{t('quick.agents')}</legend>
            <div className="quick-form-choices">
               {AGENT_KINDS.map((agent) => (
                  <label key={agent} className="quick-form-choice">
                     <input
                        className="quick-form-check"
                        type="checkbox"
                        checked={agents.includes(agent)}
                        onChange={(event) => toggle(agent, event.target.checked)}
                     />
                     {t(`quick.agent.${agent}`)}
                  </label>
               ))}
            </div>
            <p className="quick-form-hint" id={agentsHintId}>
               {t('quick.agents.hint')}
            </p>
         </fieldset>
         <fieldset className="quick-form-group">
            <legend className="quick-form-label">{t('quick.mode')}</legend>
            <div className="quick-form-choices quick-form-choices--stacked">
               <label className="quick-form-choice">
                  <input className="quick-form-check" type="radio" name={modeName} checked={send} onChange={() => setSend(true)} />
                  {t('quick.mode.send')}
               </label>
               <label className="quick-form-choice">
                  <input className="quick-form-check" type="radio" name={modeName} checked={!send} onChange={() => setSend(false)} />
                  {t('quick.mode.insert')}
               </label>
            </div>
         </fieldset>
         <div className="quick-form-actions">
            <button className="quick-form-button" type="button" onClick={onCancel}>
               {t('quick.cancel')}
            </button>
            <button className="quick-form-button quick-form-button--primary" type="submit" disabled={!ready}>
               {t('quick.save')}
            </button>
         </div>
      </form>
   );
}
