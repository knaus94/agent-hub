import { useSyncExternalStore } from 'react';

// The one width at which the list and the chat sit side by side.
export const wideQuery = window.matchMedia('(min-width: 900px)');

export function useWide() {
   return useSyncExternalStore(
      (notify) => {
         wideQuery.addEventListener('change', notify);
         return () => wideQuery.removeEventListener('change', notify);
      },
      () => wideQuery.matches,
   );
}
