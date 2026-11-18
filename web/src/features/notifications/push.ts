// What this browser can do about notifications. An iPhone offers push only to the app added to the home screen, so
// Safari in a tab has no PushManager at all; that is told apart from a browser that cannot do push anywhere.
export type PushState = 'install' | 'unsupported' | 'denied' | 'off' | 'on';

function standalone() {
   return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function apple() {
   return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function pushState(): Promise<PushState> {
   if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
      return apple() && !standalone() ? 'install' : 'unsupported';
   if (Notification.permission === 'denied') return 'denied';
   const registration = await navigator.serviceWorker.ready;
   return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function currentSubscription() {
   const registration = await navigator.serviceWorker.ready;
   return registration.pushManager.getSubscription();
}

export async function subscribe(key: string) {
   const registration = await navigator.serviceWorker.ready;
   const padded = key.replace(/-/g, '+').replace(/_/g, '/');
   const applicationServerKey = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
   return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

// The service worker shows notifications and, when one is tapped with the app open, tells the page which chat.
export function registerWorker() {
   if (!('serviceWorker' in navigator)) return;
   void navigator.serviceWorker.register('/sw.js');
   navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string; hash?: string }>) => {
      if (event.data?.type === 'open' && event.data.hash) location.hash = event.data.hash;
   });
}
