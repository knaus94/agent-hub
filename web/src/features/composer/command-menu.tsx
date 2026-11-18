import { useLayoutEffect, useRef } from 'react';
import type { Command } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import './command-menu.css';

// The agent's slash commands matching what is typed after "/". Focus stays in the composer, which drives the list.
export function CommandMenu({
   id,
   commands,
   active,
   onPick,
}: {
   id: string;
   commands: Command[];
   active: number;
   onPick: (command: Command) => void;
}) {
   const activeOption = useRef<HTMLLIElement>(null);

   useLayoutEffect(() => {
      activeOption.current?.scrollIntoView({ block: 'nearest' });
   }, [active]);

   return (
      <ul className="command-menu" id={id} role="listbox" aria-label={t('commands.label')}>
         {commands.map((command, index) => (
            <li
               key={command.name}
               ref={index === active ? activeOption : undefined}
               id={`${id}-${index}`}
               className="command-menu-option"
               role="option"
               aria-selected={index === active}
               onMouseDown={(event) => event.preventDefault()}
               onClick={() => onPick(command)}
            >
               <span className="command-menu-name">
                  /{command.name}
                  {command.hint && <span className="command-menu-hint"> {command.hint}</span>}
               </span>
               {command.description && (
                  <span className="command-menu-description" title={command.description}>
                     {command.description}
                  </span>
               )}
            </li>
         ))}
      </ul>
   );
}
