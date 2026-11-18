import { Brain, ChevronDown } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { t } from '../../shared/i18n';
import { useTallerThan } from '../../shared/lib/use-taller-than';
import { MarkdownText } from '../../shared/ui/markdown';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import './thought.css';

// Reasoning is what the user comes for: it stays readable, live while the agent thinks and as a preview afterwards.
// Only text that does not fit is clipped and faded; a short thought shows whole.
export const Thought = memo(function Thought({ text, live }: { text: string; live: boolean }) {
   const [open, setOpen] = useState(false);
   const bodyId = useId();
   const [contentRef, clipped] = useTallerThan<HTMLDivElement>(live ? '--size-thought-live' : '--size-thought-preview');

   if (live) {
      return (
         <section className="thought" data-live="true">
            <p className="thought-header">
               <Brain className="thought-icon thought-icon--live" aria-hidden="true" />
               <ShimmerText>{t('entry.thought.live')}</ShimmerText>
            </p>
            <div className="thought-live" data-clipped={clipped}>
               <div className="thought-live-text" ref={contentRef}>
                  <MarkdownText text={text} />
               </div>
            </div>
         </section>
      );
   }

   return (
      <section className="thought" data-open={open}>
         {clipped ? (
            <button
               className="thought-header thought-toggle"
               type="button"
               aria-expanded={open}
               aria-controls={bodyId}
               onClick={() => setOpen(!open)}
            >
               <Brain className="thought-icon" aria-hidden="true" />
               <span className="thought-label">{t('entry.thought')}</span>
               <ChevronDown className="thought-chevron" aria-hidden="true" />
            </button>
         ) : (
            <p className="thought-header">
               <Brain className="thought-icon" aria-hidden="true" />
               <span className="thought-label">{t('entry.thought')}</span>
            </p>
         )}
         <div id={bodyId} className="thought-body" data-clipped={clipped} data-open={open} onClick={clipped ? () => setOpen(true) : undefined}>
            <div ref={contentRef}>
               <MarkdownText text={text} />
            </div>
         </div>
      </section>
   );
});
