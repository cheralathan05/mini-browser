import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
import http from "node:http";
import { app, server } from "../src/server.js";
import { prisma } from "../src/config/db.js";

const TEST_PORT = 8999;
let baseUrl = `http://localhost:${TEST_PORT}`;
let authToken = "";
let testUserId = "";
let testWorkspaceId = "";
let testTaskId = "";

describe("NEXUS Backend Full-Stack Integration Suite", () => {
  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      const { CancellationManager } = await import("../src/agents/runtime/state-managers.js");
      if (testTaskId) {
        const runs = await prisma.agentRun.findMany({ where: { agentTaskId: testTaskId } }).catch(() => []);
        for (const r of runs) {
          CancellationManager.cancel(r.id);
        }
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 150));

    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    }
    const { wsManager } = await import("../src/websocket/ws-server.js");
    wsManager.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });


  test("1. Health Endpoint returns 200 OK", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { status: string };
    assert.equal(data.status, "ok");
  });

  test("2. User Registration (POST /api/auth/register)", async () => {
    const uniqueEmail = `test_${Date.now()}@nexus.local`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: uniqueEmail,
        password: "securepassword123",
        name: "Test Engineer",
      }),
    });

    assert.equal(res.status, 201);
    const data = (await res.json()) as { token: string; user: { id: string; email: string } };
    assert.ok(data.token);
    assert.ok(data.user.id);
    authToken = data.token;
    testUserId = data.user.id;
  });

  test("3. User Current Profile (GET /api/auth/me)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as { user: { id: string; email: string } };
    assert.equal(data.user.id, testUserId);
  });

  test("3b. User Profile Update (PATCH /api/users/me)", async () => {
    const res = await fetch(`${baseUrl}/api/users/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Updated Principal Engineer",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100",
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as { user: { name: string; avatar: string } };
    assert.equal(data.user.name, "Updated Principal Engineer");
    assert.ok(data.user.avatar);
  });

  test("3c. User Preferences CRUD (PUT & GET /api/users/me/preferences)", async () => {
    const putRes = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        theme: "pure-black",
        defaultSearchEngine: "duckduckgo",
        accentGlow: true,
      }),
    });

    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/users/me/preferences`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(getRes.status, 200);
    const data = (await getRes.json()) as { preferences: Record<string, unknown> };
    assert.equal(data.preferences.theme, "pure-black");
    assert.equal(data.preferences.defaultSearchEngine, "duckduckgo");
  });

  test("3d. User Directory Listing (GET /api/users)", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { users: Array<{ id: string; email: string }> };
    assert.ok(Array.isArray(data.users));
    assert.ok(data.users.length >= 1);
  });


  test("4. Workspace CRUD Operations", async () => {
    // Create workspace
    const createRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Automated Integration Workspace",
        description: "Tested via integration suite",
      }),
    });

    assert.equal(createRes.status, 201);
    const createData = (await createRes.json()) as { workspace: { id: string; name: string } };
    assert.equal(createData.workspace.name, "Automated Integration Workspace");
    testWorkspaceId = createData.workspace.id;

    // List workspaces
    const listRes = await fetch(`${baseUrl}/api/workspaces`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { workspaces: Array<{ id: string }> };
    assert.ok(listData.workspaces.some((w) => w.id === testWorkspaceId));
  });

  test("5. Memory System (remember, query, scoped)", async () => {
    const postRes = await fetch(`${baseUrl}/api/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        type: "fact",
        key: "unit_test_key",
        content: "Integration test memory value",
        importance: 0.9,
      }),
    });

    assert.equal(postRes.status, 201);
    const postData = (await postRes.json()) as { memory: { id: string; key: string } };
    assert.equal(postData.memory.key, "unit_test_key");

    // Search memory
    const getRes = await fetch(`${baseUrl}/api/memory?q=unit_test_key`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { memories: Array<{ key: string }> };
    assert.ok(getData.memories.some((m) => m.key === "unit_test_key"));
  });

  test("6. Agent Task Creation & Execution Lifecycle", async () => {
    const res = await fetch(`${baseUrl}/api/agent/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        title: "Integration Test Agent Task",
        goal: "Navigate to docs and synthesize test status",
        priority: "high",
      }),
    });

    assert.equal(res.status, 201);
    const data = (await res.json()) as { task: { id: string; status: string } };
    assert.ok(data.task.id);
    testTaskId = data.task.id;

    // Verify task is persisted in DB
    const persisted = await prisma.agentTask.findUnique({ where: { id: testTaskId } });
    assert.ok(persisted);
    assert.equal(persisted.title, "Integration Test Agent Task");

    // Check task by ID
    const getRes = await fetch(`${baseUrl}/api/agent/tasks/${testTaskId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { task: { id: string } };
    assert.equal(getData.task.id, testTaskId);
  });

  test("7. Workflow Engine Definition & Execution", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        name: "Test Pipeline",
        description: "Test pipeline definition",
        definition: {
          steps: [
            { id: "s1", name: "Step 1", type: "browser_action" },
            { id: "s2", name: "Step 2", type: "save_result" },
          ],
        },
      }),
    });

    assert.equal(res.status, 201);
    const data = (await res.json()) as { workflow: { id: string } };
    assert.ok(data.workflow.id);

    // Run workflow
    const runRes = await fetch(`${baseUrl}/api/workflows/${data.workflow.id}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(runRes.status, 202);
  });

  test("8. Skills Catalog & Execution", async () => {
    const res = await fetch(`${baseUrl}/api/skills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        name: "Test Crawler Skill",
        description: "Crawls test sites",
        instructions: "Extract links from page",
        tools: ["browser_navigate"],
      }),
    });

    assert.equal(res.status, 201);
    const data = (await res.json()) as { skill: { id: string } };
    assert.ok(data.skill.id);
  });

  test("9. Approvals Interception & Resolution", async () => {
    // Create an approval request directly
    const approval = await prisma.approvalRequest.create({
      data: {
        userId: testUserId,
        workspaceId: testWorkspaceId,
        taskId: testTaskId,
        action: "submit_form",
        target: "https://example.com/checkout",
        status: "pending",
      },
    });

    // Approve
    const approveRes = await fetch(`${baseUrl}/api/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(approveRes.status, 200);
    const approveData = (await approveRes.json()) as { approval: { status: string } };
    assert.equal(approveData.approval.status, "approved");
  });

  test("10. Activity Events Persistence", async () => {
    const res = await fetch(`${baseUrl}/api/activity`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { activities: unknown[] };
    assert.ok(Array.isArray(data.activities));
  });

  test("11. System Health & Detailed Subsystem Probes (GET /api/health & /database)", async () => {
    const resHealth = await fetch(`${baseUrl}/api/health`);
    assert.equal(resHealth.status, 200);
    const healthData = (await resHealth.json()) as { status: string; services: { database: string } };
    assert.equal(healthData.status, "healthy");
    assert.equal(healthData.services.database, "healthy");

    const resDb = await fetch(`${baseUrl}/api/health/database`);
    assert.equal(resDb.status, 200);
    const dbData = (await resDb.json()) as { status: string; metrics: { users: number } };
    assert.ok(dbData.status === "connected" || dbData.status === "healthy");
    assert.ok(typeof dbData.metrics.users === "number");
  });

  test("12. NEXUS Omnibox Intent Engine (POST /api/nexus/intent)", async () => {
    // 12a: Direct URL navigation
    const resUrl = await fetch(`${baseUrl}/api/nexus/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query: "github.com" }),
    });
    assert.equal(resUrl.status, 200);
    const dataUrl = (await resUrl.json()) as { intent: string; action: string; target?: string };
    assert.equal(dataUrl.intent, "navigate");
    assert.equal(dataUrl.target, "https://github.com");

    // 12b: Research intent
    const resResearch = await fetch(`${baseUrl}/api/nexus/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query: "Research AI browser startups" }),
    });
    assert.equal(resResearch.status, 200);
    const dataResearch = (await resResearch.json()) as { intent: string };
    assert.equal(dataResearch.intent, "start_research");
  });

  test("13. Browser Context Analysis Engine (POST /api/browser/analyze)", { timeout: 20000 }, async () => {
    const res = await fetch(`${baseUrl}/api/browser/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        url: "https://arxiv.org/abs/2308.08155",
        title: "Cognitive Architectures for Autonomous Agents",
        content: "Autonomous agents integrate perception, planning, tool usage, and memory.",
        action: "save_memory",
      }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { action: string; memory: any; message: string };
    assert.equal(data.action, "save_memory");
    assert.ok(data.memory?.id);
  });
});
