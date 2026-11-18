import { useEffect, useRef } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { SessionList } from '../session-list/session-list';
import './drawer.css';

// The chat list on a phone, slid in from the side over the current chat.
export function Drawer() {
   const open = useHub((state) => state.drawerOpen);
   const close = useHub((state) => state.closeDrawer);
   const dialog = useRef<HTMLDialogElement>(null);
   const panel = useRef<HTMLDivElement>(null);

   useEffect(() => {
      const element = dialog.current;
      if (!element) return;
      // Focus goes to the panel, as in the sheet: on the first button Safari draws its focus ring as the list opens.
      panel.current?.setAttribute('autofocus', '');
      if (open && !element.open) element.showModal();
      if (!open && element.open) element.close();
   }, [open]);

   return (
      <dialog
         ref={dialog}
         className="drawer"
         aria-label={t('list.title')}
         onClose={close}
         onClick={(event) => event.target === dialog.current && close()}
      >
         <div ref={panel} className="drawer-panel" tabIndex={-1}>
            <SessionList />
         </div>
      </dialog>
   );
}
