import { Check, ChevronDown, FolderGit2, Search, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { ProjectOption } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import './pickers.css';

// The directory a new chat works in, shown as a chip inside the composer.
export function ProjectPicker({
   projects,
   value,
   onChange,
}: {
   projects: ProjectOption[];
   value: string | null;
   onChange: (path: string) => void;
}) {
   const [open, setOpen] = useState(false);
   const [query, setQuery] = useState('');
   const search = useRef<HTMLInputElement>(null);
   const searchId = useId();
   const current = projects.find((option) => option.path === value);
   const needle = query.trim().toLowerCase();
   const shown = needle ? projects.filter((option) => option.path.toLowerCase().includes(needle)) : projects;

   const close = () => {
      setOpen(false);
      setQuery('');
   };

   return (
      <>
         <button className="picker-chip" type="button" onClick={() => setOpen(true)} disabled={projects.length === 0} aria-haspopup="dialog">
            <FolderGit2 className="picker-chip-icon" aria-hidden="true" />
            <span className="picker-chip-text">{current?.name ?? t('new.noProjects')}</span>
            <ChevronDown className="picker-chip-icon" aria-hidden="true" />
         </button>
         <Sheet open={open} title={t('picker.project')} onClose={close}>
            <div className="picker-search">
               <Search className="picker-chip-icon" aria-hidden="true" />
               <label className="visually-hidden" htmlFor={searchId}>
                  {t('picker.search')}
               </label>
               <input
                  ref={search}
                  id={searchId}
                  className="picker-search-input"
                  type="search"
                  value={query}
                  placeholder={t('picker.search')}
                  onChange={(event) => setQuery(event.target.value)}
               />
               {query && (
                  <button
                     className="picker-search-clear"
                     type="button"
                     aria-label={t('picker.clear')}
                     onClick={() => {
                        setQuery('');
                        search.current?.focus();
                     }}
                  >
                     <X className="picker-chip-icon" aria-hidden="true" />
                  </button>
               )}
            </div>
            {shown.length === 0 && <p className="picker-empty">{t('picker.nothing')}</p>}
            <ul className="picker-options">
               {shown.map((option) => (
                  <li key={option.path}>
                     <button
                        className="picker-option"
                        type="button"
                        aria-current={option.path === value}
                        onClick={() => {
                           onChange(option.path);
                           close();
                        }}
                     >
                        <FolderGit2 className="picker-option-icon" aria-hidden="true" />
                        <span className="picker-option-text">
                           <span className="picker-option-name">{option.name}</span>
                           <span className="picker-option-detail" title={option.path}>
                              {option.path}
                           </span>
                        </span>
                        {option.path === value && <Check className="picker-option-check" aria-hidden="true" />}
                     </button>
                  </li>
               ))}
            </ul>
         </Sheet>
      </>
   );
}
