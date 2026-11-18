import { ArrowUp, Square } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Command } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { CommandMenu } from './command-menu';
import './composer.css';

// On a touch keyboard Enter is the only way to start a new line, so it must not send.
const finePointer = window.matchMedia('(pointer: fine)');

type ComposerProps = {
   placeholder: string;
   onSend: (text: string) => void;
   sendLabel?: string;
   running?: boolean;
   onStop?: () => void;
   disabled?: boolean;
   note?: string | null;
   accessory?: ReactNode;
   commands?: Command[];
   // Shown above the box; insert puts a text in the composer to finish and focuses it.
   quick?: (insert: (text: string) => void) => ReactNode;
   // Shown beside the send button; append adds dictated text to what is written.
   voice?: (append: (text: string) => void) => ReactNode;
};

// While the text is "/" and a name, it is a slash command being chosen: names that start so come first.
function matching(commands: Command[], text: string) {
   const typed = /^\/(\S*)$/.exec(text)?.[1].toLowerCase();
   if (typed === undefined) return [];
   const starts = commands.filter((command) => command.name.toLowerCase().startsWith(typed));
   const contains = commands.filter((command) => !command.name.toLowerCase().startsWith(typed) && command.name.toLowerCase().includes(typed));
   return [...starts, ...contains];
}

export function Composer({
   placeholder,
   onSend,
   sendLabel = t('composer.send'),
   running = false,
   onStop,
   disabled = false,
   note = null,
   accessory,
   commands = [],
   quick,
   voice,
}: ComposerProps) {
   const [text, setText] = useState('');
   const [cursor, setCursor] = useState({ text: '', index: 0 });
   const [dismissed, setDismissed] = useState<string | null>(null);
   const area = useRef<HTMLTextAreaElement>(null);
   const inputId = useId();
   const hintId = useId();
   const menuId = useId();
   const offered = dismissed === text ? [] : matching(commands, text);
   const menuOpen = offered.length > 0;
   const active = cursor.text === text ? Math.min(cursor.index, offered.length - 1) : 0;

   useLayoutEffect(() => {
      const element = area.current;
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
   }, [text]);

   const submit = (event?: FormEvent) => {
      event?.preventDefault();
      const value = text.trim();
      if (!value || disabled) return;
      onSend(value);
      setText('');
   };

   const insert = (value: string) => {
      setText(value);
      // The caret goes to the end once the box holds the new text.
      requestAnimationFrame(() => {
         area.current?.focus();
         area.current?.setSelectionRange(value.length, value.length);
      });
   };

   const append = (value: string) => setText((current) => (current.trim() ? `${current.trimEnd()} ${value}` : value));

   const pick = (command: Command) => {
      setText(`/${command.name} `);
      area.current?.focus();
   };

   const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (menuOpen && !event.nativeEvent.isComposing) {
         const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
         if (step) {
            event.preventDefault();
            setCursor({ text, index: (active + step + offered.length) % offered.length });
            return;
         }
         if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            pick(offered[active]);
            return;
         }
         if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(text);
            return;
         }
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && finePointer.matches) {
         event.preventDefault();
         submit();
      }
   };

   return (
      <form className="composer" onSubmit={submit}>
         <fieldset className="composer-fieldset" disabled={disabled}>
            <label className="visually-hidden" htmlFor={inputId}>
               {t('composer.label')}
            </label>
            {menuOpen && <CommandMenu id={menuId} commands={offered} active={active} onPick={pick} />}
            {quick?.(insert)}
            <div className="composer-box" data-running={running}>
               <textarea
                  ref={area}
                  id={inputId}
                  className="composer-input"
                  rows={1}
                  value={text}
                  placeholder={placeholder}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={menuOpen}
                  aria-controls={menuOpen ? menuId : undefined}
                  aria-activedescendant={menuOpen ? `${menuId}-${active}` : undefined}
                  aria-describedby={hintId}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={onKeyDown}
               />
               <div className="composer-toolbar">
                  <div className="composer-accessory">{accessory}</div>
                  {voice?.(append)}
                  {running && onStop && (
                     <button className="composer-stop" type="button" onClick={onStop} aria-label={t('composer.stop')} title={t('composer.stop')}>
                        <Square className="composer-stop-icon" aria-hidden="true" />
                     </button>
                  )}
                  <button className="composer-send" type="submit" disabled={!text.trim()} aria-label={sendLabel} title={sendLabel}>
                     <ArrowUp className="composer-send-icon" aria-hidden="true" />
                  </button>
               </div>
            </div>
            <p className="composer-hint" id={hintId} data-kind={note ? 'note' : 'keys'}>
               {note ?? t('composer.hint')}
            </p>
         </fieldset>
      </form>
   );
}
