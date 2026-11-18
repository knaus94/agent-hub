import {
   ArrowRightLeft,
   Brain,
   Check,
   ChevronDown,
   FilePenLine,
   FileText,
   Globe,
   LoaderCircle,
   Search,
   SquareTerminal,
   Trash2,
   Wrench,
   X,
} from 'lucide-react';
import { memo, useState } from 'react';
import type { Entry } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { DiffView } from './diff-view';
import { TerminalOutput } from './terminal-output';
import './tool-call.css';

type ToolEntry = Extract<Entry, { kind: 'tool' }>;

const KIND_ICONS = {
   read: FileText,
   edit: FilePenLine,
   delete: Trash2,
   move: ArrowRightLeft,
   search: Search,
   execute: SquareTerminal,
   think: Brain,
   fetch: Globe,
} as const;

function kindIcon(kind: string) {
   return kind in KIND_ICONS ? KIND_ICONS[kind as keyof typeof KIND_ICONS] : Wrench;
}

function StatusIcon({ status }: { status: ToolEntry['status'] }) {
   if (status === 'completed') return <Check className="tool-step-status-icon tool-step-status-icon--done" aria-hidden="true" />;
   if (status === 'failed') return <X className="tool-step-status-icon tool-step-status-icon--done" aria-hidden="true" />;
   return <LoaderCircle className="tool-step-status-icon tool-step-status-icon--spin" aria-hidden="true" />;
}

// One step of the agent's work, drawn on the timeline's rail of steps.
export const ToolCall = memo(function ToolCall({ entry }: { entry: ToolEntry }) {
   // The body, with its output and diffs, is drawn only once opened: a long chat holds hundreds of steps.
   const [open, setOpen] = useState(false);
   const Icon = kindIcon(entry.toolKind);
   const isCommand = entry.toolKind === 'execute' && Boolean(entry.command);
   const title = (isCommand ? entry.command : entry.title) || entry.command || entry.toolKind;
   const showCommand = Boolean(entry.command) && !isCommand && entry.command !== entry.title;
   const parts = entry.content.filter((part) => part.type !== 'terminal');
   const hasBody = showCommand || Boolean(entry.output) || parts.length > 0;
   const failedExit = entry.exitCode !== null && entry.exitCode !== 0;

   const summary = (
      <>
         <span className="tool-step-title" data-mono={isCommand} title={title}>
            {title}
         </span>
         {failedExit && <span className="tool-step-exit">{t('entry.tool.exit', { code: entry.exitCode ?? '' })}</span>}
         <span className="tool-step-status" data-status={entry.status}>
            <StatusIcon status={entry.status} />
            <span className="visually-hidden">{t(`tool.status.${entry.status}`)}</span>
         </span>
         {hasBody && <ChevronDown className="tool-step-chevron" aria-hidden="true" />}
      </>
   );

   return (
      <div className="tool-step" data-status={entry.status}>
         <span className="tool-step-marker" aria-hidden="true">
            <Icon className="tool-step-icon" />
         </span>
         {hasBody ? (
            <details className="tool-step-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
               <summary className="tool-step-summary tool-step-summary--toggle">{summary}</summary>
               {open && (
                  <div className="tool-step-body">
                     {showCommand && <pre className="tool-step-command">{entry.command}</pre>}
                     {entry.output && <TerminalOutput output={entry.output} />}
                     {parts.map((part, index) =>
                        part.type === 'diff' ? (
                           <DiffView key={index} path={part.path} oldText={part.oldText} newText={part.newText} />
                        ) : part.type === 'text' ? (
                           <pre key={index} className="tool-step-text">
                              {part.text}
                           </pre>
                        ) : null,
                     )}
                  </div>
               )}
            </details>
         ) : (
            <div className="tool-step-card">
               <div className="tool-step-summary">{summary}</div>
            </div>
         )}
      </div>
   );
});
