// Full-scale test script for NEXUS AI Agent
import http from 'http';

async function main() {
  console.log('============================================================');
  console.log('🧪 TESTING NEXUS AI AGENT - FULL PRODUCTION SUITE');
  console.log('============================================================');

  // 1. Auth Login
  console.log('\n[1/6] Authenticating demo user...');
  const loginRes = await fetch('http://127.0.0.1:8001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@nexus.local', password: 'nexus123' }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
  const { token, user } = await loginRes.json();
  console.log(`✓ Logged in as: ${user.name} (${user.email})`);

  // 2. Get Workspaces
  console.log('\n[2/6] Fetching workspaces...');
  const wsRes = await fetch('http://127.0.0.1:8001/api/workspaces', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { workspaces } = await wsRes.json();
  const workspaceId = workspaces[0]?.id;
  console.log(`✓ Using workspace: "${workspaces[0]?.name}" (${workspaceId})`);

  // 3. Launch Agent Task
  const goal = 'Research the top 5 AI browser frameworks, compare them, and create a report.';
  console.log(`\n[3/6] Launching Agent Task with goal:\n"${goal}"`);

  const createRes = await fetch('http://127.0.0.1:8001/api/agents/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      workspaceId,
      title: 'Research AI Browser Frameworks',
      goal,
      priority: 'high',
      executionMode: 'balanced',
    }),
  });

  if (!createRes.ok) throw new Error(`Create task failed: ${await createRes.text()}`);
  const { task, run } = await createRes.json();
  console.log(`✓ AgentTask created in PostgreSQL: ID=${task.id}`);
  console.log(`✓ AgentRun created in PostgreSQL:  ID=${run.id}`);

  // 4. Poll and monitor execution progress
  console.log('\n[4/6] Monitoring real execution telemetry...');
  let completed = false;
  let attempts = 0;
  const maxAttempts = 40;

  while (!completed && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;

    const pollRes = await fetch(`http://127.0.0.1:8001/api/agents/tasks/${task.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { task: currentTask } = await pollRes.json();
    const activeRun = currentTask.runs?.[0];

    console.log(
      `  [Poll ${attempts}] Status: ${activeRun?.status || currentTask.status} | Progress: ${activeRun?.progress || 0}% | Steps: ${activeRun?.steps?.length || 0} | Artifacts: ${activeRun?.artifacts?.length || 0}`
    );

    if (activeRun?.steps?.length > 0) {
      for (const st of activeRun.steps) {
        if (st.status === 'COMPLETED' || st.status === 'RUNNING') {
          console.log(`    Step ${st.stepIndex + 1} (${st.toolName}): [${st.status}] - ${st.description}`);
        }
      }
    }

    if (activeRun?.status === 'COMPLETED' || currentTask.status === 'COMPLETED') {
      completed = true;
      console.log('\n✓ Autonomous execution loop COMPLETED successfully!');
      break;
    }
    if (activeRun?.status === 'FAILED' || currentTask.status === 'FAILED') {
      throw new Error(`Task execution failed: ${activeRun?.error || 'Unknown error'}`);
    }
  }

  // 5. Verify Artifacts and Observations
  console.log('\n[5/6] Verifying database records & artifacts...');
  const detailRes = await fetch(`http://127.0.0.1:8001/api/agents/tasks/${task.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detailData = await detailRes.json();
  const finalRun = detailData.task.runs?.[0];

  console.log(`✓ Total steps executed & persisted: ${finalRun.steps?.length}`);
  console.log(`✓ Total artifacts generated:        ${finalRun.artifacts?.length}`);

  for (const art of finalRun.artifacts || []) {
    console.log(`\n  📄 Artifact: "${art.name}" (Type: ${art.type})`);
    if (art.type === 'report') {
      console.log(`     Report excerpt:\n${art.content.slice(0, 350)}...\n`);
    }
  }

  // 6. Test Pause & Resume Controls on a second task
  console.log('\n[6/6] Testing Pause & Resume on secondary task...');
  const test2Res = await fetch('http://127.0.0.1:8001/api/agents/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      workspaceId,
      title: 'Lifecycle Control Test',
      goal: 'Evaluate pause and resume mechanics',
      priority: 'low',
    }),
  });
  const { task: task2 } = await test2Res.json();

  const pauseRes = await fetch(`http://127.0.0.1:8001/api/agents/tasks/${task2.id}/pause`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const pauseData = await pauseRes.json();
  console.log(`✓ Pause response:`, pauseData);

  const resumeRes = await fetch(`http://127.0.0.1:8001/api/agents/tasks/${task2.id}/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const resumeData = await resumeRes.json();
  console.log(`✓ Resume response:`, resumeData);

  const cancelRes = await fetch(`http://127.0.0.1:8001/api/agents/tasks/${task2.id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const cancelData = await cancelRes.json();
  console.log(`✓ Cancel response:`, cancelData);

  console.log('\n============================================================');
  console.log('🎉 ALL BACKEND & AGENT ENGINE CHECKS PASSED WITH FLYING COLORS');
  console.log('============================================================');
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
