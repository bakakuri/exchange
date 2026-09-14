import { chromium } from 'playwright';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const cases = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of cases) {
    const context = await browser.newContext({ viewport: { width: testCase.width, height: testCase.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const cspViolations = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
      const csp = response.headers()['content-security-policy'];
      if (response.url() === `${baseURL}/` && !csp) cspViolations.push('missing CSP header');
    });

    const response = await page.goto(`${baseURL}/`, { waitUntil: 'networkidle' });
    if (!response || response.status() !== 200) throw new Error(`${testCase.name}: root returned ${response?.status()}`);

    const csp = response.headers()['content-security-policy'] || '';
    for (const token of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "script-src 'self'"]) {
      if (!csp.includes(token)) cspViolations.push(`${testCase.name}: CSP missing ${token}`);
    }

    await page.locator('#dashboard').waitFor({ state: 'visible' });
    await page.locator('#menuBtn').count();
    await page.locator('#tasks').count();
    await page.locator('#profiles').count();
    await page.locator('#promotions').count();
    await page.locator('#wallet').count();

    const navButtons = page.locator('[data-view]');
    const count = await navButtons.count();
    if (count < 5) throw new Error(`${testCase.name}: navigation controls missing`);

    if (testCase.name === 'mobile') {
      await page.locator('#menuBtn').click();
      await page.waitForTimeout(100);
      await page.locator('#sidebar').count();
    }

    if (errors.length) throw new Error(`${testCase.name}: browser errors\n${errors.join('\n')}`);
    if (cspViolations.length) throw new Error(`${testCase.name}: CSP failures\n${cspViolations.join('\n')}`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('Browser smoke QA passed: desktop + mobile');
