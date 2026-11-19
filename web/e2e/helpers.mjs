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
   // Enter starts a new line on a touch keyboard; the button sends everywhere.
   await page.locator('.new-chat').getByRole('button', { name: 'Отправить' }).click();
   await expect(page).toHaveURL(/#\/s\//);
   return decodeURIComponent(new URL(page.url()).hash.slice('#/s/'.length));
}

// The link of the chat titled `title` in the list.
export function listed(page, title) {
   return page.locator('.session-list a.session-item').filter({ has: page.getByTitle(title, { exact: true }) });
}

// The pane showing the chat titled `title`.
export function pane(page, title) {
   return page.locator('.pane').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

// Sends a message from a pane's composer.
export async function sendIn(scope, text) {
   await composer(scope).fill(text);
   await composer(scope).press('Enter');
}
