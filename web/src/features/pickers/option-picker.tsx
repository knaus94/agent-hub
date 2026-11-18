import { ChevronDown, Cpu, Gauge } from 'lucide-react';
import { useState } from 'react';
import type { ConfigOption } from '../../shared/protocol.ts';
import { Sheet } from '../../shared/ui/sheet';
import { ChoiceList } from './choice-list';
import { optionTitle } from './option-title';
import './pickers.css';

const ICONS = { model: Cpu, thought_level: Gauge } as const;

// A choice the composer shows as a chip: the model or the reasoning effort.
export function OptionPicker({
   option,
   onChange,
   disabled = false,
}: {
   option: ConfigOption;
   onChange: (value: string) => void;
   disabled?: boolean;
}) {
   const [open, setOpen] = useState(false);
   const Icon = option.category === 'thought_level' ? ICONS.thought_level : ICONS.model;
   const title = optionTitle(option);
   const shown = option.choices.find((choice) => choice.value === option.current)?.name ?? String(option.current ?? '');

   return (
      <>
         <button
            className="picker-chip"
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            aria-haspopup="dialog"
            aria-label={`${title}: ${shown}`}
            title={`${title}: ${shown}`}
         >
            <Icon className="picker-chip-icon" aria-hidden="true" />
            <span className="picker-chip-text">{shown}</span>
            <ChevronDown className="picker-chip-icon" aria-hidden="true" />
         </button>
         <Sheet open={open} title={title} onClose={() => setOpen(false)}>
            <ChoiceList
               option={option}
               onPick={(value) => {
                  setOpen(false);
                  if (value !== option.current) onChange(value);
               }}
            />
         </Sheet>
      </>
   );
}
