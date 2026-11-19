import { useMemo } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { MarkdownFiles, MarkdownText } from '../../shared/ui/markdown';
import { Sheet } from '../../shared/ui/sheet';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import './file-viewer.css';

// A Markdown file of the chat's project read whole, such as a plan or a brief its agent wrote. Its own links to Markdown
// files open them here in turn.
export function FileViewer() {
   const file = useHub((state) => state.file);
   const close = useHub((state) => state.closeFile);
   const openFile = useHub((state) => state.openFile);
   const sessionId = file?.sessionId;
   const path = file?.path;
   const files = useMemo(
      () => (sessionId !== undefined && path !== undefined ? { open: (next: string) => openFile(sessionId, next), base: path } : null),
      [sessionId, path, openFile],
   );

   return (
      <Sheet open={file !== null} size="document" title={path?.split('/').at(-1) ?? ''} onClose={close}>
         {file && (
            <div className="file-viewer">
               <p className="file-viewer-path">{file.path}</p>
               {file.error ? (
                  <p className="file-viewer-error" role="alert">
                     {t(`file.error.${file.error}`)}
                  </p>
               ) : file.text === null ? (
                  <p className="file-viewer-note" role="status">
                     <ShimmerText>{t('file.loading')}</ShimmerText>
                  </p>
               ) : (
                  <MarkdownFiles.Provider value={files}>
                     <MarkdownText text={file.text} variant="document" />
                  </MarkdownFiles.Provider>
               )}
            </div>
         )}
      </Sheet>
   );
}
