import { expect, test } from '@playwright/test';
import { composer, listed, login, startChat } from './helpers.mjs';

// A red pixel.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// One chat on screen, as before chats could be shown side by side.

test.beforeEach(async ({ page }) => login(page));

test('a chat started here streams its reply and shows in the list', async ({ page }) => {
   await startChat(page, 'привет один');
   await expect(page.getByRole('main').getByText('Ответ: привет один')).toBeVisible();
   await expect(listed(page, 'привет один')).toHaveAttribute('aria-current', 'page');
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
   await listed(page, 'первый чат').click();
   await expect(page.getByRole('main').getByText('Ответ: первый чат')).toBeVisible();
   await expect(page.getByRole('main').getByText('Ответ: второй чат')).toBeHidden();
   await composer(page).fill('ещё раз');
   await composer(page).press('Enter');
   await expect(page.getByRole('main').getByText('Ответ: ещё раз')).toBeVisible();
});

test('pictures in a chat show as thumbnails and open at full size', async ({ page }) => {
   await startChat(page, 'picture please');
   const main = page.getByRole('main');
   await expect(main.getByText('Картинка прочитана')).toBeVisible();
   await main.getByText('Read shot.png').click();
   const thumbnails = main.getByRole('button', { name: 'Открыть картинку 1' });
   await expect(thumbnails).toHaveCount(2);
   for (const thumbnail of await thumbnails.all())
      await expect.poll(() => thumbnail.locator('img').evaluate((image) => image.complete && image.naturalWidth)).toBe(640);
   await thumbnails.last().click();
   const viewer = page.getByRole('dialog', { name: 'Картинка' });
   await expect(viewer.locator('img')).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(viewer).toHaveCount(0);
   await thumbnails.first().click();
   await viewer.getByRole('button', { name: 'Закрыть' }).click();
   await expect(viewer).toHaveCount(0);
});

test('a message carries a picture and a file from the device and a file of the project', async ({ page }) => {
   await startChat(page, 'привет вложения');
   const main = page.getByRole('main');
   await expect(main.getByText('Ответ: привет вложения')).toBeVisible();
   await main.locator('input[type=file]').setInputFiles([
      { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL, 'base64') },
      { name: 'заметки.txt', mimeType: 'text/plain', buffer: Buffer.from('заметка') },
   ]);
   await composer(main).fill('смотри @brie');
   await main.getByRole('option', { name: /brief\.md/ }).click();
   const attached = main.getByRole('list', { name: 'Вложения' });
   await expect(attached.getByRole('img', { name: 'shot.png' })).toBeVisible();
   await expect(attached.getByText('заметки.txt')).toBeVisible();
   await expect(attached.getByText('brief.md')).toBeVisible();
   await main.getByRole('button', { name: 'Отправить' }).click();
   await expect(main.getByText('Получено: картинка image/png, файл attachment:///заметки.txt: заметка, ссылка brief.md.')).toBeVisible();
   await expect(main.getByText('Ответ: смотри')).toBeVisible();
   await expect(main.getByRole('button', { name: 'Открыть картинку 1' })).toBeVisible();
   await expect(composer(main)).toHaveValue('');
   await expect(main.getByRole('img', { name: 'shot.png' })).toHaveCount(0);
});
