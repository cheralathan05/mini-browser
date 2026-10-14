import http from 'http';

async function main() {
  console.log('Testing Ask endpoint streaming speed...');

  // 1. Login
  const loginData = JSON.stringify({ email: 'demo@nexus.local', password: 'nexus123' });
  const loginRes = await fetch('http://127.0.0.1:8001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginData,
  });
  const { token } = await loginRes.json();

  // 2. Create conversation
  const convRes = await fetch('http://127.0.0.1:8001/api/ai/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'Performance Test' }),
  });
  const { conversation } = await convRes.json();

  // 3. Send message & measure latency
  const startTime = Date.now();
  let firstTokenTime = 0;
  let tokenCount = 0;

  const msgRes = await fetch(
    `http://127.0.0.1:8001/api/ai/conversations/${conversation.id}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: 'Explain what an AI browser is in 2 sentences.' }),
    }
  );

  const reader = msgRes.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    if (!firstTokenTime && chunk.includes('message:token')) {
      firstTokenTime = Date.now() - startTime;
    }
    if (chunk.includes('message:token')) {
      tokenCount++;
    }
    fullResponse += chunk;
  }

  const totalTime = Date.now() - startTime;
  console.log(`✔ Time to first token: ${firstTokenTime}ms`);
  console.log(`✔ Total generation time: ${totalTime}ms`);
  console.log(`✔ Total streamed events: ${tokenCount}`);
}

main().catch(console.error);
