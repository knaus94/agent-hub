import { expect, test } from '@playwright/test';
import { composer, listed, login, startChat } from './helpers.mjs';

// One chat on screen, as before chats could be shown side by side.

test.beforeEach(async ({ page }) => login(page));

test('a chat started here streams its reply and shows in the list', async ({ page }) => {
   await startChat(page, 'привет один');
   await expect(page.getByRole('main').getByText('Ответ: привет один')).toBeVisible();
   await expect(listed(page, /привет один/)).toHaveAttribute('aria-current', 'page');
});

test('a permission is answered in its chat', async ({ page }) => {
   await startChat(page, 'ask разрешение');
   await page.getByRole('button', { name: 'Разрешить' }).click();
   await expect(page.getByRole('main').getByText('Выбрано: allow')).toBeVisible();
});

test('a Markdown file the agent names opens to read', async ({ page }) => {
   await startChat(page, 'doc please');
   await page.getByRole('button', { name: 'docs/brief.md' }).click();
   const dialog = page.getByRole('dialog', { name: 'brief.md' });
   await expect(dialog.getByRole('heading', { name: 'Бриф' })).toBeVisible();
   await dialog.getByRole('button', { name: 'Закрыть' }).click();
   await expect(dialog).toBeHidden();
});

test('the list puts another chat in place of the open one', async ({ page }) => {
   await startChat(page, 'первый чат');
   await expect(page.getByRole('main').getByText('Ответ: первый чат')).toBeVisible();
   await startChat(page, 'второй чат');
   await expect(page.getByRole('main').getByText('Ответ: второй чат')).toBeVisible();
   await listed(page, /первый чат/).click();
   await expect(page.getByRole('main').getByText('Ответ: первый чат')).toBeVisible();
   await expect(page.getByRole('main').getByText('Ответ: второй чат')).toBeHidden();
   await composer(page).fill('ещё раз');
   await composer(page).press('Enter');
   await expect(page.getByRole('main').getByText('Ответ: ещё раз')).toBeVisible();
});
