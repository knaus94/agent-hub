import { expect, test } from '@playwright/test';
import { login, startChat } from './helpers.mjs';

// A tablet held sideways: the list beside the chats, touch instead of a mouse.

test('a row keeps its room on a touch screen and its menu opens a chat beside', async ({ page }) => {
   await login(page);
   await startChat(page, 'планшет первый');
   await startChat(page, 'ask планшет второй');
   const row = page.locator('.session-list-row').filter({ has: page.getByTitle('ask планшет второй', { exact: true }) });
   await expect(row.getByText('Ждёт вашего ответа')).toBeVisible();
   // Nothing of the row runs past its card.
   const overflow = await row.locator('.session-item').evaluate((item) => {
      const edge = item.getBoundingClientRect().right;
      return [...item.querySelectorAll('*')].filter(
         (child) => child.getBoundingClientRect().right > edge + 1 && getComputedStyle(child).overflow === 'visible',
      ).length;
   });
   expect(overflow).toBe(0);
   await expect(row.getByRole('button', { name: 'В архив' })).toBeHidden();

   // The name keeps to one line, with room left in the header for the notifications button the hub may add.
   const room = await page.locator('.session-list-header').evaluate((header) => {
      const style = getComputedStyle(header);
      const gap = parseFloat(style.columnGap);
      const brand = header.querySelector('.session-list-brand');
      const name = brand.querySelector('.session-list-name');
      const others = [...header.children].filter((child) => child !== brand);
      const used =
         brand.querySelector('.app-mark').getBoundingClientRect().width +
         parseFloat(getComputedStyle(brand).columnGap) +
         name.scrollWidth +
         others.reduce((sum, child) => sum + child.getBoundingClientRect().width + gap, 0);
      return header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - used;
   });
   expect(room).toBeGreaterThanOrEqual(40);

   const other = page.locator('.session-list-row').filter({ has: page.getByTitle('планшет первый', { exact: true }) });
   await other.getByRole('button', { name: 'Действия с чатом' }).click();
   await page.getByRole('button', { name: 'Открыть рядом' }).click();
   await expect(page.locator('.pane')).toHaveCount(2);
});
