import { expect } from '@playwright/test';
import { token } from './scratch.mjs';

// Logs in with this computer's token, as the link `agent-hub` prints does, and waits for the hub.
export async function login(page) {
   await page.goto(`/#token=${encodeURIComponent(token())}`);
   await expect(page.getByRole('status').filter({ hasText: 'Подключаюсь' })).toHaveCount(0);
}

// The composer of the pane that holds `scope`, or of the page.
export function composer(scope) {
   return scope.getByRole('combobox', { name: 'Сообщение агенту' });
}

// Starts a chat from the new-chat screen and returns its id once the address names it.
export async function startChat(page, text) {
   if (!/#\/$/.test(page.url())) await page.goto('/#/');
   const input = composer(page.locator('.new-chat'));
   await expect(input).toBeEnabled();
   await input.fill(text);
   await input.press('Enter');
   await expect(page).toHaveURL(/#\/s\//);
   return decodeURIComponent(new URL(page.url()).hash.slice('#/s/'.length));
}

// The chat's row in the list.
export function listed(page, title) {
   return page.locator('.session-list').getByRole('link', { name: title });
}
