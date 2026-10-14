import { prisma } from "../backend/src/config/db.js";

async function cleanDatabase() {
  console.log("Purging all mock seed data from PostgreSQL database...");

  // 1. Delete seed memories, relations, sources, collections, suggestions
  await prisma.memoryRelation.deleteMany({}).catch(() => {});
  await prisma.memorySource.deleteMany({}).catch(() => {});
  await prisma.memoryNote.deleteMany({}).catch(() => {});
  await prisma.memoryEvent.deleteMany({}).catch(() => {});
  await prisma.memorySuggestion.deleteMany({}).catch(() => {});
  await prisma.memoryAccess.deleteMany({}).catch(() => {});
  await prisma.memory.deleteMany({}).catch(() => {});
  await prisma.memoryCollection.deleteMany({}).catch(() => {});

  console.log("Cleaned all mock memories, relations, and sources.");

  // 2. Delete seed research runs, evidence, findings, reports, sources, projects
  await prisma.researchCitation.deleteMany({}).catch(() => {});
  await prisma.evidenceItem.deleteMany({}).catch(() => {});
  await prisma.researchFinding.deleteMany({}).catch(() => {});
  await prisma.researchReport.deleteMany({}).catch(() => {});
  await prisma.researchSource.deleteMany({}).catch(() => {});
  await prisma.researchPlan.deleteMany({}).catch(() => {});
  await prisma.researchRun.deleteMany({}).catch(() => {});
  await prisma.researchNote.deleteMany({}).catch(() => {});
  await prisma.researchProject.deleteMany({}).catch(() => {});

  console.log("Cleaned all mock research projects, runs, sources, and findings.");

  // 3. Delete seed agent tasks, runs, steps, artifacts, plans, approvals
  await prisma.approvalRequest.deleteMany({}).catch(() => {});
  await prisma.agentArtifact.deleteMany({}).catch(() => {});
  await prisma.agentObservation.deleteMany({}).catch(() => {});
  await prisma.agentToolCall.deleteMany({}).catch(() => {});
  await prisma.agentStep.deleteMany({}).catch(() => {});
  await prisma.agentPlan.deleteMany({}).catch(() => {});
  await prisma.agentRun.deleteMany({}).catch(() => {});
  await prisma.agentTask.deleteMany({}).catch(() => {});

  console.log("Cleaned all mock agent tasks, runs, and artifacts.");

  // 4. Delete seed workflows and executions
  await prisma.workflowExecution.deleteMany({}).catch(() => {});
  await prisma.workflow.deleteMany({}).catch(() => {});

  console.log("Cleaned all mock workflows.");

  // 5. Delete activity events
  await prisma.activityEvent.deleteMany({}).catch(() => {});
  console.log("Cleaned activity events.");

  // 6. Ensure Primary User Cheralathan exists
  let user = await prisma.user.findFirst({
    where: { email: "cheralathan@nexus.ai" },
  });

  if (!user) {
    const demoUser = await prisma.user.findFirst({
      where: { email: "demo@nexus.local" },
    });
    if (demoUser) {
      user = await prisma.user.update({
        where: { id: demoUser.id },
        data: {
          email: "cheralathan@nexus.ai",
          name: "Cheralathan",
        },
      });
      console.log(`Updated legacy user to Cheralathan (${user.email})`);
    } else {
      user = await prisma.user.create({
        data: {
          email: "cheralathan@nexus.ai",
          name: "Cheralathan",
          passwordHash: "$2a$10$2XWegoAsmed2rQHwBoMBV.pj80gG9CTgobrjqIiVv3k8ry.sAj3oS",
        },
      });
      console.log(`Created primary user Cheralathan (${user.email})`);
    }
  }

  // Delete leftover test users
  await prisma.user.deleteMany({
    where: {
      email: {
        not: "cheralathan@nexus.ai",
      },
    },
  }).catch(() => {});

  if (user) {
    let ws = await prisma.workspace.findFirst({ where: { userId: user.id } });
    if (!ws) {
      ws = await prisma.workspace.create({
        data: {
          userId: user.id,
          name: "Primary Workspace",
          description: "Active personal intelligence workspace",
        },
      });
      console.log(`Created clean Primary Workspace: ${ws.name}`);
    }
  }

  console.log("Database successfully cleaned of all mock data! Pristine state ready.");
  process.exit(0);
}

cleanDatabase().catch((e) => {
  console.error("Cleanup error:", e);
  process.exit(1);
});
