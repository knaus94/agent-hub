import { ChevronUp, Circle, CircleCheck, CircleDot, ListChecks } from 'lucide-react';
import type { PlanItem } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';
import './plan-panel.css';

const ICONS = { pending: Circle, in_progress: CircleDot, completed: CircleCheck } as const;

export function PlanPanel({ plan }: { plan: PlanItem[] }) {
   const done = plan.filter((item) => item.status === 'completed').length;
   return (
      <details className="plan-panel">
         <summary className="plan-panel-summary">
            <ListChecks className="plan-panel-icon" aria-hidden="true" />
            <span className="plan-panel-title">{t('plan.title')}</span>
            <span className="plan-panel-progress">{t('plan.progress', { done, total: plan.length })}</span>
            <ChevronUp className="plan-panel-chevron" aria-hidden="true" />
         </summary>
         <ol className="plan-panel-items">
            {plan.map((item, index) => {
               const Icon = ICONS[item.status];
               return (
                  <li key={index} className="plan-panel-item" data-status={item.status}>
                     <Icon className="plan-panel-item-icon" aria-hidden="true" />
                     <span className="plan-panel-item-text">{item.content}</span>
                     <span className="visually-hidden">{t(`plan.status.${item.status}`)}</span>
                  </li>
               );
            })}
         </ol>
      </details>
   );
}
