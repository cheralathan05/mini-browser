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


  async function ensureTestAuth() {
    if (authToken && testUserId && testWorkspaceId) return;
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
    if (res.status === 201) {
      const data = (await res.json()) as { token: string; user: { id: string } };
      authToken = data.token;
      testUserId = data.user.id;
      const ws = await prisma.workspace.findFirst({ where: { userId: testUserId } });
      if (ws) testWorkspaceId = ws.id;
    }
  }

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
    const ws = await prisma.workspace.findFirst({ where: { userId: testUserId } });
    if (ws) testWorkspaceId = ws.id;
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

  test("14. Coding Projects CRUD & Version Snapshot (POST & GET /api/coding/projects)", async () => {
    // 14a: Create Project
    const createRes = await fetch(`${baseUrl}/api/coding/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Binary Search Implementation",
        language: "python",
        problemTitle: "Binary Search",
        problemStatement: "Find target in sorted array in O(log N) time",
        code: "def search(nums, target):\n    return -1\n",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = (await createRes.json()) as { project: { id: string; name: string } };
    assert.ok(createData.project.id);
    assert.equal(createData.project.name, "Binary Search Implementation");

    // 14b: Save Version Snapshot
    const verRes = await fetch(`${baseUrl}/api/coding/projects/${createData.project.id}/versions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        code: "def search(nums, target):\n    l, r = 0, len(nums) - 1\n    while l <= r:\n        m = (l + r) // 2\n        if nums[m] == target: return m\n        elif nums[m] < target: l = m + 1\n        else: r = m - 1\n    return -1\n",
        description: "Optimal binary search implementation",
      }),
    });
    assert.equal(verRes.status, 201);
    const verData = (await verRes.json()) as { version: { versionNumber: number } };
    assert.equal(verData.version.versionNumber, 2);

    // 14c: Get Project Detail
    const detailRes = await fetch(`${baseUrl}/api/coding/projects/${createData.project.id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { project: { versions: any[]; currentCode: string } };
    assert.equal(detailData.project.versions.length, 2);
  });

  test("15. Secure Isolated Code Execution Sandbox (POST /api/coding/execute)", async () => {
    // 15a: Python execution
    const pyRes = await fetch(`${baseUrl}/api/coding/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        language: "python",
        code: "print('NEXUS Python 3.13 Sandbox OK')\n",
        testCases: [
          { input: "test", expectedOutput: "NEXUS Python 3.13 Sandbox OK" },
        ],
      }),
    });
    assert.equal(pyRes.status, 200);
    const pyData = (await pyRes.json()) as { execution: { success: boolean; stdout: string; exitCode: number; durationMs: number; testResults: any[] } };
    assert.equal(pyData.execution.exitCode, 0);
    assert.ok(pyData.execution.stdout.includes("NEXUS Python 3.13 Sandbox OK"));
    assert.equal(pyData.execution.testResults[0].passed, true);
    assert.ok(pyData.execution.durationMs >= 0);

    // 15b: Node.js execution
    const nodeRes = await fetch(`${baseUrl}/api/coding/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        language: "javascript",
        code: "console.log('NEXUS Node.js v24 Sandbox OK');",
      }),
    });
    assert.equal(nodeRes.status, 200);
    const nodeData = (await nodeRes.json()) as { execution: { exitCode: number; stdout: string } };
    assert.equal(nodeData.execution.exitCode, 0);
    assert.ok(nodeData.execution.stdout.includes("NEXUS Node.js v24 Sandbox OK"));
  });

  test("16. SSRF Protection on Webpage Capture & Problem Import", async () => {
    // 16a: Localhost rejected
    const blockLocal = await fetch(`${baseUrl}/api/coding/import-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ url: "http://127.0.0.1:8001/api/users" }),
    });
    assert.ok(blockLocal.status === 400 || blockLocal.status === 403);

    // 16b: Private IP rejected
    const blockPrivate = await fetch(`${baseUrl}/api/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ url: "http://192.168.1.1/admin" }),
    });
    assert.ok(blockPrivate.status === 400 || blockPrivate.status === 500);
  });

  test("17. Picture Studio Captures Listing & AI Vision Analysis", async () => {
    // List captures
    const listRes = await fetch(`${baseUrl}/api/captures`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { captures: unknown[] };
    assert.ok(Array.isArray(listData.captures));
  });

  test("18. AI Conversation Rename & Management (PATCH /api/ai/conversations/:id)", async () => {
    // 18a: Create conversation
    const convRes = await fetch(`${baseUrl}/api/ai/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: "Initial Discussion Title",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(convRes.status, 201);
    const convData = (await convRes.json()) as { conversation: { id: string; title: string } };
    assert.equal(convData.conversation.title, "Initial Discussion Title");

    // 18b: Rename conversation
    const renameRes = await fetch(`${baseUrl}/api/ai/conversations/${convData.conversation.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: "Renamed Algorithmic Discussion",
      }),
    });
    assert.equal(renameRes.status, 200);
    const renameData = (await renameRes.json()) as { conversation: { title: string } };
    assert.equal(renameData.conversation.title, "Renamed Algorithmic Discussion");
  });

  test("19. AI Solution Generation (POST /api/coding/generate)", async () => {
    const res = await fetch(`${baseUrl}/api/coding/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        language: "python",
        problemTitle: "Reverse a String",
        strategy: "optimal",
        includeComments: true,
        includeTests: true,
      }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { success: boolean; code: string; language: string; strategy: string };
    assert.equal(data.success, true);
    assert.ok(data.code);
    assert.equal(data.language, "python");
    assert.equal(data.strategy, "optimal");
  });

  test("20. Real Downloads Manager CRUD, Metrics & Search (/api/downloads)", async () => {
    // 20a: Create download record
    const createRes = await fetch(`${baseUrl}/api/downloads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        filename: "dataset_v1.json",
        sourceUrl: "https://data.nexus.dev/exports/dataset_v1.json",
        mimeType: "application/json",
        extension: "json",
        expectedSize: 2048,
        downloadedSize: 2048,
        status: "completed",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = (await createRes.json()) as { download: { id: string; filename: string; sourceDomain: string } };
    assert.ok(createData.download.id);
    assert.equal(createData.download.filename, "dataset_v1.json");
    assert.equal(createData.download.sourceDomain, "data.nexus.dev");

    // 20b: List downloads and verify empirical metrics
    const listRes = await fetch(`${baseUrl}/api/downloads?search=dataset`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { downloads: any[]; total: number; completedCount: number; totalBytes: number };
    assert.ok(listData.downloads.length >= 1);
    assert.ok(listData.total >= 1);
    assert.ok(listData.completedCount >= 1);
    assert.ok(listData.totalBytes >= 2048);
  });

  test("21. Downloads Safe Preview, Retry & Cancellation", async () => {
    // 21a: Create in-progress download
    const createRes = await fetch(`${baseUrl}/api/downloads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        filename: "sample_archive.zip",
        sourceUrl: "https://packages.nexus.dev/sample_archive.zip",
        status: "in_progress",
        expectedSize: 1048576,
        downloadedSize: 524288,
      }),
    });
    assert.equal(createRes.status, 201);
    const { download } = (await createRes.json()) as { download: { id: string } };

    // 21b: Cancel download
    const cancelRes = await fetch(`${baseUrl}/api/downloads/${download.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(cancelRes.status, 200);
    const cancelData = (await cancelRes.json()) as { download: { status: string } };
    assert.equal(cancelData.download.status, "cancelled");

    // 21c: Retry download
    const retryRes = await fetch(`${baseUrl}/api/downloads/${download.id}/retry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(retryRes.status, 200);
    const retryData = (await retryRes.json()) as { download: { status: string } };
    assert.equal(retryData.download.status, "in_progress");

    // 21d: Safe preview endpoint
    const prevRes = await fetch(`${baseUrl}/api/downloads/${download.id}/preview`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(prevRes.status, 200);
    const prevData = (await prevRes.json()) as { preview: { filename: string; category: string } };
    assert.equal(prevData.preview.filename, "sample_archive.zip");
    assert.equal(prevData.preview.category, "archive");
  });

  test("22. PostgreSQL Bookmarks CRUD & Bulk Sync (/api/bookmarks)", async () => {
    // 22a: Create bookmark
    const createRes = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: "TypeScript Documentation",
        url: "https://www.typescriptlang.org/docs/",
        folder: "Development",
        tags: ["ts", "types", "docs"],
        isPinned: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = (await createRes.json()) as { bookmark: { id: string; title: string; folder: string } };
    assert.ok(createData.bookmark.id);
    assert.equal(createData.bookmark.title, "TypeScript Documentation");

    // 22b: List bookmarks
    const listRes = await fetch(`${baseUrl}/api/bookmarks?folder=Development`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { bookmarks: any[] };
    assert.ok(listData.bookmarks.some((b) => b.id === createData.bookmark.id));

    // 22c: Patch bookmark
    const patchRes = await fetch(`${baseUrl}/api/bookmarks/${createData.bookmark.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ title: "Updated TypeScript Handbook" }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = (await patchRes.json()) as { bookmark: { title: string } };
    assert.equal(patchData.bookmark.title, "Updated TypeScript Handbook");

    // 22d: Bulk sync
    const syncRes = await fetch(`${baseUrl}/api/bookmarks/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        bookmarks: [
          { title: "React Docs", url: "https://react.dev", category: "Frameworks" },
          { title: "Node.js API", url: "https://nodejs.org/api", category: "Runtime" },
        ],
      }),
    });
    assert.equal(syncRes.status, 200);
    const syncData = (await syncRes.json()) as { count: number };
    assert.ok(syncData.count >= 2);
  });

  test("23. PostgreSQL History Logging, Period Filtering & Clearing (/api/history)", async () => {
    // 23a: Record visit
    const recordRes = await fetch(`${baseUrl}/api/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: "GitHub Pull Requests",
        url: "https://github.com/nexus/pulls",
        isAgentVisit: false,
      }),
    });
    assert.equal(recordRes.status, 201);
    const recordData = (await recordRes.json()) as { historyItem: { id: string; visitCount: number } };
    assert.ok(recordData.historyItem.id);
    assert.equal(recordData.historyItem.visitCount, 1);

    // 23b: Increment visitCount on re-visit
    const revisitRes = await fetch(`${baseUrl}/api/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: "GitHub Pull Requests",
        url: "https://github.com/nexus/pulls",
      }),
    });
    assert.equal(revisitRes.status, 200);
    const revisitData = (await revisitRes.json()) as { historyItem: { visitCount: number } };
    assert.equal(revisitData.historyItem.visitCount, 2);

    // 23c: List with period filter
    const listRes = await fetch(`${baseUrl}/api/history?period=Today`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { history: any[] };
    assert.ok(listData.history.some((h) => h.url === "https://github.com/nexus/pulls"));
  });

  test("24. AI Downloads Assistant Grounded Inference (/api/downloads/ai/ask)", async () => {
    const askRes = await fetch(`${baseUrl}/api/downloads/ai/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        query: "Summarize the downloaded files and group them by format.",
        action: "summarize",
      }),
    });
    assert.equal(askRes.status, 200);
    const askData = (await askRes.json()) as { answer: string; filesInspected: number };
    assert.ok(typeof askData.answer === "string");
    assert.ok(askData.filesInspected >= 1);
  });

  test("25. NEXUS Deep Research Engine - Creation, Modes & Persistence (/api/v1/investigations)", async () => {
    // 25a: Create Quick Investigation via /api/v1/investigations alias
    const quickRes = await fetch(`${baseUrl}/api/v1/investigations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        name: "Quick Research: Vector DB Architectures",
        question: "Compare HNSW and IVFPQ indexing in modern vector databases",
        mode: "quick",
        sourcePreferences: ["web", "docs"],
        outputFormat: "brief",
      }),
    });
    assert.equal(quickRes.status, 201);
    const quickData = (await quickRes.json()) as { project: { id: string; mode: string; name: string } };
    assert.ok(quickData.project.id);
    assert.equal(quickData.project.mode, "quick");

    // 25b: Create Deep Investigation via /api/research
    const deepRes = await fetch(`${baseUrl}/api/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        name: "Deep Research: Autonomous Multi-Agent Consensus",
        question: "Analyze Byzantine fault tolerance in decentralized autonomous multi-agent systems",
        mode: "deep",
        sourcePreferences: ["web", "paper", "github"],
        outputFormat: "report",
      }),
    });
    assert.equal(deepRes.status, 201);
    const deepData = (await deepRes.json()) as { project: { id: string; mode: string } };
    assert.ok(deepData.project.id);
    assert.equal(deepData.project.mode, "deep");

    // 25c: Verify full research graph retrieval
    const graphRes = await fetch(`${baseUrl}/api/v1/investigations/${deepData.project.id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(graphRes.status, 200);
    const graphData = (await graphRes.json()) as {
      project: { id: string; plans: any[]; sources: any[]; findings: any[] };
    };
    assert.equal(graphData.project.id, deepData.project.id);
    assert.ok(Array.isArray(graphData.project.plans));
  });

  test("26. NEXUS Deep Research - SSRF Security Protections & Source Extraction Validation", async () => {
    const { SourceExtractionService } = await import("../src/modules/research/source-extraction.service.js");

    // 26a: Reject localhost and loopback
    const loopbackTest = await SourceExtractionService.extractSource("http://127.0.0.1:8001/admin");
    assert.equal(loopbackTest.success, false);
    assert.ok(loopbackTest.error?.includes("SSRF Blocked"));

    // 26b: Reject cloud metadata service (AWS/GCP link-local 169.254.169.254)
    const metadataTest = await SourceExtractionService.extractSource("http://169.254.169.254/latest/meta-data/");
    assert.equal(metadataTest.success, false);
    assert.ok(metadataTest.error?.includes("SSRF Blocked"));

    // 26c: Reject non-http protocols (file:///, ftp://)
    const fileProtoTest = await SourceExtractionService.extractSource("file:///etc/passwd");
    assert.equal(fileProtoTest.success, false);
    assert.ok(fileProtoTest.error?.includes("SSRF Blocked"));
  });

  test("27. NEXUS Deep Research - Rename, Q&A Follow-ups, Search, and Cancellation Lifecycle", async () => {
    // 27a: Create test project
    const createRes = await fetch(`${baseUrl}/api/v1/investigations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        workspaceId: testWorkspaceId,
        name: "Temporary Investigation Lifecycle Test",
        question: "Evaluate server-driven UI trade-offs in mobile architectures",
        mode: "standard",
      }),
    });
    assert.equal(createRes.status, 201);
    const { project } = (await createRes.json()) as { project: { id: string } };

    // 27b: Rename investigation via PATCH /api/v1/investigations/:id
    const renameRes = await fetch(`${baseUrl}/api/v1/investigations/${project.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Renamed: Server-Driven UI Empirical Analysis",
      }),
    });
    assert.equal(renameRes.status, 200);
    const renameData = (await renameRes.json()) as { project: { name: string } };
    assert.equal(renameData.project.name, "Renamed: Server-Driven UI Empirical Analysis");

    // 27c: Ask follow-up Q&A via /api/v1/investigations/:id/follow-ups
    const followUpRes = await fetch(`${baseUrl}/api/v1/investigations/${project.id}/follow-ups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        question: "What are the core trade-offs between SSR and client caching?",
      }),
    });
    assert.equal(followUpRes.status, 200);
    const followUpData = (await followUpRes.json()) as { answer: string };
    assert.ok(typeof followUpData.answer === "string");
    assert.ok(followUpData.answer.length > 10);

    // 27d: Cancel investigation
    const cancelRes = await fetch(`${baseUrl}/api/v1/investigations/${project.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(cancelRes.status, 200);

    // 27e: Verify status filter
    const listRes = await fetch(`${baseUrl}/api/v1/investigations?status=all&q=Server-Driven`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { projects: any[] };
    assert.ok(listData.projects.some((p) => p.id === project.id));

    // 27f: Delete investigation
    const delRes = await fetch(`${baseUrl}/api/v1/investigations/${project.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  // ============================================================
  // NEXUS AUTOMATION STUDIO TESTS (Tests 28 - 32)
  // ============================================================

  test("28. Automation Studio Presets & Objective Planning (/api/v1/automation/presets & /plan)", async () => {
    // 28a: Presets catalog
    const presetsRes = await fetch(`${baseUrl}/api/v1/automation/presets`);
    assert.equal(presetsRes.status, 200);
    const { presets } = (await presetsRes.json()) as { presets: any[] };
    assert.ok(Array.isArray(presets));
    assert.equal(presets.length, 6);
    const presetIds = presets.map((p) => p.id);
    assert.ok(presetIds.includes("trending-ai-research"));
    assert.ok(presetIds.includes("ai-research-report"));
    assert.ok(presetIds.includes("web-form-assistance"));
    assert.ok(presetIds.includes("whatsapp-automation"));
    assert.ok(presetIds.includes("coding-workflow"));
    assert.ok(presetIds.includes("website-capture-analysis"));

    // 28b: Objective planning with assisted mode
    const planRes = await fetch(`${baseUrl}/api/v1/automation/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        objective: "Research top 3 vector indexing algorithms and save comparison report",
        mode: "assisted",
      }),
    });
    assert.equal(planRes.status, 200);
    const planData = (await planRes.json()) as { plan: any; valid: boolean; errors: string[] };
    assert.equal(planData.valid, true);
    assert.ok(Array.isArray(planData.plan.steps));
    assert.ok(planData.plan.steps.length >= 2);
    assert.equal(planData.plan.mode, "assisted");

    // 28c: Manual mode enforces approval on consequential steps
    const manualPlanRes = await fetch(`${baseUrl}/api/v1/automation/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        objective: "Draft WhatsApp message and submit feedback form",
        mode: "manual",
      }),
    });
    assert.equal(manualPlanRes.status, 200);
    const manualData = (await manualPlanRes.json()) as { plan: any };
    assert.equal(manualData.plan.mode, "manual");
    assert.ok(manualData.plan.approvalRequirements.length > 0);
  });

  test("29. Automation Persistent Workflow Execution & Cancellation (/api/v1/automation/execute)", async () => {
    // 29a: Execute preset workflow
    const execRes = await fetch(`${baseUrl}/api/v1/automation/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        presetId: "coding-workflow",
        mode: "assisted",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(execRes.status, 202);
    const execData = (await execRes.json()) as { workflowId: string; executionId: string; status: string };
    assert.ok(execData.workflowId);
    assert.ok(execData.executionId);
    assert.equal(execData.status, "running");

    // 29b: List executions
    const listRes = await fetch(`${baseUrl}/api/v1/automation/executions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { executions: any[] };
    assert.ok(listData.executions.some((e) => e.id === execData.executionId));

    // 29c: Fetch execution details
    const detailRes = await fetch(`${baseUrl}/api/v1/automation/executions/${execData.executionId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { execution: any };
    assert.equal(detailData.execution.id, execData.executionId);

    // 29d: Cancel execution
    const cancelRes = await fetch(`${baseUrl}/api/v1/automation/executions/${execData.executionId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(cancelRes.status, 200);
    const cancelData = (await cancelRes.json()) as { success: boolean };
    assert.equal(cancelData.success, true);

    // 29e: Retry execution
    const retryRes = await fetch(`${baseUrl}/api/v1/automation/executions/${execData.executionId}/retry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(retryRes.status, 202);
    const retryData = (await retryRes.json()) as { executionId: string; status: string };
    assert.ok(retryData.executionId);
  });

  test("30. WhatsApp Phone Format Validation & Direct Dispatch (/api/v1/automation/whatsapp)", async () => {
    // 30a: Rejects invalid phone numbers
    const invalidRes = await fetch(`${baseUrl}/api/v1/automation/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        recipient: "not-a-phone-number",
        message: "Test payload",
      }),
    });
    assert.equal(invalidRes.status, 500);

    // 30b: Direct dispatch with valid E.164 phone number
    const validRes = await fetch(`${baseUrl}/api/v1/automation/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        recipient: "+1 (555) 019-2834",
        message: "NEXUS Automation Studio: Integration test verified.",
        templateId: "milestone",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(validRes.status, 200);
    const validData = (await validRes.json()) as { result: any };
    assert.equal(validData.result.success, true);
    assert.equal(validData.result.recipient, "+15550192834");
    assert.equal(validData.result.status, "delivered");
    assert.ok(validData.result.messageId.startsWith("wamid."));

    // 30c: Dispatch requiring approval creates ApprovalRequest
    const approvalReqRes = await fetch(`${baseUrl}/api/v1/automation/whatsapp/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        recipient: "+44 7911 123456",
        message: "Gated message payload awaiting review",
        requiresApproval: true,
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(approvalReqRes.status, 200);
    const approvalReqData = (await approvalReqRes.json()) as { result: any };
    assert.equal(approvalReqData.result.requiresApproval, true);
    assert.ok(approvalReqData.result.approvalId);

    // 30d: Check WhatsApp gateway status
    const statusRes = await fetch(`${baseUrl}/api/v1/automation/whatsapp/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(statusRes.status, 200);
    const statusData = (await statusRes.json()) as { connection: any };
    assert.equal(statusData.connection.status, "connected");
    assert.ok(statusData.connection.channel);
  });

  test("31. Approvals Center Workflow Auto-Resumption (/api/approvals/:id/approve)", async () => {
    await ensureTestAuth();
    // 31a: Create a paused workflow execution and approval request
    const wfRes = await fetch(`${baseUrl}/api/v1/automation/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        presetId: "web-form-assistance",
        mode: "assisted",
        workspaceId: testWorkspaceId,
      }),
    });
    assert.equal(wfRes.status, 202);

    // 31b: Fetch pending approvals
    const pendingRes = await fetch(`${baseUrl}/api/approvals/pending`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(pendingRes.status, 200);
    const pendingData = (await pendingRes.json()) as { approvals: any[] };
    assert.ok(Array.isArray(pendingData.approvals));

    if (pendingData.approvals.length > 0) {
      const appr = pendingData.approvals[0];
      // 31c: Authorize and resume
      const approveRes = await fetch(`${baseUrl}/api/approvals/${appr.id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(approveRes.status, 200);
      const approveData = (await approveRes.json()) as { approval: any };
      assert.equal(approveData.approval.status, "approved");
    }
  });

  test("32. Integrations Registry & Live Verification (/api/v1/integrations)", async () => {
    // 32a: List verified integrations
    const listRes = await fetch(`${baseUrl}/api/v1/integrations`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { integrations: any[] };
    assert.ok(Array.isArray(listData.integrations));
    assert.ok(listData.integrations.length >= 5);

    const providers = listData.integrations.map((i) => i.provider);
    assert.ok(providers.includes("whatsapp"));
    assert.ok(providers.includes("ai"));
    assert.ok(providers.includes("sandbox"));
    assert.ok(providers.includes("research"));
    assert.ok(providers.includes("capture"));
    assert.ok(providers.includes("database"));

    // 32b: Live verify AI provider connection
    const verifyAiRes = await fetch(`${baseUrl}/api/v1/integrations/ai/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(verifyAiRes.status, 200);
    const verifyAiData = (await verifyAiRes.json()) as { integration: any };
    assert.ok(verifyAiData.integration.status === "connected" || verifyAiData.integration.status === "degraded");
    assert.ok(verifyAiData.integration.latencyMs >= 1);

    // 32c: Live verify Code Sandbox runtime
    const verifySandboxRes = await fetch(`${baseUrl}/api/v1/integrations/sandbox/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(verifySandboxRes.status, 200);
    const verifySandboxData = (await verifySandboxRes.json()) as { integration: any };
    assert.equal(verifySandboxData.integration.status, "connected");

    // 32d: Live verify Database connection
    const verifyDbRes = await fetch(`${baseUrl}/api/v1/integrations/database/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(verifyDbRes.status, 200);
    const verifyDbData = (await verifyDbRes.json()) as { integration: any };
    assert.equal(verifyDbData.integration.status, "connected");
  });

  test("33. Visual Workflow Builder: Graph Validation & Error Diagnostics", async () => {
    const { WorkflowValidator } = await import("../src/modules/workflows/workflow-validator.js");

    // 33a: Empty graph fails
    const emptyRes = WorkflowValidator.validate({ nodes: [], edges: [] });
    assert.equal(emptyRes.valid, false);
    assert.ok(emptyRes.errors.some((e) => e.code === "EMPTY_GRAPH"));

    // 33b: Duplicate node ID fails
    const dupRes = WorkflowValidator.validate({
      nodes: [
        { id: "node_1", type: "trigger.manual", title: "Start", category: "trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "node_1", type: "browser.openUrl", title: "Open", category: "browser", position: { x: 100, y: 0 }, config: { url: "https://example.com" } },
      ],
      edges: [],
    });
    assert.equal(dupRes.valid, false);
    assert.ok(dupRes.errors.some((e) => e.code === "DUPLICATE_NODE_ID"));

    // 33c: Dangling edge references
    const dangleRes = WorkflowValidator.validate({
      nodes: [
        { id: "node_1", type: "trigger.manual", title: "Start", category: "trigger", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "node_1", target: "ghost_node" }],
    });
    assert.equal(dangleRes.valid, false);
    assert.ok(dangleRes.errors.some((e) => e.code === "DANGLING_EDGE_TARGET"));

    // 33d: Missing required input
    const missingInputRes = WorkflowValidator.validate({
      nodes: [
        { id: "node_1", type: "trigger.manual", title: "Start", category: "trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "node_2", type: "browser.openUrl", title: "Open", category: "browser", position: { x: 100, y: 0 }, config: { url: "" } },
      ],
      edges: [{ id: "e1", source: "node_1", target: "node_2" }],
    });
    assert.equal(missingInputRes.valid, false);
    assert.ok(missingInputRes.errors.some((e) => e.code === "MISSING_REQUIRED_INPUT"));

    // 33e: Valid 4-node form workflow passes
    const validFlow = {
      nodes: [
        { id: "n_trig", type: "trigger.manual", title: "Start", category: "trigger" as const, position: { x: 0, y: 0 }, config: {} },
        { id: "n_open", type: "browser.openUrl", title: "Open", category: "browser" as const, position: { x: 100, y: 0 }, config: { url: "https://example.com/form" } },
        { id: "n_fill", type: "browser.fillForm", title: "Fill", category: "browser" as const, position: { x: 200, y: 0 }, config: { fields: { "input[name='fullName']": "Alex Rivera" } } },
        { id: "n_click", type: "browser.click", title: "Click", category: "browser" as const, position: { x: 300, y: 0 }, config: { selector: "button[type='submit']" } },
        { id: "n_end", type: "output.end", title: "End", category: "output" as const, position: { x: 400, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "n_trig", target: "n_open" },
        { id: "e2", source: "n_open", target: "n_fill" },
        { id: "e3", source: "n_fill", target: "n_click" },
        { id: "e4", source: "n_click", target: "n_end" },
      ],
    };
    const validRes = WorkflowValidator.validate(validFlow);
    assert.equal(validRes.valid, true);
    assert.equal(validRes.errors.length, 0);
  });

  test("34. Visual Workflow Builder: Versioned Persistence & Duplication (/api/v1/workflows)", async () => {
    const validFlow = {
      nodes: [
        { id: "n_trig", type: "trigger.manual", title: "Start", category: "trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "n_open", type: "browser.openUrl", title: "Open", category: "browser", position: { x: 100, y: 0 }, config: { url: "https://example.com" } },
        { id: "n_end", type: "output.end", title: "End", category: "output", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "n_trig", target: "n_open" },
        { id: "e2", source: "n_open", target: "n_end" },
      ],
    };

    // 34a: Create workflow with version 1
    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Test Visual Workflow",
        description: "Test versioned workflow pipeline",
        definition: validFlow,
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = (await createRes.json()) as { workflow: any };
    const wfId = createData.workflow.id;
    assert.equal(createData.workflow.version, 1);

    // 34b: Server-side validation endpoint
    const valRes = await fetch(`${baseUrl}/api/v1/workflows/${wfId}/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ definition: validFlow }),
    });
    assert.equal(valRes.status, 200);
    const valData = (await valRes.json()) as { valid: boolean };
    assert.equal(valData.valid, true);

    // 34c: Update definition -> increments to version 2
    const updatedFlow = {
      ...validFlow,
      nodes: [
        ...validFlow.nodes,
        { id: "n_inspect", type: "browser.inspectPage", title: "Inspect", category: "browser", position: { x: 150, y: 0 }, config: {} },
      ],
    };
    const updateRes = await fetch(`${baseUrl}/api/v1/workflows/${wfId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Renamed Visual Workflow",
        definition: updatedFlow,
        changeLog: "Added page inspection node",
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = (await updateRes.json()) as { workflow: any };
    assert.equal(updateData.workflow.version, 2);
    assert.equal(updateData.workflow.name, "Renamed Visual Workflow");

    // 34d: Fetch version history
    const versionsRes = await fetch(`${baseUrl}/api/v1/workflows/${wfId}/versions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(versionsRes.status, 200);
    const versionsData = (await versionsRes.json()) as { versions: any[] };
    assert.ok(versionsData.versions.length >= 2);
    assert.equal(versionsData.versions[0].version, 2);

    // 34e: Duplicate workflow
    const dupRes = await fetch(`${baseUrl}/api/v1/workflows/${wfId}/duplicate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(dupRes.status, 201);
    const dupData = (await dupRes.json()) as { workflow: any };
    assert.ok(dupData.workflow.name.includes("(Copy)"));
    assert.equal(dupData.workflow.version, 1);
  });

  test("35. Visual Workflow Builder: Execution Engine & Step Telemetry", async () => {
    // 35a: Run 4-node form workflow
    const formFlow = {
      nodes: [
        { id: "step_trig", type: "trigger.manual", title: "Start Flow", category: "trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "step_open", type: "browser.openUrl", title: "Open Portal", category: "browser", position: { x: 100, y: 0 }, config: { url: "https://example.com/form" } },
        { id: "step_fill", type: "browser.fillForm", title: "Fill Lead", category: "browser", position: { x: 200, y: 0 }, config: { fields: { "input[name='fullName']": "Alex Rivera" } } },
        { id: "step_click", type: "browser.click", title: "Click Submit", category: "browser", position: { x: 300, y: 0 }, config: { selector: "button[type='submit']" } },
        { id: "step_end", type: "output.end", title: "End Flow", category: "output", position: { x: 400, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "step_trig", target: "step_open" },
        { id: "e2", source: "step_open", target: "step_fill" },
        { id: "e3", source: "step_fill", target: "step_click" },
        { id: "e4", source: "step_click", target: "step_end" },
      ],
    };

    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Form Submitter Test Runner",
        definition: formFlow,
      }),
    });
    assert.equal(createRes.status, 201);
    const { workflow } = (await createRes.json()) as { workflow: any };

    // 35b: Run workflow
    const runRes = await fetch(`${baseUrl}/api/v1/workflows/${workflow.id}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ definition: formFlow }),
    });
    assert.equal(runRes.status, 202);
    const runData = (await runRes.json()) as { executionId: string; status: string };
    assert.ok(runData.executionId);
    assert.equal(runData.status, "running");

    // 35c: Wait for graph execution to progress through steps
    await new Promise((r) => setTimeout(r, 1200));

    // 35d: Fetch execution details via /api/v1/executions/:id
    const execRes = await fetch(`${baseUrl}/api/v1/executions/${runData.executionId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(execRes.status, 200);
    const execData = (await execRes.json()) as { execution: any };
    assert.ok(execData.execution.steps.length >= 2);
    assert.ok(["running", "completed"].includes(execData.execution.status));

    // Verify first step output telemetry
    const trigStep = execData.execution.steps.find((s: any) => s.nodeId === "step_trig" || s.stepId === "step_trig");
    assert.ok(trigStep);
    assert.ok(trigStep.output);
  });

  test("36. Visual Workflow Builder: Executions List, Cancellation & Deletion", async () => {
    // 36a: List executions
    const listRes = await fetch(`${baseUrl}/api/v1/executions?status=all`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { executions: any[] };
    assert.ok(Array.isArray(listData.executions));
    assert.ok(listData.executions.length >= 1);

    // 36b: Create & delete workflow
    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Temporary Workflow For Deletion",
        definition: {
          nodes: [{ id: "n1", type: "trigger.manual", title: "Start", category: "trigger", position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
      }),
    });
    assert.equal(createRes.status, 201);
    const { workflow } = (await createRes.json()) as { workflow: any };

    const deleteRes = await fetch(`${baseUrl}/api/v1/workflows/${workflow.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(deleteRes.status, 200);
    const deleteData = (await deleteRes.json()) as { success: boolean };
    assert.equal(deleteData.success, true);

    // 36c: Verify deleted
    const verifyDelRes = await fetch(`${baseUrl}/api/v1/workflows/${workflow.id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(verifyDelRes.status, 404);
  });

  test("37. Skills Registry: Central Tool Registry Catalog (/api/v1/skills/tools/catalog)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills/tools/catalog`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { tools: Array<{ id: string; name: string; category: string }>; count: number };
    assert.ok(data.count >= 10);
    const toolIds = data.tools.map((t) => t.id);
    assert.ok(toolIds.includes("browser_navigate"));
    assert.ok(toolIds.includes("browser_extract"));
    assert.ok(toolIds.includes("web_search"));
    assert.ok(toolIds.includes("record_source"));
    assert.ok(toolIds.includes("save_memory"));
    assert.ok(toolIds.includes("save_report"));
    assert.ok(toolIds.includes("analyze_document"));
    assert.ok(toolIds.includes("generate_code"));
    assert.ok(toolIds.includes("run_tests"));
    assert.ok(toolIds.includes("request_approval"));
  });

  test("38. Skills Registry: Default Seeded Skills & Category Filtering (/api/v1/skills)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/skills`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { skills: Array<{ id: string; name: string; category: string; lifecycleState: string }> };
    assert.ok(data.skills.length >= 4);

    const names = data.skills.map((s) => s.name);
    assert.ok(names.includes("Competitor Pricing Monitor"));
    assert.ok(names.includes("Deep Web Research & Synthesizer"));
    assert.ok(names.includes("Web Form Assistant"));
    assert.ok(names.includes("Code Review Assistant"));

    // Filter by category
    const resCat = await fetch(`${baseUrl}/api/v1/skills?category=research`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const catData = (await resCat.json()) as { skills: Array<{ category: string }> };
    assert.ok(catData.skills.every((s) => s.category === "research"));
  });

  test("39. Skills Registry: Lifecycle States, Server-side Validation & Gating (/api/v1/skills)", async () => {
    // 39a: Create skill with unknown tool -> validate catches error
    const invalidSkillRes = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Invalid Tool Skill",
        description: "Uses unknown tools",
        tools: ["non_existent_tool_xyz"],
        inputSchema: [{ name: "query", type: "string", required: true }],
      }),
    });
    assert.equal(invalidSkillRes.status, 201);
    const invalidData = (await invalidSkillRes.json()) as { skill: { id: string; lifecycleState: string }; validation: { valid: boolean; errors: any[] } };
    assert.equal(invalidData.validation.valid, false);
    assert.ok(invalidData.validation.errors.some((e: any) => e.code === "UNKNOWN_TOOL"));

    // 39b: Activating invalid skill must fail
    const actFailRes = await fetch(`${baseUrl}/api/v1/skills/${invalidData.skill.id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(actFailRes.status, 400);

    // 39c: Create valid custom skill -> validate -> activate
    const validSkillRes = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Custom Data Miner",
        description: "Mines structured data using registered tools",
        category: "data",
        tools: ["web_search", "analyze_document"],
        inputSchema: [{ name: "topic", type: "string", required: true }],
        outputSchema: [{ name: "summary", type: "string" }],
        config: { timeoutSeconds: 30, maxRetries: 1 },
      }),
    });
    assert.equal(validSkillRes.status, 201);
    const validSkill = ((await validSkillRes.json()) as { skill: { id: string } }).skill;

    // Validate
    const valRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const valData = (await valRes.json()) as { validation: { valid: boolean } };
    assert.equal(valData.validation.valid, true);

    // Activate
    const actRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(actRes.status, 200);
    const actData = (await actRes.json()) as { skill: { lifecycleState: string } };
    assert.equal(actData.skill.lifecycleState, "active");

    // Disable
    const disRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/disable`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(disRes.status, 200);
    const disData = (await disRes.json()) as { skill: { lifecycleState: string } };
    assert.equal(disData.skill.lifecycleState, "disabled");

    // Disabled skill execution must be rejected
    const execDisabledRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ inputs: { topic: "AI Agents" } }),
    });
    assert.ok(execDisabledRes.status >= 400);

    // Re-activate
    await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });

    // Version increment on definition change
    const patchRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        tools: ["web_search", "analyze_document", "save_report"],
        changeLog: "Added report generation capability",
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = (await patchRes.json()) as { skill: { currentVersion: number } };
    assert.equal(patchData.skill.currentVersion, 2);

    // Rollback to v1
    const rollRes = await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}/versions/1/rollback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(rollRes.status, 200);
    const rollData = (await rollRes.json()) as { skill: { currentVersion: number } };
    assert.equal(rollData.skill.currentVersion, 1);

    // Clean up
    await fetch(`${baseUrl}/api/v1/skills/${invalidData.skill.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await fetch(`${baseUrl}/api/v1/skills/${validSkill.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
  });

  test("40. Skills Registry: Real Skill Execution & Interactive Test Cases", async () => {
    // 40a: Get seeded Competitor Pricing Monitor
    const listRes = await fetch(`${baseUrl}/api/v1/skills`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const { skills } = (await listRes.json()) as { skills: Array<{ id: string; name: string }> };
    const monitorSkill = skills.find((s) => s.name === "Competitor Pricing Monitor");
    assert.ok(monitorSkill);

    // 40b: Execute skill
    const execRes = await fetch(`${baseUrl}/api/v1/skills/${monitorSkill.id}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        inputs: {
          targetUrl: "https://example.com/products/nexus-pro",
          productName: "Nexus Enterprise Pro",
        },
      }),
    });
    assert.equal(execRes.status, 200);
    const execData = (await execRes.json()) as { execution: { id: string; status: string; durationMs: number; outputs: any; error?: string } };
    if (execData.execution.error) console.log("EXEC ERROR:", execData.execution.error);
    assert.ok(execData.execution.id);
    assert.equal(execData.execution.status, "completed");
    assert.ok(execData.execution.durationMs >= 0);
    assert.ok(execData.execution.outputs);

    // 40c: Check execution logs
    const logRes = await fetch(`${baseUrl}/api/v1/skills/${monitorSkill.id}/executions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(logRes.status, 200);
    const logData = (await logRes.json()) as { executions: any[] };
    assert.ok(logData.executions.some((e) => e.id === execData.execution.id));

    // 40d: Run interactive test case
    const testRes = await fetch(`${baseUrl}/api/v1/skills/${monitorSkill.id}/tests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Catalog Verification Test",
        inputs: {
          targetUrl: "https://example.com/catalog",
          productName: "Nexus Autonomous Agent",
        },
        runNow: true,
      }),
    });
    assert.equal(testRes.status, 200);
    const testData = (await testRes.json()) as { test: { id: string; status: string } };
    assert.ok(testData.test.id);
    assert.equal(testData.test.status, "passed");
  });

  test("41. Approvals Center: Central Policies & Server-Side Enforcement (/api/v1/approval-policies)", async () => {
    await ensureTestAuth();
    // 41a: Fetch baseline policies
    const res = await fetch(`${baseUrl}/api/v1/approval-policies`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { policies: any[]; count: number };
    assert.ok(data.count >= 5);
    const names = data.policies.map((p) => p.name);
    assert.ok(names.includes("External Communications Gate"));
    assert.ok(names.includes("External Form Submissions Guard"));
    assert.ok(names.includes("Destructive Operations Guard"));
    assert.ok(names.includes("Sensitive Data & Credential Access Guard"));
    assert.ok(names.includes("Consequential Browser Mutations"));

    // 41b: Update policy threshold and toggling
    const targetPolicy = data.policies[0];
    const patchRes = await fetch(`${baseUrl}/api/v1/approval-policies/${targetPolicy.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        enabled: false,
        riskThreshold: "critical",
        autoExpireHours: 48,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = (await patchRes.json()) as { policy: any };
    assert.equal(patchData.policy.enabled, false);
    assert.equal(patchData.policy.riskThreshold, "critical");
    assert.equal(patchData.policy.autoExpireHours, 48);

    // Re-enable policy
    await fetch(`${baseUrl}/api/v1/approval-policies/${targetPolicy.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ enabled: true, riskThreshold: "moderate", autoExpireHours: 24 }),
    });
  });

  test("42. Approvals Center: Lifecycle, Digest Integrity & Decision Audit (/api/v1/approvals)", async () => {
    await ensureTestAuth();
    const { ApprovalPolicyEngine } = await import("../src/modules/approvals/approval-policy.service.js");

    // 42a: Create approval request with payload digest
    const approvalReq = await ApprovalPolicyEngine.createApproval({
      userId: testUserId,
      workspaceId: testWorkspaceId,
      actionTitle: "External Lead Contact Dispatch",
      actionType: "external_communication",
      action: "WHATSAPP_DISPATCH",
      target: "+15550198822",
      riskLevel: "high",
      requestingActor: "agent:autonomous_sales_rep",
      details: {
        recipient: "+15550198822",
        message: "Hello, your order #7899 has been verified.",
      },
    });
    assert.ok(approvalReq.id);
    assert.ok(approvalReq.payloadDigest);
    assert.equal(approvalReq.status, "pending");

    // 42b: Fetch pending approvals list & stats
    const pendingRes = await fetch(`${baseUrl}/api/v1/approvals/pending`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(pendingRes.status, 200);
    const pendingData = (await pendingRes.json()) as { approvals: any[]; count: number };
    assert.ok(pendingData.approvals.some((a) => a.id === approvalReq.id));

    const statsRes = await fetch(`${baseUrl}/api/v1/approvals/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(statsRes.status, 200);
    const statsData = (await statsRes.json()) as { stats: any };
    assert.ok(statsData.stats.pending >= 1);

    // 42c: Fetch detailed approval record
    const detailRes = await fetch(`${baseUrl}/api/v1/approvals/${approvalReq.id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(detailRes.status, 200);
    const detailData = (await detailRes.json()) as { approval: any };
    assert.equal(detailData.approval.target, "+15550198822");

    // 42d: Approve request
    const approveRes = await fetch(`${baseUrl}/api/v1/approvals/${approvalReq.id}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ notes: "Verified lead dispatch authorized by manager." }),
    });
    assert.equal(approveRes.status, 200);
    const approveData = (await approveRes.json()) as { approval: any; decision: any };
    assert.equal(approveData.approval.status, "approved");
    assert.ok(approveData.decision);
    assert.equal(approveData.decision.decision, "approved");

    // 42e: Double approval must fail
    const doubleApproveRes = await fetch(`${baseUrl}/api/v1/approvals/${approvalReq.id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(doubleApproveRes.status, 400);

    // 42f: Create second request and reject it
    const req2 = await ApprovalPolicyEngine.createApproval({
      userId: testUserId,
      workspaceId: testWorkspaceId,
      actionTitle: "Purge Inactive Records",
      actionType: "destructive_operation",
      action: "DATABASE_PURGE",
      target: "inactive_leads_table",
      riskLevel: "critical",
      details: { table: "inactive_leads", count: 420 },
    });

    const rejectRes = await fetch(`${baseUrl}/api/v1/approvals/${req2.id}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ reason: "Purge window closed. Postponed to maintenance window." }),
    });
    assert.equal(rejectRes.status, 200);
    const rejectData = (await rejectRes.json()) as { approval: any; decision: any };
    assert.equal(rejectData.approval.status, "rejected");
    assert.equal(rejectData.decision.decision, "rejected");
  });

  test("43. Activity Timeline & Audit Log: Durable Event Ingestion, Filtering & Pagination (/api/v1/activity)", async () => {
    await ensureTestAuth();
    // 43a: Log structured audit events via API
    const logRes1 = await fetch(`${baseUrl}/api/v1/activity/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        category: "browser",
        actorType: "workflow",
        sourceModule: "automation",
        actionName: "browser.dom_navigate",
        outcome: "success",
        message: "Browser navigated to https://example.com/checkout and collected DOM schema",
        metadata: { url: "https://example.com/checkout", statusCode: 200, apiKey: "secret_12345" },
      }),
    });
    assert.equal(logRes1.status, 201);
    const logData1 = (await logRes1.json()) as { event: any };
    assert.equal(logData1.event.category, "browser");
    // Verify secret was redacted
    assert.equal(logData1.event.metadata.apiKey, "[REDACTED]");

    const logRes2 = await fetch(`${baseUrl}/api/v1/activity/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        category: "agents",
        actorType: "agent",
        sourceModule: "coding",
        actionName: "coding.solution_generate",
        outcome: "success",
        message: "AI Coding Agent synthesized algorithm solution in Python 3.13",
        metadata: { language: "python", durationMs: 450 },
      }),
    });
    assert.equal(logRes2.status, 201);

    // 43b: Query stats
    const statsRes = await fetch(`${baseUrl}/api/v1/activity/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(statsRes.status, 200);
    const statsData = (await statsRes.json()) as { stats: any };
    assert.ok(statsData.stats.total >= 2);
    assert.ok(statsData.stats.byCategory.browser >= 1);
    assert.ok(statsData.stats.byCategory.agents >= 1);

    // 43c: Filter by category
    const catRes = await fetch(`${baseUrl}/api/v1/activity?category=browser`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(catRes.status, 200);
    const catData = (await catRes.json()) as { events: any[] };
    assert.ok(catData.events.every((e) => e.category === "browser"));

    // 43d: Search query filter
    const searchRes = await fetch(`${baseUrl}/api/v1/activity?search=synthesized`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(searchRes.status, 200);
    const searchData = (await searchRes.json()) as { events: any[] };
    assert.ok(searchData.events.length >= 1);
    assert.ok(searchData.events[0].message.includes("synthesized"));

    // 43e: Cursor pagination
    const page1Res = await fetch(`${baseUrl}/api/v1/activity?limit=1`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(page1Res.status, 200);
    const page1Data = (await page1Res.json()) as { events: any[]; nextCursor: string | null };
    assert.equal(page1Data.events.length, 1);
    assert.ok(page1Data.nextCursor);

    // Page 2 using cursor
    const page2Res = await fetch(`${baseUrl}/api/v1/activity?limit=1&cursor=${page1Data.nextCursor}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(page2Res.status, 200);
    const page2Data = (await page2Res.json()) as { events: any[] };
    assert.equal(page2Data.events.length, 1);
    assert.notEqual(page1Data.events[0].id, page2Data.events[0].id);

    // 43f: Get event details
    const eventDetailRes = await fetch(`${baseUrl}/api/v1/activity/${page1Data.events[0].id}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(eventDetailRes.status, 200);
    const eventDetailData = (await eventDetailRes.json()) as { event: any };
    assert.equal(eventDetailData.event.id, page1Data.events[0].id);
  });

  test("44. Settings Center: Complete 12-Section Persistence, Profile, Password, AI Testing & Diagnostics (/api/v1/settings)", async () => {
    await ensureTestAuth();

    // 44a: GET /api/v1/settings returns consolidated settings with user profile & Ollama status
    const getRes = await fetch(`${baseUrl}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { settings: any };
    assert.ok(getData.settings);
    assert.ok(getData.settings.user);
    assert.equal(getData.settings.user.id, testUserId);
    assert.equal(typeof getData.settings.isOllamaOnline, "boolean");
    assert.equal(typeof getData.settings.hasOpenAiKey, "boolean");

    // 44b: PATCH /api/v1/settings bulk updates settings across modules
    const patchPayload = {
      theme: "midnight",
      accentColor: "cyan",
      density: "compact",
      language: "es",
      timezone: "America/New_York",
      defaultSearchEngine: "duckduckgo",
      autonomyMode: "restricted_autonomous",
      maxExecutionDuration: 450,
      maxRetries: 4,
      similarityThreshold: 0.82,
      memoryRetentionDays: 180,
      researchDepth: "deep",
      requireWriteApproval: true,
      passiveReadAutoAuth: true,
      whatsappNumber: "+14155552671",
      emailSmtpHost: "mail.nexus.cloud",
      openAiApiKey: "sk-test-secret-never-expose",
    };

    const patchRes = await fetch(`${baseUrl}/api/v1/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(patchPayload),
    });
    assert.equal(patchRes.status, 200);
    const patchData = (await patchRes.json()) as { success: boolean; updatedKeys: string[] };
    assert.equal(patchData.success, true);
    assert.ok(patchData.updatedKeys.includes("theme"));
    assert.ok(patchData.updatedKeys.includes("autonomyMode"));

    // 44c: Verify reload persistence and secret redaction
    const reloadRes = await fetch(`${baseUrl}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(reloadRes.status, 200);
    const reloadData = (await reloadRes.json()) as { settings: any };
    assert.equal(reloadData.settings.theme, "midnight");
    assert.equal(reloadData.settings.language, "es");
    assert.equal(reloadData.settings.timezone, "America/New_York");
    assert.equal(reloadData.settings.defaultSearchEngine, "duckduckgo");
    assert.equal(reloadData.settings.autonomyMode, "restricted_autonomous");
    assert.equal(reloadData.settings.maxExecutionDuration, 450);
    assert.equal(reloadData.settings.maxRetries, 4);
    assert.equal(reloadData.settings.similarityThreshold, 0.82);
    assert.equal(reloadData.settings.memoryRetentionDays, 180);
    assert.equal(reloadData.settings.researchDepth, "deep");
    assert.equal(reloadData.settings.whatsappNumber, "+14155552671");
    // Secret MUST be redacted to bullet points
    assert.equal(reloadData.settings.openAiApiKey, "••••••••••••••••");

    // 44d: Profile management (GET & PATCH /api/v1/settings/profile)
    const profileRes = await fetch(`${baseUrl}/api/v1/settings/profile`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(profileRes.status, 200);
    const profileData = (await profileRes.json()) as { user: any };
    assert.equal(profileData.user.id, testUserId);

    const updateProfileRes = await fetch(`${baseUrl}/api/v1/settings/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: "Chief Principal Architect",
        avatar: "https://nexus.local/avatars/principal.png",
      }),
    });
    assert.equal(updateProfileRes.status, 200);
    const updatedProfileData = (await updateProfileRes.json()) as { user: any };
    assert.equal(updatedProfileData.user.name, "Chief Principal Architect");
    assert.equal(updatedProfileData.user.avatar, "https://nexus.local/avatars/principal.png");

    // 44e: Password Change validation & verification (POST /api/v1/settings/password)
    // 1. Wrong current password fails with 400 INVALID_PASSWORD
    const wrongPassRes = await fetch(`${baseUrl}/api/v1/settings/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        currentPassword: "wrongcurrentpassword",
        newPassword: "brandnewsecurepassword456",
      }),
    });
    assert.equal(wrongPassRes.status, 400);

    // 2. Correct current password succeeds
    const correctPassRes = await fetch(`${baseUrl}/api/v1/settings/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        currentPassword: "securepassword123",
        newPassword: "brandnewsecurepassword456",
      }),
    });
    assert.equal(correctPassRes.status, 200);

    // 3. Verify user can log in with new password
    const testUserObj = await prisma.user.findUnique({ where: { id: testUserId } });
    assert.ok(testUserObj);
    const reLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUserObj.email,
        password: "brandnewsecurepassword456",
      }),
    });
    assert.equal(reLoginRes.status, 200);
    const reLoginData = (await reLoginRes.json()) as { token: string };
    assert.ok(reLoginData.token);
    // Update active token
    authToken = reLoginData.token;

    // 44f: AI Provider Connection Test (POST /api/v1/settings/ai-providers/test)
    const testAiRes = await fetch(`${baseUrl}/api/v1/settings/ai-providers/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: "qwen3:8b",
      }),
    });
    assert.equal(testAiRes.status, 200);
    const testAiData = (await testAiRes.json()) as { success: boolean; status: string; latencyMs: number };
    assert.ok(["connected", "unavailable", "degraded"].includes(testAiData.status));
    assert.equal(typeof testAiData.latencyMs, "number");

    // 44g: Messages / WhatsApp Gateway & SMTP Test (POST /api/v1/settings/messages/test)
    // 1. Invalid phone format rejected
    const badPhoneRes = await fetch(`${baseUrl}/api/v1/settings/messages/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        provider: "whatsapp",
        recipient: "not-a-phone-number",
      }),
    });
    assert.equal(badPhoneRes.status, 200);
    const badPhoneData = (await badPhoneRes.json()) as { success: boolean; status: string };
    assert.equal(badPhoneData.success, false);
    assert.equal(badPhoneData.status, "failed");

    // 2. Valid E.164 phone accepted
    const goodPhoneRes = await fetch(`${baseUrl}/api/v1/settings/messages/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        provider: "whatsapp",
        recipient: "+14155552671",
      }),
    });
    assert.equal(goodPhoneRes.status, 200);
    const goodPhoneData = (await goodPhoneRes.json()) as { success: boolean; status: string };
    assert.equal(goodPhoneData.success, true);
    assert.equal(goodPhoneData.status, "connected");

    // 3. SMTP probe test
    const smtpRes = await fetch(`${baseUrl}/api/v1/settings/messages/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        provider: "email",
        smtpHost: "mail.nexus.cloud",
        smtpPort: 587,
      }),
    });
    assert.equal(smtpRes.status, 200);
    const smtpData = (await smtpRes.json()) as { success: boolean; status: string };
    assert.equal(smtpData.success, true);
    assert.equal(smtpData.status, "connected");

    // 44h: Integrations listing and verification (GET & POST /api/v1/settings/integrations)
    const intRes = await fetch(`${baseUrl}/api/v1/settings/integrations`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(intRes.status, 200);
    const intData = (await intRes.json()) as { integrations: any[] };
    assert.ok(intData.integrations.length >= 5);

    const verifyDbRes = await fetch(`${baseUrl}/api/v1/settings/integrations/database/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(verifyDbRes.status, 200);
    const verifyDbData = (await verifyDbRes.json()) as { integration: any };
    assert.equal(verifyDbData.integration.status, "connected");

    // 44i: Operational Diagnostics (GET & POST /api/v1/settings/diagnostics)
    const diagRes = await fetch(`${baseUrl}/api/v1/settings/diagnostics`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(diagRes.status, 200);
    const diagData = (await diagRes.json()) as { diagnostics: any };
    assert.ok(["healthy", "degraded", "unavailable"].includes(diagData.diagnostics.overall));
    assert.equal(diagData.diagnostics.checks.database.status, "healthy");
    assert.ok(diagData.diagnostics.checks.database.latencyMs >= 0);

    // Trigger on-demand probe
    const runDiagRes = await fetch(`${baseUrl}/api/v1/settings/diagnostics/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(runDiagRes.status, 200);
    const runDiagData = (await runDiagRes.json()) as { diagnostics: any };
    assert.ok(runDiagData.diagnostics.checks.websocket.status, "healthy");
    assert.ok(runDiagData.diagnostics.checks.sandbox.status, "healthy");
  });
});



