import { Bell, BellOff, BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import { currentSubscription, pushState, subscribe, type PushState } from './push';
import './notifications-toggle.css';

// The bell in the chat list: turns notifications on and off, or says why they cannot be on here and what to do.
export function NotificationsToggle() {
   const key = useHub((state) => state.push);
   const connected = useHub((state) => state.connection === 'open');
   const sendSubscription = useHub((state) => state.pushSubscribe);
   const dropSubscription = useHub((state) => state.pushUnsubscribe);
   const [state, setState] = useState<PushState | null>(null);
   const [busy, setBusy] = useState(false);
   const [explain, setExplain] = useState(false);
   const [error, setError] = useState<string | null>(null);

   // The hub hears this browser's subscription again on every connection, so it outlives a lost or reset list there.
   useEffect(() => {
      if (!key) return;
      let current = true;
      void pushState().then(async (found) => {
         if (!current) return;
         setState(found);
         const subscription = found === 'on' && connected ? await currentSubscription() : null;
         if (current && subscription) sendSubscription(subscription.toJSON());
      });
      return () => {
         current = false;
      };
   }, [key, connected, sendSubscription]);

   if (!key || !state) return null;

   const toggle = async () => {
      if (state !== 'on' && state !== 'off') {
         setExplain(true);
         return;
      }
      setBusy(true);
      setError(null);
      try {
         if (state === 'off') {
            // Asked straight from the tap: a browser shows the question only in answer to one.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
               setState(permission === 'denied' ? 'denied' : 'off');
               if (permission === 'denied') setExplain(true);
               return;
            }
            sendSubscription((await subscribe(key)).toJSON());
            setState('on');
         } else {
            const subscription = await currentSubscription();
            if (subscription) {
               dropSubscription(subscription.endpoint);
               await subscription.unsubscribe();
            }
            setState('off');
         }
      } catch (cause) {
         setError(cause instanceof Error ? cause.message : String(cause));
         setExplain(true);
      } finally {
         setBusy(false);
      }
   };

   const Icon = state === 'on' ? BellRing : state === 'off' ? Bell : BellOff;
   const label = t(state === 'on' ? 'push.off' : state === 'off' ? 'push.on' : 'push.unavailable');
   return (
      <>
         <button
            className="notifications-toggle"
            type="button"
            data-state={state}
            onClick={() => void toggle()}
            disabled={busy}
            aria-label={label}
            title={label}
         >
            <Icon className="notifications-toggle-icon" aria-hidden="true" />
         </button>
         <Sheet open={explain} title={t('push.title')} onClose={() => setExplain(false)}>
            <p className="notifications-toggle-text">
               {error ? t('push.error', { detail: error }) : t(`push.explain.${state === 'on' || state === 'off' ? 'unsupported' : state}`)}
            </p>
         </Sheet>
      </>
   );
}
