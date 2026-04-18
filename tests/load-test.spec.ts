import { test, expect } from '@playwright/test';

const iterations = 10;
for (let i = 0; i < iterations; i++) {
  test(`test${i}`, async ({ page }) => {
    await page.goto('https://x.x.x.x');
    await page.locator('input[type="email"]').click();
    await page.locator('input[type="email"]').fill('abc@example.com');
    await page.locator('input[type="email"]').press('Tab');
    await page.locator('input[id="password"]').fill('password');
    await page.locator('button', { hasText: "Sign in"}).click();
    await page.waitForTimeout(1000);
    // await page.locator('#chat-input').press('Escape');
    // await page.locator('#chat-input').press('Escape');
    await page.locator('#chat-input').fill('CDKでWAF,ALB、RDS、ECSの構成でバックアップを取りつつ堅牢なインフラコードを生成してください。また、スタッククラスだけでなく関連するクラスやファイルもすべて列挙してください。省略などはせずにコードのすべてを生成してください。');  
    await page.locator('#send-message-button').click();
  });
}