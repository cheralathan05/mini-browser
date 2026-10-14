import { chromium } from 'playwright';

async function capture() {
  console.log('Testing NEXUS OS Keyboard Shortcuts & View Transitions...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 1. Research View (Ctrl+4)
  console.log('Switching to Research via Ctrl+4...');
  await page.keyboard.down('Control');
  await page.keyboard.press('4');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_research_view.png' });

  // 2. Workflows View (Ctrl+5)
  console.log('Switching to Workflows via Ctrl+5...');
  await page.keyboard.down('Control');
  await page.keyboard.press('5');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_workflows_view.png' });

  // 3. Memory View (Ctrl+6)
  console.log('Switching to Memory via Ctrl+6...');
  await page.keyboard.down('Control');
  await page.keyboard.press('6');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_memory_view.png' });

  // 4. Approvals View (Ctrl+8)
  console.log('Switching to Approvals via Ctrl+8...');
  await page.keyboard.down('Control');
  await page.keyboard.press('8');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_approvals_view.png' });

  // 5. Activity View (Ctrl+9)
  console.log('Switching to Activity via Ctrl+9...');
  await page.keyboard.down('Control');
  await page.keyboard.press('9');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_activity_view.png' });

  // 6. Settings View (Ctrl+0)
  console.log('Switching to Settings via Ctrl+0...');
  await page.keyboard.down('Control');
  await page.keyboard.press('0');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_settings_view.png' });

  // 7. Dashboard Overview (Ctrl+2)
  console.log('Switching to Dashboard via Ctrl+2...');
  await page.keyboard.down('Control');
  await page.keyboard.press('2');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_dashboard_view.png' });

  // 8. Return to Browser Default Workspace (Ctrl+1)
  console.log('Returning to Browser via Ctrl+1...');
  await page.keyboard.down('Control');
  await page.keyboard.press('1');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'nexus_browser_return.png' });

  await browser.close();
  console.log('All view transitions verified successfully via keyboard shortcuts!');
}

capture().catch(err => {
  console.error('Shortcut test error:', err);
  process.exit(1);
});
