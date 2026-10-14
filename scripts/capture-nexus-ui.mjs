import { chromium } from 'playwright';

async function capture() {
  console.log('Launching Chromium to inspect NEXUS Browser and all views...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to Browser home...');
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'nexus_browser_home.png' });

  console.log('2. Clicking ✦ Ask to open Right Intelligence Dock...');
  const askBtn = await page.$('button:has-text("Intelligence")') || await page.$('button:has-text("Ask")');
  if (askBtn) {
    await askBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'nexus_intelligence_dock.png' });
  }

  console.log('3. Closing AI panel and opening Command Palette (Ctrl+K)...');
  if (askBtn) {
    await askBtn.click();
    await page.waitForTimeout(500);
  }

  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'nexus_command_palette.png' });

  // Press Escape to close Command Palette
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log('4. Inspecting Research View...');
  const researchTab = await page.$('text=Research');
  if (researchTab) {
    await researchTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'nexus_research_view.png' });
  }

  console.log('5. Inspecting Workflows View...');
  const workflowsTab = await page.$('text=Workflows');
  if (workflowsTab) {
    await workflowsTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'nexus_workflows_view.png' });
  }

  console.log('6. Inspecting Memory View...');
  const memoryTab = await page.$('text=Memory');
  if (memoryTab) {
    await memoryTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'nexus_memory_view.png' });
  }

  console.log('7. Inspecting Approvals View...');
  const approvalsTab = await page.$('text=Approvals');
  if (approvalsTab) {
    await approvalsTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'nexus_approvals_view.png' });
  }

  // Switch back to Browser
  const browserTab = await page.$('text=Browser');
  if (browserTab) {
    await browserTab.click();
    await page.waitForTimeout(1000);
  }

  await browser.close();
  console.log('All views successfully captured!');
}

capture().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
