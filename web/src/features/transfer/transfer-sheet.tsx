import type { SessionSummary } from '../../shared/protocol.ts';
import { useHub } from '../../entities/hub/hub-store';
import { AgentMark } from '../../entities/session/agent-mark';
import { t } from '../../shared/i18n';
import { Sheet } from '../../shared/ui/sheet';
import { ShimmerText } from '../../shared/ui/shimmer-text';
import './transfer-sheet.css';

// Where to go on with a chat: every agent of Zed's, each saying whether the conversation goes over whole or retold.
export function TransferSheet({ session }: { session: SessionSummary }) {
   const transfer = useHub((state) => state.transfer);
   const agents = useHub((state) => state.agents);
   const failure = useHub((state) => state.failure);
   const close = useHub((state) => state.closeTransfer);
   const start = useHub((state) => state.startTransfer);
   const current = transfer?.sessionId === session.id ? transfer : null;
   const failed = failure?.sessionId === session.id && failure.reason.startsWith('transfer') ? failure.reason : null;

   return (
      <Sheet open={current !== null} title={t('transfer.title')} onClose={close}>
         <div className="transfer">
            <p className="transfer-hint">{t('transfer.hint')}</p>
            {failed && (
               <p className="transfer-error" role="alert">
                  {t(`failed.${failed}`)}
               </p>
            )}
            {(!current?.targets || current.busy) && (
               <p className="transfer-status" role="status">
                  <ShimmerText>{t(current?.busy ? 'transfer.busy' : 'transfer.loading')}</ShimmerText>
               </p>
            )}
            {current?.targets && (
               <ul className="transfer-list">
                  {current.targets.map((target) => {
                     const agent = agents.find((option) => option.id === target.agentId);
                     if (!agent) return null;
                     return (
                        <li key={target.agentId}>
                           <button className="transfer-option" type="button" disabled={current.busy} onClick={() => start(target.agentId)}>
                              <AgentMark agent={agent.agent} />
                              <span className="transfer-option-body">
                                 <span className="transfer-option-name">{agent.label}</span>
                                 {agent.label === session.label && <span className="transfer-option-meta">{t('transfer.current')}</span>}
                              </span>
                              <span className="transfer-mode" data-mode={target.mode}>
                                 {t(`transfer.${target.mode}`)}
                              </span>
                           </button>
                        </li>
                     );
                  })}
               </ul>
            )}
         </div>
      </Sheet>
   );
}
