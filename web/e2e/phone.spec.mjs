import { expect, test } from '@playwright/test';
import { login, startChat } from './helpers.mjs';

// A phone shows one chat, with the list behind the menu and nothing to split with.

test('a phone keeps one chat on screen', async ({ page }) => {
   await login(page);
   await startChat(page, 'телефон');
   await expect(page.getByRole('main').getByText('Ответ: телефон')).toBeVisible();
   await expect(page.locator('.pane')).toHaveCount(1);
   await expect(page.getByRole('button', { name: 'Закрыть панель' })).toHaveCount(0);
   await page.getByRole('button', { name: 'Меню' }).click();
   await expect(page.getByRole('link', { name: /телефон/ })).toBeVisible();
   await expect(page.getByRole('button', { name: 'Открыть рядом' })).toHaveCount(0);
});
