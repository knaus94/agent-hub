import { expect, test } from '@playwright/test';
import { listed, login, pane, sendIn, startChat } from './helpers.mjs';

// The connection to the hub drops, as when the hub restarts or a laptop sleeps, with two chats on screen.

test('panes keep their chats and go on after a reconnect', async ({ page }) => {
   const sockets = [];
   await page.routeWebSocket(/\/ws$/, (socket) => {
      socket.connectToServer();
      sockets.push(socket);
   });
   await login(page);
   for (const title of ['восход', 'закат']) await startChat(page, title);
   await listed(page, 'восход').click({ modifiers: ['ControlOrMeta'] });
   await expect(pane(page, 'восход').getByText('Ответ: восход')).toBeVisible();

   await sockets.at(-1).close();
   await expect.poll(() => sockets.length).toBe(2);
   await expect(page.getByRole('status').filter({ hasText: 'Нет связи' })).toHaveCount(0);
   await expect(pane(page, 'восход').getByText('Ответ: восход')).toBeVisible();
   await expect(pane(page, 'закат').getByText('Ответ: закат')).toBeVisible();

   await sendIn(pane(page, 'восход'), 'снова утро');
   await sendIn(pane(page, 'закат'), 'снова вечер');
   await expect(pane(page, 'восход').getByText('Ответ: снова утро')).toBeVisible();
   await expect(pane(page, 'закат').getByText('Ответ: снова вечер')).toBeVisible();
   await expect(pane(page, 'восход').getByText('Ответ: снова вечер')).toHaveCount(0);
});
