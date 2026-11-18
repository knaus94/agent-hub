import { locale } from '../i18n';

const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
   ['second', 60],
   ['minute', 60],
   ['hour', 24],
   ['day', 7],
   ['week', 4.35],
   ['month', 12],
   ['year', Infinity],
];

export function formatAgo(timestamp: number, now: number) {
   let value = (timestamp - now) / 1000;
   for (const [unit, size] of STEPS) {
      if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
      value /= size;
   }
   return '';
}

export function formatPercent(part: number, whole: number) {
   return percent.format(whole ? part / whole : 0);
}

export function formatTokens(count: number) {
   return compact.format(count);
}

export function projectName(cwd: string | null) {
   return cwd?.split('/').filter(Boolean).at(-1) ?? null;
}

// Agents print colours and cursor moves meant for a terminal.
export function stripAnsi(text: string) {
   return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, '');
}
