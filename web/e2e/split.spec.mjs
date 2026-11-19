import { expect, test } from '@playwright/test';
import { composer, listed, login, pane, sendIn, startChat } from './helpers.mjs';

// Chats side by side on a wide screen: 1920 pixels hold three panes beside the list.

test.beforeEach(async ({ page }) => login(page));

const panes = (page) => page.locator('.pane');
const rowOf = (page, title) => page.locator('.session-list-row').filter({ has: page.getByTitle(title, { exact: true }) });

test('two chats work at once, each in its own pane', async ({ page }) => {
   await startChat(page, 'левый');
   await startChat(page, 'правый');
   await listed(page, 'левый').click({ modifiers: ['ControlOrMeta'] });
   await expect(panes(page)).toHaveCount(2);
   const left = pane(page, 'правый');
   const right = pane(page, 'левый');

   await sendIn(right, 'slow один');
   await sendIn(left, 'slow два');
   await expect(right.getByText('готово: slow один')).toBeVisible();
   await expect(left.getByText('готово: slow два')).toBeVisible();
   await expect(right.getByText('slow два')).toHaveCount(0);
   await expect(left.getByText('slow один')).toHaveCount(0);

   await sendIn(right, 'ask справа');
   await sendIn(left, 'ask слева');
   await left.getByRole('button', { name: 'Разрешить' }).click();
   await expect(left.getByText('Выбрано: allow')).toBeVisible();
   await expect(right.getByRole('button', { name: 'Разрешить' })).toBeVisible();
   await right.getByRole('button', { name: 'Запретить' }).click();
   await expect(right.getByText('Выбрано: deny')).toBeVisible();
});

test('panes open beside while there is room and follow the width', async ({ page }) => {
   for (const title of ['раз', 'два', 'три', 'четыре']) await startChat(page, title);
   for (const title of ['раз', 'два']) {
      await rowOf(page, title).hover();
      await rowOf(page, title).getByRole('button', { name: 'Открыть рядом' }).click();
   }
   await expect(panes(page)).toHaveCount(3);
   await rowOf(page, 'три').hover();
   await expect(rowOf(page, 'три').getByRole('button', { name: 'Открыть рядом' })).toHaveCount(0);
   // Every pane shows its own chat.
   for (const title of ['четыре', 'раз', 'два']) await expect(pane(page, title).getByText(`Ответ: ${title}`)).toBeVisible();

   await page.setViewportSize({ width: 1280, height: 900 });
   await expect(panes(page)).toHaveCount(2);
   await expect(pane(page, 'два')).toBeVisible();
   await page.setViewportSize({ width: 1920, height: 1080 });
   await expect(panes(page)).toHaveCount(3);
   await expect(pane(page, 'раз').getByText('Ответ: раз')).toBeVisible();
});

test('a chat dragged from the list goes beside a pane or in its place', async ({ page }) => {
   for (const title of ['альфа', 'бета', 'гамма']) await startChat(page, title);
   const target = pane(page, 'гамма');
   const box = await target.boundingBox();
   await listed(page, 'альфа').dragTo(target, { targetPosition: { x: box.width - 20, y: box.height / 2 } });
   await expect(panes(page)).toHaveCount(2);
   await expect(panes(page).nth(1).getByRole('heading', { name: 'альфа', exact: true })).toBeAttached();

   const half = await pane(page, 'гамма').boundingBox();
   await listed(page, 'бета').dragTo(pane(page, 'гамма'), { targetPosition: { x: half.width / 2, y: half.height / 2 } });
   await expect(panes(page)).toHaveCount(2);
   await expect(pane(page, 'бета').getByText('Ответ: бета')).toBeVisible();
   await expect(pane(page, 'гамма')).toHaveCount(0);
   // The chat is not typed into the composer it was dropped over.
   await expect(composer(pane(page, 'бета'))).toHaveValue('');
});

test('the pane in use takes the list, the address and a new chat; panes close', async ({ page }) => {
   for (const title of ['север', 'юг', 'запад']) await startChat(page, title);
   await listed(page, 'север').click({ modifiers: ['ControlOrMeta'] });
   await pane(page, 'запад').getByText('Ответ: запад').click();
   await expect(page).toHaveURL(new RegExp(`#/s/`));
   const westUrl = page.url();
   await listed(page, 'юг').click();
   await expect(pane(page, 'юг')).toBeVisible();
   await expect(pane(page, 'запад')).toHaveCount(0);
   await expect(pane(page, 'север')).toBeVisible();
   expect(page.url()).not.toBe(westUrl);

   await pane(page, 'юг').getByRole('link', { name: 'Новый чат' }).click();
   await expect(page.locator('.pane .new-chat')).toHaveCount(1);
   await expect(panes(page)).toHaveCount(2);
   await startChat(page, 'восток');
   await expect(pane(page, 'восток').getByText('Ответ: восток')).toBeVisible();
   await expect(pane(page, 'север')).toBeVisible();

   await pane(page, 'восток').getByRole('button', { name: 'Закрыть панель' }).click();
   await expect(panes(page)).toHaveCount(1);
   await expect(pane(page, 'север')).toBeVisible();
   await expect(page.getByRole('button', { name: 'Закрыть панель' })).toHaveCount(0);
});

test('the panes and their widths come back after a reload', async ({ page }) => {
   for (const title of ['до', 'после']) await startChat(page, title);
   await listed(page, 'до').click({ modifiers: ['ControlOrMeta'] });
   const border = page.getByRole('separator', { name: 'Граница между чатами' });
   await expect(border).toHaveAttribute('aria-valuenow', '50');
   await border.focus();
   await page.keyboard.press('ArrowRight');
   await page.keyboard.press('ArrowRight');
   await expect(border).toHaveAttribute('aria-valuenow', '60');

   await page.reload();
   await expect(panes(page)).toHaveCount(2);
   await expect(pane(page, 'до').getByText('Ответ: до')).toBeVisible();
   await expect(pane(page, 'после').getByText('Ответ: после')).toBeVisible();
   await expect(page.getByRole('separator', { name: 'Граница между чатами' })).toHaveAttribute('aria-valuenow', '60');
});
