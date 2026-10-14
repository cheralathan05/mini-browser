import http from 'http';

async function request(url, options = {}) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log('====================================================');
  console.log('     NEXUS RESEARCH — END-TO-END SUITE VERIFICATION ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    process.stdout.write(`[TEST] ${name.padEnd(60, '.')} `);
    try {
      await fn();
      console.log('✔ PASS');
      passed++;
    } catch (e) {
      console.log(`✖ FAIL: ${e.message}`);
      failed++;
    }
  }

  let demoToken = '';
  let projectId = '';
  let runId = '';

  // 1. Auth Login
  await check('Auth: Login demo user', async () => {
    const res = await request('http://127.0.0.1:8001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'demo@nexus.local', password: 'nexus123' },
    });
    if (res.status !== 200 || !res.data?.token) {
      throw new Error(`Login failed with status ${res.status}`);
    }
    demoToken = res.data.token;
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${demoToken}`,
  });

  // 2. List Research Projects
  await check('Research: List existing projects (GET /api/research)', async () => {
    const res = await request('http://127.0.0.1:8001/api/research', {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.projects)) {
      throw new Error(`Expected projects array, got: ${res.status}`);
    }
  });

  // 3. Create Research Project
  await check('Research: Create Investigation Project (POST /api/research)', async () => {
    const res = await request('http://127.0.0.1:8001/api/research', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        name: 'Automated Browser Agents Research',
        question: 'Compare modern AI browser frameworks and autonomous web agents',
        mode: 'quick',
      },
    });
    if (res.status !== 201 || !res.data?.project?.id) {
      throw new Error(`Failed creating project: ${JSON.stringify(res.data)}`);
    }
    projectId = res.data.project.id;
    if (res.data.project.mode !== 'quick') {
      throw new Error(`Expected mode quick, got ${res.data.project.mode}`);
    }
  });

  // 4. Verify Initial Plan Objectives
  await check('Research: Verify Initial Plan Objectives (GET /api/research/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}`, {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.project?.plan) {
      throw new Error(`Missing plan in project: ${res.status}`);
    }
    const objectives = res.data.project.plan.objectives;
    if (!Array.isArray(objectives) || objectives.length === 0) {
      throw new Error('Expected plan to contain pre-populated objectives');
    }
  });

  // 5. Update Plan Objectives
  await check('Research: Update Plan Objectives (PATCH /api/research/:id/plan)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/plan`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: {
        objectives: [
          { id: 'custom-1', title: 'Synthesize autonomous browser agent architectures', status: 'pending', order: 0 },
          { id: 'custom-2', title: 'Extract verifiable benchmark claims and latency', status: 'pending', order: 1 },
          { id: 'custom-3', title: 'Compare multi-tab session management', status: 'pending', order: 2 },
          { id: 'custom-4', title: 'Generate executive findings and report', status: 'pending', order: 3 },
        ],
      },
    });
    if (res.status !== 200 || !res.data?.plan) {
      throw new Error(`Failed updating plan: ${JSON.stringify(res.data)}`);
    }
    if (res.data.plan.objectives.length !== 4) {
      throw new Error(`Expected 4 objectives, got ${res.data.plan.objectives.length}`);
    }
  });

  // 6. Start Investigation (Async)
  await check('Research: Start Autonomous Run (POST /api/research/:id/start)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/start`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.status !== 202 || !res.data?.runId) {
      throw new Error(`Expected 202 Accepted with runId, got status ${res.status}: ${JSON.stringify(res.data)}`);
    }
    runId = res.data.runId;
  });

  // 7. Test Pause & Resume Controls
  await check('Research: Control Signals (Pause & Resume)', async () => {
    // Give worker 500ms to start
    await sleep(500);

    // Pause
    const pauseRes = await request(`http://127.0.0.1:8001/api/research/${projectId}/pause`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (pauseRes.status !== 200) {
      throw new Error(`Pause failed: ${pauseRes.status}`);
    }

    // Check project status is paused
    const statusRes = await request(`http://127.0.0.1:8001/api/research/${projectId}`, {
      headers: authHeaders(),
    });
    if (statusRes.data?.project?.status !== 'paused') {
      throw new Error(`Expected project status paused, got ${statusRes.data?.project?.status}`);
    }

    // Resume
    const resumeRes = await request(`http://127.0.0.1:8001/api/research/${projectId}/resume`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (resumeRes.status !== 200) {
      throw new Error(`Resume failed: ${resumeRes.status}`);
    }
  });

  // 8. Poll Autonomous Research Run to Completion
  await check('Research: Autonomous Execution Pipeline Poll', async () => {
    let completed = false;
    let attempts = 0;
    const maxAttempts = 60; // Up to 60 seconds

    while (!completed && attempts < maxAttempts) {
      await sleep(1500);
      attempts++;
      const res = await request(`http://127.0.0.1:8001/api/research/${projectId}`, {
        headers: authHeaders(),
      });
      if (res.status === 200 && res.data?.project) {
        const proj = res.data.project;
        const currentRun = proj.runs?.[0];
        const runStatus = currentRun?.status || proj.status;
        const progress = currentRun?.progress || 0;

        if (runStatus === 'completed') {
          completed = true;
          break;
        }
        if (runStatus === 'failed') {
          throw new Error(`Research run failed: ${currentRun?.error || 'Unknown error'}`);
        }
      }
    }

    if (!completed) {
      throw new Error(`Research did not complete within timeout (${attempts * 1.5}s)`);
    }
  });

  // 9. Verify Real Sources in PostgreSQL
  await check('Research: Verify Real Sources (GET /api/research/:id/sources)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/sources`, {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.sources)) {
      throw new Error(`Failed fetching sources: ${res.status}`);
    }
    if (res.data.sources.length === 0) {
      throw new Error('Zero sources were retrieved');
    }
    const firstSource = res.data.sources[0];
    if (!firstSource.url || !firstSource.domain || !firstSource.contentHash) {
      throw new Error(`Source metadata incomplete: ${JSON.stringify(firstSource)}`);
    }
  });

  // 10. Verify Discrete Evidence Items
  await check('Research: Verify Traceable Evidence (GET /api/research/:id/evidence)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/evidence`, {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.evidence)) {
      throw new Error(`Failed fetching evidence: ${res.status}`);
    }
    if (res.data.evidence.length === 0) {
      throw new Error('Zero evidence items were extracted');
    }
    const sample = res.data.evidence[0];
    if (!sample.claim || !sample.evidenceText) {
      throw new Error(`Evidence item missing claim/text: ${JSON.stringify(sample)}`);
    }
  });

  // 11. Verify Empirical Findings & Confidence
  await check('Research: Verify Findings (GET /api/research/:id/findings)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/findings`, {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.findings)) {
      throw new Error(`Failed fetching findings: ${res.status}`);
    }
    if (res.data.findings.length === 0) {
      throw new Error('Zero findings created');
    }
    const finding = res.data.findings[0];
    if (!finding.title || !finding.status) {
      throw new Error(`Finding invalid: ${JSON.stringify(finding)}`);
    }
  });

  // 12. Verify Executive Report and Citation Indexes
  await check('Research: Verify Executive Report & Citations (GET /api/research/:id/report)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/report`, {
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.report) {
      throw new Error(`Failed fetching report: ${res.status}`);
    }
    const report = res.data.report;
    if (!report.title || !report.sections || !Array.isArray(report.citations)) {
      throw new Error(`Report incomplete: ${JSON.stringify(report)}`);
    }
    if (report.citations.length === 0) {
      throw new Error('Report contains no mapped citations');
    }
  });

  // 13. Grounded Q&A Copilot
  await check('Research: Grounded AI Copilot Q&A (POST /api/research/:id/ask)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}/ask`, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        question: 'Which source provides the most detailed architectural overview?',
      },
    });
    if (res.status !== 200 || !res.data?.answer) {
      throw new Error(`Grounded Q&A failed: ${JSON.stringify(res.data)}`);
    }
    if (!Array.isArray(res.data.sources) || res.data.sources.length === 0) {
      throw new Error('Grounded response did not attach source references');
    }
  });

  // 14. Save Finding to Persistent Memory
  await check('Research -> Memory: Persist Finding to Long-term Memory', async () => {
    const res = await request('http://127.0.0.1:8001/api/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        content: `[Research Finding] Autonomous browser agents require direct DevTools Protocol integration and persistent memory.`,
        category: 'research',
        sourceUrl: `http://localhost:5188/home.html#research/${projectId}`,
        tags: ['research', 'findings', 'browser-agents'],
      },
    });
    if (res.status !== 201 || !res.data?.memory?.id) {
      throw new Error(`Failed saving research finding to memory: ${JSON.stringify(res.data)}`);
    }
  });

  // 15. Clean up test project
  await check('Research: Clean up Project (DELETE /api/research/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/research/${projectId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.success) {
      throw new Error(`Failed deleting project: ${res.status}`);
    }
  });

  console.log('\n====================================================');
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Research verification crashed:', err);
  process.exit(1);
});
