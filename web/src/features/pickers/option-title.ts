import type { ConfigOption } from '../../shared/protocol.ts';
import { t } from '../../shared/i18n';

const KNOWN = ['model', 'thought_level', 'mode'] as const;

// The settings every agent has get Russian names; the rest keep the name the agent gave them, as Zed shows it.
export function optionTitle(option: ConfigOption) {
   const known = KNOWN.find((category) => category === option.category);
   return known ? t(`option.${known}`) : option.name;
}
