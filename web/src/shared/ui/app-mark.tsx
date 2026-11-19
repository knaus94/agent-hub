import './app-mark.css';

// The app's icon, a dot in a ring; the ring breathes while agents work. Its size is the --app-mark-size it is given.
export function AppMark({ busy = false, className }: { busy?: boolean; className?: string }) {
   return (
      <svg className={className ? `app-mark ${className}` : 'app-mark'} viewBox="0 0 24 24" aria-hidden="true">
         <circle className="app-mark-ring" data-busy={busy} cx="12" cy="12" r="9" />
         <circle className="app-mark-dot" cx="12" cy="12" r="4.5" />
      </svg>
   );
}
