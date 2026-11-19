import { Menu, SquarePen, X, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { useWide } from '../../shared/lib/use-wide';
import './app-bar.css';

type Action = { icon: LucideIcon; label: string; onClick: () => void };

// What the bar of a pane offers beyond its screen: closing the pane, when chats are side by side, and the list when
// it is put away, in the pane where it would be.
export const PaneBar = createContext<{ close: (() => void) | null; list: boolean }>({ close: null, list: false });

// The top of every screen: the chat list behind a menu on a phone, or closing the pane beside others, what the screen
// is about, the screen's own action if it has one, and a new chat.
export function AppBar({ children, action }: { children: ReactNode; action?: Action }) {
   const wide = useWide();
   const openDrawer = useHub((state) => state.openDrawer);
   const listHidden = useHub((state) => state.listHidden);
   const pane = useContext(PaneBar);
   // The list is behind this button on a phone, and on a wide screen when it is put away.
   const menu = !wide || (listHidden && pane.list);
   const close = wide ? pane.close : null;
   const ActionIcon = action?.icon;
   return (
      <header className="app-bar" data-double={Boolean(action) || (menu && Boolean(close))}>
         <span className="app-bar-start">
            {menu && (
               <button
                  className="app-bar-button"
                  type="button"
                  onClick={openDrawer}
                  aria-label={t(wide ? 'list.show' : 'app.menu')}
                  title={t(wide ? 'list.show' : 'app.menu')}
               >
                  <Menu className="app-bar-icon" aria-hidden="true" />
               </button>
            )}
            {close && (
               <button className="app-bar-button" type="button" onClick={close} aria-label={t('pane.close')} title={t('pane.close')}>
                  <X className="app-bar-icon" aria-hidden="true" />
               </button>
            )}
         </span>
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
