import { Fragment, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { MAX_PANES, roomBeside, shownPanes, useHub, type Pane } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { useWide } from '../../shared/lib/use-wide';
import { PaneClose } from '../app-bar/app-bar';
import { CHAT_DRAG } from '../../entities/session/chat-drag';
import './panes.css';

// The narrowest a pane is opened at: a chat is laid out for a phone, so this is a wide phone's width.
const PANE_MIN = 440;
// A pane dragged narrower than this stops; the keyboard moves a border by STEP of the width.
const PANE_SMALLEST = 320;
const STEP = 0.05;
const SIZES_KEY = 'agent-hub.pane-sizes';

type Zone = 'before' | 'after' | 'replace';

// The shares of the width the panes take, kept per number of panes.
function readSizes(count: number) {
   try {
      const kept: unknown = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}');
      const sizes = kept && typeof kept === 'object' ? (kept as Record<string, unknown>)[count] : undefined;
      if (Array.isArray(sizes) && sizes.length === count && sizes.every((size) => typeof size === 'number' && size > 0))
         return sizes as number[];
   } catch {
      // A broken record gives equal panes.
   }
   return Array<number>(count).fill(1);
}

function saveSizes(sizes: number[]) {
   let kept: Record<string, number[]> = {};
   try {
      kept = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Record<string, number[]>;
   } catch {
      // Replaced below.
   }
   localStorage.setItem(SIZES_KEY, JSON.stringify({ ...kept, [sizes.length]: sizes }));
}

function columns(sizes: number[]) {
   return sizes.map((size) => `minmax(0, ${size}fr)`).join(' auto ');
}

// Moves the border after pane `index` by `delta` of the total of sizes, keeping both panes at least `least` wide.
function moved(sizes: number[], index: number, delta: number, least: number) {
   const pair = sizes[index] + sizes[index + 1];
   const left = Math.min(Math.max(sizes[index] + delta, least), pair - least);
   return sizes.with(index, left).with(index + 1, pair - left);
}

// The chats on screen side by side, as many as the width holds, with borders to move between them; one on a phone. A
// chat dragged from the list goes beside a pane, dropped at its edge, or in its place, dropped in its middle.
export function Panes({ render }: { render: (chat: Pane) => ReactNode }) {
   const wide = useWide();
   const panes = useHub((state) => state.panes);
   const focused = useHub((state) => state.focused);
   const shown = useHub((state) => state.shown);
   const room = useHub(roomBeside);
   const setShown = useHub((state) => state.setShown);
   const focusPane = useHub((state) => state.focusPane);
   const closePane = useHub((state) => state.closePane);
   const openBeside = useHub((state) => state.openBeside);
   const showIn = useHub((state) => state.showIn);
   const grid = useRef<HTMLDivElement>(null);
   const indexes = wide ? shownPanes(panes.length, focused, shown) : [focused];
   const [sizes, setSizes] = useState(() => readSizes(indexes.length));
   const [drop, setDrop] = useState<{ index: number; zone: Zone } | null>(null);
   if (sizes.length !== indexes.length) setSizes(readSizes(indexes.length));

   useLayoutEffect(() => {
      const element = grid.current;
      if (!wide || !element) {
         setShown(1);
         return;
      }
      const fit = (width: number) => setShown(Math.min(Math.max(Math.floor(width / PANE_MIN), 1), MAX_PANES));
      fit(element.clientWidth);
      const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
      observer.observe(element);
      return () => observer.disconnect();
   }, [wide, setShown]);

   // A border follows the pointer by writing the columns straight to the grid; the panes are drawn again only once,
   // when it is let go.
   const startResize = (index: number, event: PointerEvent<HTMLDivElement>) => {
      const element = grid.current;
      if (!element) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const total = sizes.reduce((sum, size) => sum + size, 0);
      const perPixel = total / element.clientWidth;
      const startX = event.clientX;
      let next = sizes;
      const target = event.currentTarget;
      const move = (moveEvent: globalThis.PointerEvent) => {
         next = moved(sizes, index, (moveEvent.clientX - startX) * perPixel, PANE_SMALLEST * perPixel);
         element.style.gridTemplateColumns = columns(next);
      };
      const end = () => {
         target.removeEventListener('pointermove', move);
         target.removeEventListener('pointerup', end);
         target.removeEventListener('pointercancel', end);
         setSizes(next);
         saveSizes(next);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', end);
      target.addEventListener('pointercancel', end);
   };

   const resizeByKey = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
      const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      const element = grid.current;
      if (!direction || !element) return;
      event.preventDefault();
      const total = sizes.reduce((sum, size) => sum + size, 0);
      const next = moved(sizes, index, direction * STEP * total, (PANE_SMALLEST * total) / element.clientWidth);
      setSizes(next);
      saveSizes(next);
   };

   const dragOver = (index: number, event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(CHAT_DRAG)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const zone: Zone = room && x < 0.25 ? 'before' : room && x > 0.75 ? 'after' : 'replace';
      if (drop?.index !== index || drop.zone !== zone) setDrop({ index, zone });
   };

   const dropChat = (index: number, event: DragEvent<HTMLDivElement>) => {
      const chat = event.dataTransfer.getData(CHAT_DRAG);
      if (!chat) return;
      // Dropped on the composer, the chat's address would otherwise be typed into it.
      event.preventDefault();
      const zone = drop?.index === index ? drop.zone : 'replace';
      setDrop(null);
      if (zone === 'replace') showIn(index, chat);
      else openBeside(chat, zone === 'before' ? index : index + 1);
   };

   const closable = wide && panes.length > 1;
   return (
      <div
         ref={grid}
         className="panes"
         style={{ gridTemplateColumns: columns(sizes) }}
         onDragLeave={(event) => !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) && setDrop(null)}
      >
         {indexes.map((index, position) => (
            <Fragment key={panes[index] ?? ''}>
               {position > 0 && (
                  <div
                     className="panes-divider"
                     data-dropping={drop !== null}
                     role="separator"
                     aria-orientation="vertical"
                     aria-label={t('pane.divider')}
                     aria-valuemin={0}
                     aria-valuemax={100}
                     aria-valuenow={Math.round((sizes[position - 1] / (sizes[position - 1] + sizes[position])) * 100)}
                     tabIndex={0}
                     onPointerDown={(event) => startResize(position - 1, event)}
                     onKeyDown={(event) => resizeByKey(position - 1, event)}
                  />
               )}
               <div
                  className="pane"
                  data-focused={indexes.length > 1 && index === focused}
                  onPointerDownCapture={() => focusPane(index)}
                  onFocusCapture={() => focusPane(index)}
                  onDragOverCapture={(event) => dragOver(index, event)}
                  onDropCapture={(event) => dropChat(index, event)}
               >
                  <PaneClose.Provider value={closable ? () => closePane(index) : null}>{render(panes[index])}</PaneClose.Provider>
                  {drop?.index === index && <div className="pane-drop" data-zone={drop.zone} aria-hidden="true" />}
               </div>
            </Fragment>
         ))}
      </div>
   );
}
