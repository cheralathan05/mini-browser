import http from 'http';

function request(url, options = {}) {
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

function streamRequest(url, options = {}, onChunk) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'POST',
      headers: options.headers || {},
    }, (res) => {
      let fullBody = '';
      res.on('data', chunk => {
        const text = chunk.toString();
        fullBody += text;
        if (onChunk) onChunk(text);
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, raw: fullBody });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function run() {
  console.log('====================================================');
  console.log('   NEXUS INTELLIGENCE CORE — VERIFICATION SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`[TEST] ${name.padEnd(58, '.')} `);
    try {
      await fn();
      console.log('✔ PASS');
      passed++;
    } catch (e) {
      console.log(`✖ FAIL: ${e.message}`);
      failed++;
    }
  }

  let authToken = '';
  let userId = '';
  let conversationId = '';

  // 1. Auth: Login Demo User
  await test('Auth: Login Demo User (POST /api/auth/login)', async () => {
    const res = await request('http://127.0.0.1:8001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'demo@nexus.local', password: 'nexus123' },
    });
    if (res.status !== 200 || !res.data?.token) {
      throw new Error(`Login failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }
    authToken = res.data.token;
    userId = res.data.user.id;
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  });

  // 2. AI: List conversations
  await test('AI: List Conversations (GET /api/ai/conversations)', async () => {
    const res = await request('http://127.0.0.1:8001/api/ai/conversations', {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.conversations)) {
      throw new Error(`List failed with status ${res.status}`);
    }
  });

  // 3. AI: Create conversation with page context
  await test('AI: Create Contextual Discussion (POST /api/ai/conversations)', async () => {
    const res = await request('http://127.0.0.1:8001/api/ai/conversations', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        title: 'Exploring NEXUS Browser Architecture',
        contextType: 'page',
        url: 'https://github.com/nexus/architecture',
        pageTitle: 'NEXUS — The AI Browser OS Repository',
        selectedText: 'Prisma ORM with PostgreSQL intelligence core',
      },
    });
    if (res.status !== 201 || !res.data?.conversation?.id) {
      throw new Error(`Create failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }
    conversationId = res.data.conversation.id;
  });

  // 4. AI: Get conversation details & context snapshots
  await test('AI: Fetch Conversation with Context (GET /api/ai/conversations/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${conversationId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status !== 200 || res.data?.conversation?.id !== conversationId) {
      throw new Error(`Fetch failed with status ${res.status}`);
    }
    if (!Array.isArray(res.data?.conversation?.snapshots) || res.data.conversation.snapshots.length === 0) {
      throw new Error('Expected context snapshot stored in conversation');
    }
  });

  // 5. AI: SSE Token Streaming Execution
  await test('AI: Real-Time SSE Token Streaming (POST /api/ai/conversations/:id/messages)', async () => {
    let receivedTokens = 0;
    let receivedStart = false;
    let receivedComplete = false;
    let streamedContent = '';

    const res = await streamRequest(`http://127.0.0.1:8001/api/ai/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Accept': 'text/event-stream',
      },
      body: {
        message: 'Explain how NEXUS connects browser context with memory and AI.',
        context: {
          type: 'page',
          url: 'https://github.com/nexus/architecture',
          title: 'NEXUS — The AI Browser OS Repository',
          selectedText: 'Prisma ORM with PostgreSQL intelligence core',
          content: 'NEXUS combines browser navigation with an integrated AI orchestrator, unified memory retriever, and autonomous agents.',
        },
      },
    }, (chunk) => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const token = data.token || data.text;
            if (token) {
              receivedTokens++;
              streamedContent += token;
            }
          } catch {}
        }
        if (line.includes('event: message:start') || line.includes('"event":"message:start"')) {
          receivedStart = true;
        }
        if (line.includes('event: message:complete') || line.includes('"event":"message:complete"')) {
          receivedComplete = true;
        }
      }
    });

    if (res.status !== 200) {
      throw new Error(`Stream returned status ${res.status}`);
    }
    if (!receivedComplete) {
      throw new Error('Did not receive message:complete SSE event');
    }
    if (streamedContent.length === 0) {
      throw new Error('Streamed response content was empty');
    }
  });

  // 6. Memory: Search memory
  await test('Memory: Query Semantic Search API (GET /api/memory/search)', async () => {
    const res = await request('http://127.0.0.1:8001/api/memory/search?q=NEXUS', {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !Array.isArray(res.data?.memories)) {
      throw new Error(`Memory search failed: status ${res.status}`);
    }
  });

  // 7. Memory: Save new memory
  await test('Memory: Create Memory Item (POST /api/memory)', async () => {
    const res = await request('http://127.0.0.1:8001/api/memory', {
      method: 'POST',
      headers: authHeaders(),
      body: {
        content: 'NEXUS Intelligence Core connects Browser context to PostgreSQL and Ollama.',
        category: 'architecture',
        sourceUrl: 'https://github.com/nexus/architecture',
        tags: ['nexus', 'intelligence', 'postgresql'],
      },
    });
    if (res.status !== 201 || !res.data?.memory?.id) {
      throw new Error(`Create memory failed: status ${res.status}`);
    }
  });

  // 8. AI: Cancel Active Generation
  await test('AI: Cancel Active Stream (POST /api/ai/conversations/:id/cancel)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${conversationId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.success) {
      throw new Error(`Cancel endpoint failed: status ${res.status}`);
    }
  });

  // 9. AI: Delete Conversation
  await test('AI: Delete Discussion (DELETE /api/ai/conversations/:id)', async () => {
    const res = await request(`http://127.0.0.1:8001/api/ai/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.status !== 200 || !res.data?.success) {
      throw new Error(`Delete failed with status ${res.status}`);
    }
  });

  console.log('\n====================================================');
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run error:', err);
  process.exit(1);
});
