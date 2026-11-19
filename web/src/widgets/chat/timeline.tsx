import { ArrowDown } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entry, SessionSummary } from '../../shared/protocol.ts';
import { AgentMessage } from '../../entities/entry/agent-message';
import { Notice } from '../../entities/entry/notice';
import { QuestionCard } from '../../entities/entry/question-card';
import { Thought } from '../../entities/entry/thought';
import { ToolCall } from '../../entities/entry/tool-call';
import { UserMessage } from '../../entities/entry/user-message';
import { t } from '../../shared/i18n';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import './timeline.css';

// How close to the end counts as being at it: scroll positions are fractional on some screens.
const AT_END = 2;
// How far a finger moves before it counts as scrolling rather than a tap.
const TOUCH_SLOP = 6;
// For this long after the view changes size its position shifts on its own; on an iPhone the bounce at the end
// then reads as moving up, which would fold the composer that had just come back.
const SETTLE = 300;

type ToolEntry = Extract<Entry, { kind: 'tool' }>;
type Item =
   { kind: 'steps'; key: string; steps: { entry: ToolEntry; index: number }[] } | { kind: 'entry'; key: string; entry: Entry; index: number };

// Consecutive tool calls are the agent's steps; they share one rail. Indexes count from the chat's first entry.
function group(entries: Entry[], start: number): Item[] {
   const items: Item[] = [];
   entries.forEach((entry, offset) => {
      const index = start + offset;
      const last = items.at(-1);
      if (entry.kind === 'tool' && last?.kind === 'steps') last.steps.push({ entry, index });
      else if (entry.kind === 'tool') items.push({ kind: 'steps', key: entry.id, steps: [{ entry, index }] });
      else items.push({ kind: 'entry', key: entry.id, entry, index });
   });
   return items;
}

const EntryView = memo(function EntryView({ entry, live }: { entry: Entry; live: boolean }) {
   switch (entry.kind) {
      case 'user':
         return <UserMessage entry={entry} />;
      case 'agent':
         return <AgentMessage text={entry.text} streaming={live} />;
      case 'thought':
         return <Thought text={entry.text} live={live} />;
      case 'tool':
         return <ToolCall entry={entry} />;
      case 'notice':
         return <Notice entry={entry} />;
      case 'question':
         return <QuestionCard entry={entry} />;
   }
});

export function Timeline({
   entries,
   start,
   session,
   onOlder,
   onFollow,
}: {
   entries: Entry[] | null;
   start: number;
   session: SessionSummary;
   onOlder: () => void;
   // Told whether the view follows new output, at the very end, or the user is reading further up.
   onFollow?: (following: boolean) => void;
}) {
   const scroller = useRef<HTMLDivElement>(null);
   const stuck = useRef(true);
   const lastTop = useRef(0);
   const resizedAt = useRef(0);
   const touchY = useRef<number | null>(null);
   // Entries present when the chat opened, and older ones loaded later, appear at once; only new ones animate in.
   const initialEnd = useRef<number | null>(null);
   const shownStart = useRef(start);
   const before = useRef<{ height: number; top: number } | null>(null);
   const [showLatest, setShowLatest] = useState(false);
   const running = session.online && session.status === 'running';

   if (entries && initialEnd.current === null) initialEnd.current = start + entries.length;
   // Read before older entries are put above, while the page still shows the ones being read.
   if (start < shownStart.current && scroller.current && !before.current)
      before.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };

   useLayoutEffect(() => {
      const element = scroller.current;
      if (!element) return;
      if (before.current && !stuck.current) element.scrollTop = before.current.top + element.scrollHeight - before.current.height;
      before.current = null;
      shownStart.current = start;
      if (stuck.current) element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
      // Older entries are asked for a screen before the top is reached, and again while they do not fill the screen.
      if (start > 0 && element.scrollTop < element.clientHeight) onOlder();
   }, [entries, start, running, onOlder]);

   // The view follows new output only while it is at the very end. Moving up by any amount lets go; reaching the end
   // again holds on. Other changes, such as the keyboard opening or the composer growing, leave it as it was.
   const follow = (value: boolean) => {
      stuck.current = value;
      setShowLatest(!value);
      onFollow?.(value);
   };

   // The view changes size when the composer folds away or comes back; at the end it stays at the end.
   useEffect(() => {
      const element = scroller.current;
      if (!element) return;
      const observer = new ResizeObserver(() => {
         resizedAt.current = performance.now();
         if (stuck.current) element.scrollTop = element.scrollHeight;
      });
      observer.observe(element);
      return () => observer.disconnect();
   }, []);

   const onScroll = () => {
      const element = scroller.current;
      if (!element) return;
      if (element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END) follow(true);
      else if (element.scrollTop < lastTop.current && performance.now() - resizedAt.current > SETTLE) follow(false);
      lastTop.current = element.scrollTop;
      if (start > 0 && element.scrollTop < element.clientHeight) onOlder();
   };

   const toLatest = () => {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
   };

   const lastIndex = start + (entries?.length ?? 0) - 1;
   const last = entries?.at(-1);
   const liveThought = running && last?.kind === 'thought';
   const isNew = (index: number) => index >= (initialEnd.current ?? 0);

   return (
      <div
         className="timeline"
         ref={scroller}
         onScroll={onScroll}
         // A finger or a wheel moving the view up lets go at once, before new output can pull it back down.
         onWheel={(event) => event.deltaY < 0 && follow(false)}
         onTouchStart={(event) => (touchY.current = event.touches[0].clientY)}
         onTouchMove={(event) => {
            if (touchY.current !== null && event.touches[0].clientY > touchY.current + TOUCH_SLOP) follow(false);
         }}
         aria-busy={entries === null}
      >
         <div className="timeline-content">
            {entries === null ? (
               <p className="timeline-status">{t('chat.loading')}</p>
            ) : entries.length === 0 && !running ? (
               <p className="timeline-status">{t('chat.empty')}</p>
            ) : (
               <ol className="timeline-list">
                  {start > 0 && (
                     <li className="timeline-older" role="status">
                        <ShimmerText>{t('chat.loadingOlder')}</ShimmerText>
                     </li>
                  )}
                  {group(entries, start).map((item) =>
                     item.kind === 'steps' ? (
                        <li key={item.key} className="timeline-item" data-kind="steps">
                           <ol className="timeline-steps">
                              {item.steps.map(({ entry, index }) => (
                                 <li key={entry.id} className="timeline-step" data-enter={isNew(index)}>
                                    <EntryView entry={entry} live={false} />
                                 </li>
                              ))}
                           </ol>
                        </li>
                     ) : (
                        <li key={item.key} className="timeline-item" data-kind={item.entry.kind} data-enter={isNew(item.index)}>
                           <EntryView entry={item.entry} live={running && item.index === lastIndex} />
                        </li>
                     ),
                  )}
               </ol>
            )}
            {running && !liveThought && (
               <p className="timeline-activity" role="status">
                  <span className="timeline-activity-dots" aria-hidden="true">
                     <span className="timeline-activity-dot" />
                     <span className="timeline-activity-dot" />
                     <span className="timeline-activity-dot" />
                  </span>
                  <ShimmerText>{t(`activity.${session.activity ?? 'thinking'}`)}</ShimmerText>
               </p>
            )}
         </div>
         {showLatest && (
            <button className="timeline-latest" type="button" onClick={toLatest}>
               <ArrowDown className="timeline-latest-icon" aria-hidden="true" />
               {t('chat.toLatest')}
            </button>
         )}
      </div>
   );
}
