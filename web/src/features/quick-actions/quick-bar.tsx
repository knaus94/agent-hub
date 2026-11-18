import { TextCursorInput, Zap } from 'lucide-react';
import type { AgentKind, Command } from '../../shared/protocol.ts';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { offered } from './model';
import './quick-bar.css';

// The user's quick actions for this chat, one tap each: sent as they are, or put in the composer to finish.
export function QuickBar({
   agent,
   commands,
   onSend,
   onInsert,
   disabled = false,
}: {
   agent: AgentKind | null;
   commands: Command[];
   onSend: (text: string) => void;
   onInsert: (text: string) => void;
   disabled?: boolean;
}) {
   const actions = useHub((state) => state.quick).filter((action) => offered(action, agent, commands));
   if (actions.length === 0) return null;
   return (
      <div className="quick-bar" role="toolbar" aria-label={t('quick.title')}>
         {actions.map((action) => {
            const Icon = action.send ? Zap : TextCursorInput;
            return (
               <button
                  key={action.id}
                  className="quick-bar-action"
                  type="button"
                  disabled={disabled}
                  title={action.text}
                  onClick={() => (action.send ? onSend(action.text) : onInsert(action.text))}
               >
                  <Icon className="quick-bar-icon" aria-hidden="true" />
                  <span className="quick-bar-label">{action.label}</span>
               </button>
            );
         })}
      </div>
   );
}
