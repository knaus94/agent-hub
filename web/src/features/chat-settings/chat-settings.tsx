import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { ConfigOption } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import { ChoiceList } from '../pickers/choice-list';
import { OptionPicker } from '../pickers/option-picker';
import { optionTitle } from '../pickers/option-title';
import './chat-settings.css';

const PRIMARY = ['model', 'thought_level'];

// Everything the agent lets the user set for this chat, as Zed shows it: the model and the effort as chips in the
// composer, the mode, switches and the rest in one sheet behind a settings button.
export function ChatSettings({
   options,
   onChange,
   disabled = false,
}: {
   options: ConfigOption[];
   onChange: (configId: string, value: string | boolean) => void;
   disabled?: boolean;
}) {
   const [open, setOpen] = useState(false);
   const primary = options.filter((option) => option.type === 'select' && PRIMARY.includes(option.category ?? ''));
   const rest = options.filter((option) => !primary.includes(option));

   return (
      <>
         {primary.map((option) => (
            <OptionPicker key={option.id} option={option} onChange={(value) => onChange(option.id, value)} disabled={disabled} />
         ))}
         {rest.length > 0 && (
            <button
               className="picker-chip"
               type="button"
               onClick={() => setOpen(true)}
               disabled={disabled}
               aria-haspopup="dialog"
               aria-label={t('settings.more')}
               title={t('settings.more')}
            >
               <SlidersHorizontal className="picker-chip-icon" aria-hidden="true" />
            </button>
         )}
         <Sheet open={open} title={t('settings.title')} onClose={() => setOpen(false)}>
            <div className="chat-settings">
               {rest.map((option) =>
                  option.type === 'boolean' ? (
                     <label key={option.id} className="chat-settings-switch">
                        <span className="chat-settings-switch-name">{optionTitle(option)}</span>
                        <input
                           className="chat-settings-switch-input visually-hidden"
                           type="checkbox"
                           role="switch"
                           checked={option.current === true}
                           onChange={(event) => onChange(option.id, event.target.checked)}
                        />
                        <span className="chat-settings-switch-track" aria-hidden="true" />
                     </label>
                  ) : (
                     <section key={option.id} className="chat-settings-section">
                        <h3 className="chat-settings-title">{optionTitle(option)}</h3>
                        <ChoiceList option={option} onPick={(value) => value !== option.current && onChange(option.id, value)} />
                     </section>
                  ),
               )}
            </div>
         </Sheet>
      </>
   );
}
