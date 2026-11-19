import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Image } from '../protocol.ts';
import './image-gallery.css';

const source = (image: Image) => `data:${image.mimeType};base64,${image.data}`;

// One picture over the page at full size; a tap anywhere, the button or Escape closes it. It opens with focus on the
// picture, as the sheet does on its panel: on the button Safari draws its focus ring.
function ImageViewer({ image, onClose }: { image: Image; onClose: () => void }) {
   const dialog = useRef<HTMLDialogElement>(null);
   const picture = useRef<HTMLImageElement>(null);
   useEffect(() => {
      picture.current?.setAttribute('autofocus', '');
      dialog.current?.showModal();
   }, []);
   return (
      <dialog ref={dialog} className="image-viewer" aria-label={t('image.title')} onClose={onClose} onClick={() => dialog.current?.close()}>
         <img ref={picture} className="image-viewer-image" src={source(image)} alt="" tabIndex={-1} />
         <button className="image-viewer-close" type="button" aria-label={t('sheet.close')} title={t('sheet.close')}>
            <X className="image-viewer-icon" aria-hidden="true" />
         </button>
      </dialog>
   );
}

// Pictures in a chat as thumbnails, each opening at full size.
export function ImageGallery({ images }: { images: Image[] }) {
   const [open, setOpen] = useState<number | null>(null);
   return (
      <>
         <ul className="image-gallery">
            {images.map((image, index) => (
               <li key={index}>
                  <button
                     className="image-gallery-thumb"
                     type="button"
                     onClick={() => setOpen(index)}
                     aria-label={t('image.open', { number: index + 1 })}
                  >
                     <img className="image-gallery-image" src={source(image)} alt="" loading="lazy" draggable={false} />
                  </button>
               </li>
            ))}
         </ul>
         {open !== null && <ImageViewer image={images[open]} onClose={() => setOpen(null)} />}
      </>
   );
}
