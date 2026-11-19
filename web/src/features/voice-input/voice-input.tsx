import { Check, Mic, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listenVoice, uploadTicket } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import { MAX_SECONDS, record, type Recording } from './recorder';
import './voice-input.css';

const BARS = 28;

function clock(seconds: number) {
   const whole = Math.floor(seconds);
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Speech into the composer: the microphone button, and while it records a panel over the composer with the level,
// the time, cancel and done. The text is recognised by the hub and lands in the composer, to read before sending.
export function VoiceInput({ onText }: { onText: (text: string) => void }) {
   const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'recognising'>('idle');
   const [seconds, setSeconds] = useState(0);
   const [error, setError] = useState<string | null>(null);
   const recording = useRef<Recording | null>(null);
   const meter = useRef<HTMLSpanElement>(null);
   // The recording effect stops through this, so it always runs the latest finish.
   const finishing = useRef<() => Promise<void>>(async () => {});

   const start = async () => {
      setError(null);
      setPhase('starting');
      try {
         recording.current = await record();
         setSeconds(0);
         setPhase('recording');
      } catch (cause) {
         setPhase('idle');
         setError(t('voice.error.mic', { detail: cause instanceof Error ? cause.message : String(cause) }));
      }
   };

   const cancel = () => {
      recording.current?.cancel();
      recording.current = null;
      setPhase('idle');
   };

   const finish = async () => {
      const current = recording.current;
      if (!current) return;
      recording.current = null;
      const samples = current.stop();
      setPhase('recognising');
      try {
         const ticket = await uploadTicket();
         const stop = listenVoice(ticket, (event) => {
            if (event.text) onText(event.text);
            if (event.end) {
               stop();
               setPhase('idle');
               if (event.error) setError(t('voice.error', { detail: event.error }));
            }
         });
         const response = await fetch(`/voice?ticket=${encodeURIComponent(ticket)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: samples,
         });
         if (!response.ok) {
            stop();
            throw new Error(`${response.status} ${(await response.text()).trim()}`);
         }
      } catch (cause) {
         setPhase('idle');
         setError(t('voice.error', { detail: cause instanceof Error ? cause.message : String(cause) }));
      }
   };

   finishing.current = finish;

   // While recording: the level drawn every frame straight into the bars, the time a few times a second, a stop at
   // the length limit, and a stop with what was said if the page goes to the background.
   useEffect(() => {
      if (phase !== 'recording') return;
      const levels = new Array<number>(BARS).fill(0);
      let frame = 0;
      const draw = () => {
         const current = recording.current;
         const bars = meter.current?.children;
         if (current && bars) {
            levels.shift();
            levels.push(current.level());
            for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.08, levels[i])})`;
         }
         frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      const timer = setInterval(() => {
         const elapsed = recording.current?.seconds() ?? 0;
         setSeconds(elapsed);
         if (elapsed >= MAX_SECONDS) void finishing.current();
      }, 250);
      const onHidden = () => document.visibilityState === 'hidden' && void finishing.current();
      document.addEventListener('visibilitychange', onHidden);
      return () => {
         cancelAnimationFrame(frame);
         clearInterval(timer);
         document.removeEventListener('visibilitychange', onHidden);
      };
   }, [phase]);

   useEffect(() => () => recording.current?.cancel(), []);

   return (
      <>
         <button
            className="voice-button"
            type="button"
            onClick={() => void start()}
            disabled={phase !== 'idle'}
            aria-label={t('voice.start')}
            title={t('voice.start')}
         >
            <Mic className="voice-icon" aria-hidden="true" />
         </button>
         {(phase === 'recording' || phase === 'recognising') && (
            <div className="voice-panel" data-phase={phase} role="group" aria-label={t('voice.panel')}>
               {phase === 'recording' ? (
                  <>
                     <button
                        className="voice-panel-button"
                        type="button"
                        onClick={cancel}
                        aria-label={t('voice.cancel')}
                        title={t('voice.cancel')}
                     >
                        <X className="voice-icon" aria-hidden="true" />
                     </button>
                     <span className="voice-meter" ref={meter} aria-hidden="true">
                        {Array.from({ length: BARS }, (_, index) => (
                           <span key={index} className="voice-meter-bar" />
                        ))}
                     </span>
                     <time className="voice-clock" role="timer" aria-live="off">
                        {clock(seconds)}
                     </time>
                     <button
                        className="voice-panel-button voice-panel-button--done"
                        type="button"
                        onClick={() => void finish()}
                        aria-label={t('voice.done')}
                        title={t('voice.done')}
                     >
                        <Check className="voice-icon" aria-hidden="true" />
                     </button>
                  </>
               ) : (
                  <p className="voice-status" role="status">
                     <ShimmerText>{t('voice.recognising')}</ShimmerText>
                  </p>
               )}
            </div>
         )}
         {error && (
            <p className="voice-error" role="alert">
               <span className="voice-error-text">{error}</span>
               <button
                  className="voice-panel-button"
                  type="button"
                  onClick={() => setError(null)}
                  aria-label={t('voice.close')}
                  title={t('voice.close')}
               >
                  <X className="voice-icon" aria-hidden="true" />
               </button>
            </p>
         )}
      </>
   );
}
