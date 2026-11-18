import { t } from '../../shared/i18n';
import { formatPercent, formatTokens } from '../../shared/lib/format';
import './context-meter.css';

// How full the chat's context is: a ring that turns amber and then red as it fills, with the share and the tokens
// beside it, since a touch screen shows no tooltip.
export function ContextMeter({ used, size }: { used: number; size: number }) {
   const share = size ? Math.min(used / size, 1) : 0;
   const level = share >= 0.9 ? 'full' : share >= 0.7 ? 'high' : 'ok';
   const percent = formatPercent(used, size);
   const tokens = { used: formatTokens(used), size: formatTokens(size) };
   return (
      <span
         className="context-meter"
         data-level={level}
         role="meter"
         aria-valuemin={0}
         aria-valuemax={size}
         aria-valuenow={used}
         aria-valuetext={t('chat.context.full', { percent, ...tokens })}
      >
         <svg className="context-meter-ring" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="context-meter-track" cx="10" cy="10" r="8" pathLength="100" />
            <circle className="context-meter-fill" cx="10" cy="10" r="8" pathLength="100" style={{ strokeDasharray: `${share * 100} 100` }} />
         </svg>
         <span className="context-meter-percent" aria-hidden="true">
            {percent}
         </span>
         <span className="context-meter-tokens" aria-hidden="true">
            {t('chat.context.tokens', tokens)}
         </span>
      </span>
   );
}
