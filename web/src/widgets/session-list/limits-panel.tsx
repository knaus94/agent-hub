import { ChevronDown, Gauge } from 'lucide-react';
import { useId, useState } from 'react';
import { useHub } from '../../entities/hub/hub-store';
import { t } from '../../shared/i18n';
import { formatAgo, formatLeft, formatPercent } from '../../shared/lib/format';
import type { Limit, LimitAccount } from '../../shared/protocol.ts';
import { limitLevel, limitPace } from './limits';
import './limits-panel.css';

const OPEN_KEY = 'agent-hub.limits-open';

function weekOf(account: LimitAccount) {
   return account.limits.find((limit) => limit.kind === 'week');
}

// One limit as a bar, with a tick where an even pace through the week would be now.
function LimitMeter({ limit, stale, now }: { limit: Limit; stale: boolean; now: number }) {
   const pace = limitPace(limit, now);
   const name = limit.kind === 'model' ? limit.model : t('limits.week');
   const value = formatPercent(limit.percent, 100);
   return (
      <div
         className="limits-meter"
         data-kind={limit.kind}
         data-level={limitLevel(limit.percent)}
         data-active={limit.active}
         role="meter"
         aria-label={name}
         aria-valuemin={0}
         aria-valuemax={100}
         aria-valuenow={limit.percent}
         aria-valuetext={limit.active ? value : t('limits.inactive', { percent: value })}
      >
         <span className="limits-meter-name" aria-hidden="true">
            {name}
         </span>
         <span className="limits-meter-track" aria-hidden="true">
            <span className="limits-meter-fill" style={{ inlineSize: `${Math.min(limit.percent, 100)}%` }} />
            {pace && <span className="limits-meter-pace" style={{ insetInlineStart: `${pace.expected}%` }} />}
         </span>
         <span className="limits-meter-value" aria-hidden="true">
            {stale ? `~${value}` : value}
         </span>
      </div>
   );
}

function AccountLimits({ account, now }: { account: LimitAccount; now: number }) {
   const week = weekOf(account);
   const pace = week?.active ? limitPace(week, now) : null;
   return (
      <li className="limits-account" data-agent={account.agent}>
         <p className="limits-account-head">
            <span className="limits-account-name" title={account.email}>
               <span className="limits-account-agent">{t(`agent.${account.agent}`)}</span> {account.email.split('@')[0]}
            </span>
            {pace?.runsOut ? (
               <span className="limits-account-note" data-warn="true">
                  {t('limits.runsOut', { left: formatLeft(pace.runsOut, now) })}
               </span>
            ) : week?.resetsAt ? (
               <span className="limits-account-note">{t('limits.reset', { left: formatLeft(week.resetsAt, now) })}</span>
            ) : null}
         </p>
         {account.limits.map((limit) => (
            <LimitMeter key={`${limit.kind}:${limit.model ?? ''}`} limit={limit} stale={Boolean(account.error)} now={now} />
         ))}
         {account.error && (
            <p className="limits-account-error">
               {t(`limits.error.${account.error}`)}
               {account.checked > 0 && ` · ${t('limits.checked', { ago: formatAgo(account.checked, now) })}`}
            </p>
         )}
      </li>
   );
}

// The agents' subscription limits under the chat list: the week's share of each account at a glance, the bars, reset
// times and forecasts when unfolded. Nothing shows while the hub knows no subscription account.
export function LimitsPanel({ now }: { now: number }) {
   const accounts = useHub((state) => state.limits);
   const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === 'true');
   const listId = useId();
   if (!accounts.length) return null;

   const toggle = () => {
      localStorage.setItem(OPEN_KEY, String(!open));
      setOpen(!open);
   };
   return (
      <section className="limits" aria-label={t('limits.title')}>
         <button className="limits-toggle" type="button" aria-expanded={open} aria-controls={listId} onClick={toggle}>
            <Gauge className="limits-toggle-icon" aria-hidden="true" />
            <span className="limits-toggle-label">{t('limits.title')}</span>
            {!open && (
               <span className="limits-summary">
                  {accounts.map((account) => {
                     const week = weekOf(account);
                     return (
                        <span
                           key={account.id}
                           className="limits-chip"
                           data-agent={account.agent}
                           data-level={week ? limitLevel(week.percent) : 'ok'}
                           data-stale={Boolean(account.error)}
                           title={account.email}
                        >
                           {week ? formatPercent(week.percent, 100) : '—'}
                        </span>
                     );
                  })}
               </span>
            )}
            <ChevronDown className="limits-toggle-chevron" aria-hidden="true" />
         </button>
         {open && (
            <ul className="limits-accounts" id={listId}>
               {accounts.map((account) => (
                  <AccountLimits key={account.id} account={account} now={now} />
               ))}
            </ul>
         )}
      </section>
   );
}
