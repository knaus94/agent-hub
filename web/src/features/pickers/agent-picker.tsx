import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { AgentOption } from '../../shared/protocol.ts';
import { AgentMark } from '../../entities/session/agent-mark';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import './pickers.css';

function accountOf(option: AgentOption) {
   return option.account ?? option.label;
}

// The agent for a new chat, chosen like the model in a chat app: from the title.
export function AgentPicker({ agents, value, onChange }: { agents: AgentOption[]; value: string | null; onChange: (id: string) => void }) {
   const [open, setOpen] = useState(false);
   const current = agents.find((option) => option.id === value);
   return (
      <>
         <button className="picker-title" type="button" onClick={() => setOpen(true)} disabled={agents.length === 0} aria-haspopup="dialog">
            <span className="picker-title-name">{current ? t(`agent.${current.agent}`) : t('new.noAgents')}</span>
            {current && <span className="picker-title-detail">{accountOf(current)}</span>}
            <ChevronDown className="picker-chevron" aria-hidden="true" />
         </button>
         <Sheet open={open} title={t('picker.agent')} onClose={() => setOpen(false)}>
            <ul className="picker-options">
               {agents.map((option) => (
                  <li key={option.id}>
                     <button
                        className="picker-option"
                        type="button"
                        aria-current={option.id === value}
                        onClick={() => {
                           onChange(option.id);
                           setOpen(false);
                        }}
                     >
                        <AgentMark agent={option.agent} />
                        <span className="picker-option-text">
                           <span className="picker-option-name">{t(`agent.${option.agent}`)}</span>
                           <span className="picker-option-detail" title={option.label}>
                              {accountOf(option)}
                           </span>
                        </span>
                        {option.id === value && <Check className="picker-option-check" aria-hidden="true" />}
                     </button>
                  </li>
               ))}
            </ul>
         </Sheet>
      </>
   );
}
