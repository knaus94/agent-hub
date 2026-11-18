import './status-dot.css';

export type DotState = 'running' | 'idle' | 'offline';

export function StatusDot({ state }: { state: DotState }) {
   return <span className="status-dot" data-state={state} aria-hidden="true" />;
}
