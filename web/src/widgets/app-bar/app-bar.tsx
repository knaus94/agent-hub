import { Menu, SquarePen, X, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { useWide } from '../../shared/lib/use-wide';
import './app-bar.css';

type Action = { icon: LucideIcon; label: string; onClick: () => void };

// Closes the pane the bar is in, when chats are side by side.
export const PaneClose = createContext<(() => void) | null>(null);

// The top of every screen: the chat list behind a menu on a phone, or closing the pane beside others, what the screen
// is about, the screen's own action if it has one, and a new chat.
export function AppBar({ children, action }: { children: ReactNode; action?: Action }) {
   const wide = useWide();
   const openDrawer = useHub((state) => state.openDrawer);
   const closePane = useContext(PaneClose);
   const ActionIcon = action?.icon;
   return (
      <header className="app-bar" data-action={Boolean(action)}>
         {wide && closePane ? (
            <button className="app-bar-button" type="button" onClick={closePane} aria-label={t('pane.close')} title={t('pane.close')}>
               <X className="app-bar-icon" aria-hidden="true" />
            </button>
         ) : wide ? (
            <span className="app-bar-slot" aria-hidden="true" />
         ) : (
            <button className="app-bar-button" type="button" onClick={openDrawer} aria-label={t('app.menu')} title={t('app.menu')}>
               <Menu className="app-bar-icon" aria-hidden="true" />
            </button>
         )}
         <div className="app-bar-center">{children}</div>
         <span className="app-bar-end">
            {action && ActionIcon && (
               <button className="app-bar-button" type="button" onClick={action.onClick} aria-label={action.label} title={action.label}>
                  <ActionIcon className="app-bar-icon" aria-hidden="true" />
               </button>
            )}
            <a className="app-bar-button" href="#/" aria-label={t('list.new')} title={t('list.new')}>
               <SquarePen className="app-bar-icon" aria-hidden="true" />
            </a>
         </span>
      </header>
   );
}
