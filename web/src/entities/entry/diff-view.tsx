import { diffLines } from 'diff';
import { useMemo } from 'react';
import { tp } from '../../shared/i18n';
import './diff-view.css';

type Row = { type: 'add' | 'remove' | 'context'; text: string } | { type: 'gap'; count: number };

const CONTEXT = 3;
const MAX_ROWS = 500;

function buildRows(oldText: string | null, newText: string): Row[] {
   const rows: Row[] = [];
   for (const part of diffLines(oldText ?? '', newText)) {
      const lines = part.value.replace(/\n$/, '').split('\n');
      if (part.added || part.removed) {
         for (const text of lines) rows.push({ type: part.added ? 'add' : 'remove', text });
      } else if (lines.length > CONTEXT * 2 + 1) {
         for (const text of lines.slice(0, CONTEXT)) rows.push({ type: 'context', text });
         rows.push({ type: 'gap', count: lines.length - CONTEXT * 2 });
         for (const text of lines.slice(-CONTEXT)) rows.push({ type: 'context', text });
      } else {
         for (const text of lines) rows.push({ type: 'context', text });
      }
   }
   return rows.slice(0, MAX_ROWS);
}

const SIGNS = { add: '+', remove: '−', context: ' ' } as const;

export function DiffView({ path, oldText, newText }: { path: string; oldText: string | null; newText: string }) {
   const rows = useMemo(() => buildRows(oldText, newText), [oldText, newText]);
   const name = path.split('/').at(-1) ?? path;
   const dir = path.slice(0, path.length - name.length);
   return (
      <figure className="diff-view">
         <figcaption className="diff-view-path" title={path}>
            <span className="diff-view-dir">{dir}</span>
            <span className="diff-view-name">{name}</span>
         </figcaption>
         <div className="diff-view-lines">
            {rows.map((row, index) =>
               row.type === 'gap' ? (
                  <div key={index} className="diff-view-gap">
                     {tp('entry.tool.unchanged', row.count)}
                  </div>
               ) : (
                  <div key={index} className="diff-view-line" data-type={row.type}>
                     <span className="diff-view-sign" aria-hidden="true">
                        {SIGNS[row.type]}
                     </span>
                     <span className="diff-view-text">{row.text}</span>
                  </div>
               ),
            )}
         </div>
      </figure>
   );
}
