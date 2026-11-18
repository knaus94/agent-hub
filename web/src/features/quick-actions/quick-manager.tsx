import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import type { Command, QuickAction } from '../../shared/protocol.ts';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import { QuickForm } from './quick-form';
import '../pickers/pickers.css';
import './quick-manager.css';

function newAction(): QuickAction {
   return { id: crypto.randomUUID(), label: '', text: '', agents: [], send: true };
}

// Where quick actions are made: the list of them, and in the same sheet the form for one. They are kept by the hub,
// so the phone and the computer share them.
export function QuickManager({ commands }: { commands: Command[] }) {
   const actions = useHub((state) => state.quick);
   const save = useHub((state) => state.saveQuick);
   const [open, setOpen] = useState(false);
   const [editing, setEditing] = useState<QuickAction | null>(null);
   const known = editing !== null && actions.some((action) => action.id === editing.id);

   const close = () => {
      setOpen(false);
      setEditing(null);
   };

   const put = (changed: QuickAction) => {
      const index = actions.findIndex((action) => action.id === changed.id);
      save(index < 0 ? [...actions, changed] : actions.with(index, changed));
      setEditing(null);
   };

   const move = (index: number, step: number) => {
      const next = actions.slice();
      [next[index], next[index + step]] = [next[index + step], next[index]];
      save(next);
   };

   const agentsOf = (action: QuickAction) =>
      action.agents.length === 0 ? t('quick.agents.all') : action.agents.map((agent) => t(`quick.agent.${agent}`)).join(', ');

   return (
      <>
         <button
            className="picker-chip"
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={t('quick.title')}
            title={t('quick.title')}
         >
            <Zap className="picker-chip-icon" aria-hidden="true" />
         </button>
         <Sheet open={open} title={editing ? t(known ? 'quick.edit' : 'quick.new') : t('quick.title')} onClose={close}>
            {editing ? (
               <QuickForm key={editing.id} action={editing} commands={commands} onSave={put} onCancel={() => setEditing(null)} />
            ) : (
               <div className="quick-manager">
                  {actions.length === 0 && <p className="quick-manager-empty">{t('quick.empty')}</p>}
                  {actions.length > 0 && (
                     <ol className="quick-manager-list">
                        {actions.map((action, index) => (
                           <li key={action.id} className="quick-manager-item">
                              <span className="quick-manager-body">
                                 <span className="quick-manager-name">{action.label}</span>
                                 <span className="quick-manager-text">{action.text}</span>
                                 <span className="quick-manager-meta">
                                    {agentsOf(action)} · {t(action.send ? 'quick.mode.sendShort' : 'quick.mode.insertShort')}
                                 </span>
                              </span>
                              <span className="quick-manager-tools">
                                 <button
                                    className="quick-manager-tool"
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                    aria-label={t('quick.up', { name: action.label })}
                                    title={t('quick.up', { name: action.label })}
                                 >
                                    <ArrowUp className="quick-manager-tool-icon" aria-hidden="true" />
                                 </button>
                                 <button
                                    className="quick-manager-tool"
                                    type="button"
                                    disabled={index === actions.length - 1}
                                    onClick={() => move(index, 1)}
                                    aria-label={t('quick.down', { name: action.label })}
                                    title={t('quick.down', { name: action.label })}
                                 >
                                    <ArrowDown className="quick-manager-tool-icon" aria-hidden="true" />
                                 </button>
                                 <button
                                    className="quick-manager-tool"
                                    type="button"
                                    onClick={() => setEditing(action)}
                                    aria-label={t('quick.change', { name: action.label })}
                                    title={t('quick.change', { name: action.label })}
                                 >
                                    <Pencil className="quick-manager-tool-icon" aria-hidden="true" />
                                 </button>
                                 <button
                                    className="quick-manager-tool quick-manager-tool--danger"
                                    type="button"
                                    onClick={() => save(actions.filter((other) => other.id !== action.id))}
                                    aria-label={t('quick.delete', { name: action.label })}
                                    title={t('quick.delete', { name: action.label })}
                                 >
                                    <Trash2 className="quick-manager-tool-icon" aria-hidden="true" />
                                 </button>
                              </span>
                           </li>
                        ))}
                     </ol>
                  )}
                  <button className="quick-manager-add" type="button" onClick={() => setEditing(newAction())}>
                     <Plus className="quick-manager-tool-icon" aria-hidden="true" />
                     {t('quick.add')}
                  </button>
               </div>
            )}
         </Sheet>
      </>
   );
}
