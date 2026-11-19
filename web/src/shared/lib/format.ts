import { locale } from '../i18n';

const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
const [days, hours, minutes] = (['day', 'hour', 'minute'] as const).map(
   (unit) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }),
);
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
   // The list refreshes its "now" every so often, while a running chat keeps updating: that is just now, not ahead.
   let value = (Math.min(timestamp, now) - now) / 1000;
   for (const [unit, size] of STEPS) {
      if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
      value /= size;
   }
   return '';
}

// How long until a moment ahead, in its two largest units: "4 д 6 ч".
export function formatLeft(timestamp: number, now: number) {
   const left = Math.max(0, Math.floor((timestamp - now) / 60_000));
   const [day, hour, minute] = [Math.floor(left / 1440), Math.floor((left % 1440) / 60), left % 60];
   if (day) return hour ? `${days.format(day)} ${hours.format(hour)}` : days.format(day);
   if (hour) return minute ? `${hours.format(hour)} ${minutes.format(minute)}` : hours.format(hour);
   return minutes.format(minute);
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
