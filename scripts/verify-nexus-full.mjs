import http from 'http';

async function request(url, options = {}) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function run() {
  console.log('====================================================');
  console.log('       NEXUS BROWSER OPERATING SYSTEM AUDIT         ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    process.stdout.write(`[TEST] ${name.padEnd(55, '.')} `);
    try {
      await fn();
      console.log('✔ PASS');
      passed++;
    } catch (e) {
      console.log(`✖ FAIL: ${e.message}`);
      failed++;
    }
  }

  // 1. Frontend Vite Server
  await check('Frontend Vite Dev Server (http://127.0.0.1:5188/)', async () => {
    const res = await request('http://127.0.0.1:5188/');
    if (res.status !== 200 || !res.raw.includes('id="root"')) {
      throw new Error(`Expected HTTP 200 with #root, got status ${res.status}`);
    }
  });

  // 2. Main Entry script load
  await check('Frontend Entry Point (/main.tsx -> NexusApp)', async () => {
    const res = await request('http://127.0.0.1:5188/main.tsx');
    if (res.status !== 200 || !res.raw.includes('NexusApp')) {
      throw new Error(`Expected main.tsx mounting NexusApp, got status ${res.status}`);
    }
  });

  // 3. Backend System Health
  await check('Backend Health API (GET /api/health)', async () => {
    const res = await request('http://127.0.0.1:8001/api/health');
    if (res.status !== 200 || res.data?.status !== 'healthy') {
      throw new Error(`Health status: ${res.data?.status}`);
    }
  });

  // 4. PostgreSQL Health Probe
  await check('PostgreSQL Database Health (GET /api/health/database)', async () => {
    const res = await request('http://127.0.0.1:8001/api/health/database');
    if (res.status !== 200 || (res.data?.status !== 'healthy' && res.data?.status !== 'connected')) {
      throw new Error(`Database probe failed: ${JSON.stringify(res.data)}`);
    }
  });

  // 5. Ollama Local AI Connection
  await check('Ollama AI Connection (GET /api/health/ollama)', async () => {
    const res = await request('http://127.0.0.1:8001/api/health/ollama');
    if (res.status !== 200 || res.data?.status !== 'connected') {
      throw new Error(`Ollama probe: ${JSON.stringify(res.data)}`);
    }
  });

  // 6. Omnibox Intent: Navigate
  await check('Omnibox Intent: Navigate URL', async () => {
    const res = await request('http://127.0.0.1:8001/api/nexus/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query: 'https://github.com/trending' }
    });
    if (res.status !== 200 || res.data?.intent !== 'navigate') {
      throw new Error(`Expected navigate intent, got ${res.data?.intent}`);
    }
  });

  // 7. Omnibox Intent: Deep Research
  await check('Omnibox Intent: Research Query', async () => {
    const res = await request('http://127.0.0.1:8001/api/nexus/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query: 'Research the best AI browser frameworks' }
    });
    if (res.status !== 200 || res.data?.intent !== 'start_research') {
      throw new Error(`Expected start_research intent, got ${res.data?.intent}`);
    }
  });

  // 8. Omnibox Intent: Workflow Creation
  await check('Omnibox Intent: Create Workflow', async () => {
    const res = await request('http://127.0.0.1:8001/api/nexus/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query: 'Create a workflow for lead research' }
    });
    if (res.status !== 200 || res.data?.intent !== 'create_workflow') {
      throw new Error(`Expected create_workflow intent, got ${res.data?.intent}`);
    }
  });

  // 9. Omnibox Intent: Memory Query
  await check('Omnibox Intent: Query Memory', async () => {
    const res = await request('http://127.0.0.1:8001/api/nexus/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { query: 'Ask my memory what project I was working on' }
    });
    if (res.status !== 200 || res.data?.intent !== 'query_memory') {
      throw new Error(`Expected query_memory intent, got ${res.data?.intent}`);
    }
  });

  // 10. Browser AI Context: Save Memory
  await check('Browser Intelligence: Save Memory to DB', async () => {
    const res = await request('http://127.0.0.1:8001/api/browser/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        url: 'https://docs.nexus.browser',
        title: 'NEXUS OS Specs',
        action: 'save_memory',
        prompt: 'NEXUS combines Browser, AI Agents, Workflows, and Memory into one unified OS.'
      }
    });
    if (res.status !== 200 || !res.data?.success || !res.data?.memory?.id) {
      throw new Error(`Save memory failed: ${JSON.stringify(res.data)}`);
    }
  });

  // 11. Browser AI Context: Create Task
  await check('Browser Intelligence: Create Agent Task in DB', async () => {
    const res = await request('http://127.0.0.1:8001/api/browser/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        url: 'https://news.ycombinator.com',
        title: 'Hacker News Frontpage',
        action: 'create_task',
        prompt: 'Analyze trending AI developer tools'
      }
    });
    if (res.status !== 200 || !res.data?.success || !res.data?.task?.id) {
      throw new Error(`Create task failed: ${JSON.stringify(res.data)}`);
    }
  });

  // 12. Browser AI Context: Create Workflow
  await check('Browser Intelligence: Generate Page Workflow in DB', async () => {
    const res = await request('http://127.0.0.1:8001/api/browser/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        url: 'https://arxiv.org',
        title: 'ArXiv Multimodal AI',
        action: 'create_workflow'
      }
    });
    if (res.status !== 200 || !res.data?.success || !res.data?.workflow?.id) {
      throw new Error(`Create workflow failed: ${JSON.stringify(res.data)}`);
    }
  });

  // --- NEXUS INTELLIGENCE CORE (ASK SYSTEM) TESTS ---
  let demoToken = '';
  let testConvId = '';

  await check('AI Core: Login Demo User (POST /api/auth/login)', async () => {
    const res = await request('http://127.0.0.1:8001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'demo@nexus.local', password: 'nexus123' }
    });
    if (res.status !== 200 || !res.data?.token) {
      throw new Error(`Login failed with status ${res.status}`);
    }
    demoToken = res.data.token;
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${demoToken}`,
  });

  // 13. Create Discussion in PostgreSQL
  await check('AI Core: Create Contextual Discussion (POST /api/ai/conversations)', async () => {
    const res = await request('http://127.0.0.1:8001/api/ai/conversations', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        title: 'Exploring NEXUS Browser Architecture',
        contextType: 'page',
        url: 'https://github.com/nexus/architecture',
        pageTitle: 'NEXUS — The AI Browser OS Repository',
        selectedText: 'Prisma ORM with PostgreSQL intelligence core',
      }
    });
    if (res.status !== 201 || !res.data?.conversation?.id) {
      throw new Error(`Create conversation failed with status ${res.status}`);
    }
    testConvId = res.data.conversation.id;
  });

  // 14. Fetch Conversation with Context Snapshot
  await check('AI Core: Fetch Conversation with Snapshot (GET /api/ai/conversations/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${testConvId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status !== 200 || res.data?.conversation?.id !== testConvId) {
      throw new Error(`Fetch failed: ${res.status}`);
    }
    if (!Array.isArray(res.data?.conversation?.snapshots) || res.data.conversation.snapshots.length === 0) {
      throw new Error('Context snapshot missing in response');
    }
  });

  // 15. Real-Time SSE Token Streaming
  await check('AI Core: Real-Time SSE Streaming (POST /api/ai/conversations/:id/messages)', async () => {
    const parsed = new URL(`http://127.0.0.1:8001/api/ai/conversations/${testConvId}/messages`);
    let receivedTokens = 0;
    let receivedComplete = false;

    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Accept': 'text/event-stream',
        }
      }, (res) => {
        res.on('data', chunk => {
          const text = chunk.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const tok = data.token || data.text;
                if (tok) receivedTokens++;
              } catch {}
            }
            if (line.includes('message:complete')) receivedComplete = true;
          }
        });
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        message: 'Explain how NEXUS connects browser context with memory and AI.',
        context: {
          type: 'page',
          url: 'https://github.com/nexus/architecture',
          title: 'NEXUS — The AI Browser OS Repository',
        }
      }));
      req.end();
    });

    if (!receivedComplete) {
      throw new Error('SSE did not receive message:complete event');
    }
  });

  // 16. Semantic Memory Search
  await check('AI Core: Semantic Memory Search (GET /api/memory/search)', async () => {
    const res = await request('http://127.0.0.1:8001/api/memory/search?q=NEXUS', {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.memories)) {
      throw new Error(`Memory search failed: status ${res.status}`);
    }
  });

  // 17. Save to PostgreSQL Memory
  await check('AI Core: Persist Memory Item (POST /api/memory)', async () => {
    const res = await request('http://127.0.0.1:8001/api/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        content: 'NEXUS connects Browser tabs with PostgreSQL memory and Ollama AI.',
        category: 'architecture',
        sourceUrl: 'https://github.com/nexus/architecture',
        tags: ['nexus', 'intelligence'],
      }
    });
    if (res.status !== 201 || !res.data?.memory?.id) {
      throw new Error(`Save memory failed: status ${res.status}`);
    }
  });

  // 18. Cancel Active Stream Endpoint
  await check('AI Core: Stream Cancellation (POST /api/ai/conversations/:id/cancel)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${testConvId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.success) {
      throw new Error(`Cancel endpoint returned status ${res.status}`);
    }
  });

  // 19. Delete Conversation
  await check('AI Core: Clean up Conversation (DELETE /api/ai/conversations/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${testConvId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.success) {
      throw new Error(`Delete failed: status ${res.status}`);
    }
  });

  console.log('\n====================================================');
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Audit crashed:', err);
  process.exit(1);
});

