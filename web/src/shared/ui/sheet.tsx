import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import './sheet.css';

// A picker that rises from the bottom on a phone and sits in the middle on a wide screen. The native dialog keeps focus
// inside, closes on Escape and makes the page behind it inert. It opens with focus on the panel itself: focused on its
// first option, Safari outlined that option, scrolled the dialog to it mid-animation, and a search field opened the
// keyboard over the list. It lives in the body: opened from the composer, it would otherwise sit inside the composer's
// form, where a form of its own reloads the page when submitted and a disabled composer disables it too. A "document"
// sheet is a page to read: it takes nearly the whole screen, so it has a close button instead of a backdrop to tap.
export function Sheet({
   open,
   title,
   onClose,
   size = 'picker',
   children,
}: {
   open: boolean;
   title: string;
   onClose: () => void;
   size?: 'picker' | 'document';
   children: ReactNode;
}) {
   const dialog = useRef<HTMLDialogElement>(null);
   const panel = useRef<HTMLDivElement>(null);
   const titleId = useId();

   useEffect(() => {
      const element = dialog.current;
      if (!element) return;
      // React's autoFocus calls focus() on mount instead of setting the attribute the dialog looks for when it opens.
      panel.current?.setAttribute('autofocus', '');
      if (open && !element.open) element.showModal();
      if (!open && element.open) element.close();
   }, [open]);

   return createPortal(
      <dialog
         ref={dialog}
         className="sheet"
         aria-labelledby={titleId}
         onClose={onClose}
         onClick={(event) => event.target === dialog.current && onClose()}
      >
         <div ref={panel} className="sheet-panel" data-size={size} tabIndex={-1}>
            <span className="sheet-grip" aria-hidden="true" />
            <h2 className="sheet-title" id={titleId} data-size={size}>
               {title}
            </h2>
            {size === 'document' && (
               <button className="sheet-close" type="button" onClick={onClose} aria-label={t('sheet.close')} title={t('sheet.close')}>
                  <X className="sheet-close-icon" aria-hidden="true" />
               </button>
            )}
            <div className="sheet-body">{children}</div>
         </div>
      </dialog>,
      document.body,
   );
}
