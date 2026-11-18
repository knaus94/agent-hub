import { tp } from '../../shared/i18n';
import { stripAnsi } from '../../shared/lib/format';
import './terminal-output.css';

const MAX_LINES = 400;

export function TerminalOutput({ output }: { output: string }) {
   const lines = stripAnsi(output).replace(/\n$/, '').split('\n');
   const hidden = Math.max(0, lines.length - MAX_LINES);
   return (
      <div className="terminal-output">
         {hidden > 0 && <p className="terminal-output-cut">{tp('entry.tool.cut', hidden)}</p>}
         <pre className="terminal-output-text">{hidden > 0 ? lines.slice(hidden).join('\n') : lines.join('\n')}</pre>
      </div>
   );
}
