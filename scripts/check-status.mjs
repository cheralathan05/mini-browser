async function main() {
  const loginRes = await fetch('http://127.0.0.1:8001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'agent-evaluator@nexus-browser.ai',
      password: 'NexusPassword123!',
    }),
  });
  const { token } = await loginRes.json();
  const tasksRes = await fetch('http://127.0.0.1:8001/api/agents/tasks', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tasksData = await tasksRes.json();
  console.log('Total tasks:', tasksData.tasks.length);
  for (const t of tasksData.tasks) {
    console.log(`Task: ${t.id} | Status: ${t.status} | Title: "${t.title}"`);
    for (const r of t.runs || []) {
      console.log(`  Run ${r.id}: Status: ${r.status}, Progress: ${r.progress}%, Steps: ${r.steps?.length}, Artifacts: ${r.artifacts?.length}`);
      for (const a of r.artifacts || []) {
        console.log(`    - Artifact: [${a.type}] ${a.name} (${a.content?.length} chars)`);
      }
    }
  }
}
main().catch(console.error);
