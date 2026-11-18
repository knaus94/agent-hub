import { Check } from 'lucide-react';
import type { ConfigOption } from '../../shared/protocol.ts';
import './pickers.css';

// The choices of one setting, the current one checked.
export function ChoiceList({ option, onPick }: { option: ConfigOption; onPick: (value: string) => void }) {
   return (
      <ul className="picker-options">
         {option.choices.map((choice) => (
            <li key={choice.value}>
               <button
                  className="picker-option"
                  type="button"
                  aria-current={choice.value === option.current}
                  onClick={() => onPick(choice.value)}
               >
                  <span className="picker-option-text">
                     <span className="picker-option-name">{choice.name}</span>
                     {choice.description && (
                        <span className="picker-option-detail" title={choice.description}>
                           {choice.description}
                        </span>
                     )}
                  </span>
                  {choice.value === option.current && <Check className="picker-option-check" aria-hidden="true" />}
               </button>
            </li>
         ))}
      </ul>
   );
}
