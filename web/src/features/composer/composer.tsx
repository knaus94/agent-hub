import { ArrowUp, Paperclip, Square } from 'lucide-react';
import {
   useEffect,
   useId,
   useLayoutEffect,
   useRef,
   useState,
   type ClipboardEvent,
   type DragEvent,
   type FormEvent,
   type KeyboardEvent,
   type ReactNode,
} from 'react';
import type { Attach, Command } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { AttachmentList } from './attachment-list';
import { ATTACHMENTS_MAX, AttachError, fromFile, link, release, type Attachment } from './attachments';
import { SuggestionMenu, type Suggestion } from './suggestion-menu';
import './composer.css';

// On a touch keyboard Enter is the only way to start a new line, so it must not send.
const finePointer = window.matchMedia('(pointer: fine)');
// Each key typed after "@" would ask the hub; it asks once typing pauses.
const SEARCH_DELAY = 120;

type ComposerProps = {
   placeholder: string;
   // A promise keeps the text and attachments until it resolves, and shows why when it rejects.
   onSend: (text: string, attachments: Attachment[]) => void | Promise<void>;
   sendLabel?: string;
   running?: boolean;
   onStop?: () => void;
   disabled?: boolean;
   note?: string | null;
   accessory?: ReactNode;
   commands?: Command[];
   // What a message may carry besides text; findFiles looks for the project's files to link to after "@".
   attach?: Attach | null;
   findFiles?: (query: string) => Promise<string[]>;
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

function describe(cause: unknown) {
   return cause instanceof AttachError
      ? t(`attach.error.${cause.code}`, { file: cause.file, count: ATTACHMENTS_MAX })
      : t('attach.error.invalid');
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
   attach = null,
   findFiles,
   quick,
   voice,
}: ComposerProps) {
   const [text, setText] = useState('');
   const [cursor, setCursor] = useState({ text: '', index: 0 });
   const [dismissed, setDismissed] = useState<string | null>(null);
   const [attachments, setAttachments] = useState<Attachment[]>([]);
   const [sending, setSending] = useState(false);
   const [problem, setProblem] = useState<string | null>(null);
   const [found, setFound] = useState<{ query: string; paths: string[] } | null>(null);
   const [dropping, setDropping] = useState(false);
   const area = useRef<HTMLTextAreaElement>(null);
   const picker = useRef<HTMLInputElement>(null);
   const held = useRef(attachments);
   const inputId = useId();
   const hintId = useId();
   const menuId = useId();
   const fromDevice = attach !== null && (attach.images || attach.files);
   // The word being typed, when it starts with "@": a project file being looked for.
   const mention = attach?.links && findFiles ? /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1] : undefined;
   const files = mention !== undefined && found?.query === mention ? found.paths : [];
   const slash = mention === undefined ? matching(commands, text) : [];
   const suggestions: Suggestion[] =
      mention !== undefined
         ? files.map((path) => ({ key: path, name: path.split('/').pop() ?? path, description: path }))
         : slash.map((command) => ({
              key: command.name,
              name: `/${command.name}`,
              hint: command.hint ?? undefined,
              description: command.description,
           }));
   const offered = dismissed === text ? [] : suggestions;
   const menuOpen = offered.length > 0;
   const active = cursor.text === text ? Math.min(cursor.index, offered.length - 1) : 0;
   held.current = attachments;

   useLayoutEffect(() => {
      const element = area.current;
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
   }, [text]);

   useEffect(() => {
      if (mention === undefined || !findFiles) return;
      let current = true;
      const timer = setTimeout(() => void findFiles(mention).then((paths) => current && setFound({ query: mention, paths })), SEARCH_DELAY);
      return () => {
         current = false;
         clearTimeout(timer);
      };
   }, [mention, findFiles]);

   useEffect(() => () => release(held.current), []);

   const add = async (picked: File[]) => {
      if (!attach || picked.length === 0) return;
      setProblem(null);
      const room = ATTACHMENTS_MAX - attachments.length;
      if (picked.length > room) setProblem(t('attach.error.many', { count: ATTACHMENTS_MAX }));
      const results = await Promise.allSettled(picked.slice(0, Math.max(room, 0)).map((file) => fromFile(file, attach)));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) setProblem(describe(failed.reason));
      const added = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      setAttachments((current) => [...current, ...added]);
   };

   const remove = (id: string) => {
      release(attachments.filter((attachment) => attachment.id === id));
      setAttachments(attachments.filter((attachment) => attachment.id !== id));
      setProblem(null);
   };

   const submit = (event?: FormEvent) => {
      event?.preventDefault();
      const value = text.trim();
      if ((!value && attachments.length === 0) || disabled || sending) return;
      const sent = onSend(value, attachments);
      if (!sent) {
         setText('');
         return;
      }
      setSending(true);
      setProblem(null);
      sent
         .then(
            () => {
               // What was typed while it went stays.
               setText((current) => (current.trim() === value ? '' : current));
               release(attachments);
               setAttachments([]);
            },
            (cause: unknown) => setProblem(describe(cause)),
         )
         .finally(() => setSending(false));
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

   const pick = (index: number) => {
      if (mention !== undefined) {
         const path = files[index];
         setText(text.replace(/@[^\s@]*$/, ''));
         if (attachments.length >= ATTACHMENTS_MAX) setProblem(t('attach.error.many', { count: ATTACHMENTS_MAX }));
         else if (!attachments.some((attachment) => attachment.kind === 'link' && attachment.path === path))
            setAttachments([...attachments, link(path)]);
      } else setText(`/${slash[index].name} `);
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
            pick(active);
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

   // A pasted screenshot is attached; text copied along with a picture is still pasted as text.
   const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = [...event.clipboardData.files];
      if (!fromDevice || pasted.length === 0) return;
      if (!event.clipboardData.types.includes('text/plain')) event.preventDefault();
      void add(pasted);
   };

   const onDragOver = (event: DragEvent<HTMLDivElement>) => {
      if (!fromDevice || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setDropping(true);
   };

   const onDrop = (event: DragEvent<HTMLDivElement>) => {
      if (!fromDevice || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setDropping(false);
      void add([...event.dataTransfer.files]);
   };

   const hint =
      problem ?? (sending ? t('attach.sending') : (note ?? t(mention === undefined && attach?.links ? 'composer.hint.files' : 'composer.hint')));
   return (
      <form className="composer" onSubmit={submit}>
         <fieldset className="composer-fieldset" disabled={disabled}>
            <label className="visually-hidden" htmlFor={inputId}>
               {t('composer.label')}
            </label>
            {menuOpen && (
               <SuggestionMenu
                  id={menuId}
                  label={t(mention === undefined ? 'commands.label' : 'attach.files')}
                  suggestions={offered}
                  active={active}
                  onPick={pick}
               />
            )}
            {quick?.(insert)}
            <div
               className="composer-box"
               data-running={running}
               data-dropping={dropping}
               onDragOver={onDragOver}
               onDragLeave={(event) =>
                  !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) && setDropping(false)
               }
               onDrop={onDrop}
            >
               <AttachmentList attachments={attachments} onRemove={remove} />
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
                  onPaste={onPaste}
               />
               <div className="composer-toolbar">
                  <div className="composer-accessory">{accessory}</div>
                  {fromDevice && (
                     <>
                        <button
                           className="composer-attach"
                           type="button"
                           onClick={() => picker.current?.click()}
                           aria-label={t('attach.add')}
                           title={t('attach.add')}
                        >
                           <Paperclip className="composer-attach-icon" aria-hidden="true" />
                        </button>
                        <input
                           ref={picker}
                           type="file"
                           multiple
                           hidden
                           accept={attach.files ? undefined : 'image/*'}
                           onChange={(event) => {
                              void add([...(event.target.files ?? [])]);
                              event.target.value = '';
                           }}
                        />
                     </>
                  )}
                  {voice?.(append)}
                  {running && onStop && (
                     <button className="composer-stop" type="button" onClick={onStop} aria-label={t('composer.stop')} title={t('composer.stop')}>
                        <Square className="composer-stop-icon" aria-hidden="true" />
                     </button>
                  )}
                  <button
                     className="composer-send"
                     type="submit"
                     disabled={(!text.trim() && attachments.length === 0) || sending}
                     aria-busy={sending}
                     aria-label={sendLabel}
                     title={sendLabel}
                  >
                     <ArrowUp className="composer-send-icon" aria-hidden="true" />
                  </button>
               </div>
            </div>
            <p
               className="composer-hint"
               id={hintId}
               role={problem ? 'alert' : undefined}
               data-kind={problem || (!sending && note) ? 'note' : sending ? 'status' : 'keys'}
            >
               {hint}
            </p>
         </fieldset>
      </form>
   );
}
