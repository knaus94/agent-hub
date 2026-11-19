import { useLayoutEffect, useRef } from 'react';
import './suggestion-menu.css';

export type Suggestion = { key: string; name: string; hint?: string; description?: string };

// What fits what is being typed: the agent's slash commands after "/", the project's files after "@". Focus stays in
// the composer, which drives the list.
export function SuggestionMenu({
   id,
   label,
   suggestions,
   active,
   onPick,
}: {
   id: string;
   label: string;
   suggestions: Suggestion[];
   active: number;
   onPick: (index: number) => void;
}) {
   const activeOption = useRef<HTMLLIElement>(null);

   useLayoutEffect(() => {
      activeOption.current?.scrollIntoView({ block: 'nearest' });
   }, [active]);

   return (
      <ul className="suggestion-menu" id={id} role="listbox" aria-label={label}>
         {suggestions.map((suggestion, index) => (
            <li
               key={suggestion.key}
               ref={index === active ? activeOption : undefined}
               id={`${id}-${index}`}
               className="suggestion-menu-option"
               role="option"
               aria-selected={index === active}
               onMouseDown={(event) => event.preventDefault()}
               onClick={() => onPick(index)}
            >
               <span className="suggestion-menu-name">
                  {suggestion.name}
                  {suggestion.hint && <span className="suggestion-menu-hint"> {suggestion.hint}</span>}
               </span>
               {suggestion.description && (
                  <span className="suggestion-menu-description" title={suggestion.description}>
                     {suggestion.description}
                  </span>
               )}
            </li>
         ))}
      </ul>
   );
}
