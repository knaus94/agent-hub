import type { ReactNode } from 'react';
import './shimmer-text.css';

// A label that glints while something is in progress.
export function ShimmerText({ children }: { children: ReactNode }) {
   return <span className="shimmer-text">{children}</span>;
}
