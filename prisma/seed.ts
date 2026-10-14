import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Initializing clean production-grade environment for NEXUS BROWSER (Zero Mock Data)...");

  // Ensure default primary user exists
  const passwordHash = await bcrypt.hash("nexus123", 10);
  const user = await prisma.user.upsert({
    where: { email: "cheralathan@nexus.ai" },
    update: {},
    create: {
      email: "cheralathan@nexus.ai",
      name: "Cheralathan",
      passwordHash,
    },
  });
  console.log(`User verified: ${user.email} (ID: ${user.id})`);

  // Ensure Primary Workspace exists
  let workspace = await prisma.workspace.findFirst({
    where: { userId: user.id, name: "Primary Workspace" },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        userId: user.id,
        name: "Primary Workspace",
        description: "Personal intelligence workspace, live research, and active web sessions.",
        settings: {
          theme: "dark",
          defaultSearchEngine: "duckduckgo",
          autoSummarize: true,
        },
      },
    });
    console.log(`Workspace ready: ${workspace.name} (ID: ${workspace.id})`);
  }

  // Purge any legacy demo user and demo workspace so 100% real data is enforced
  await prisma.user.deleteMany({
    where: { email: "demo@nexus.local" },
  }).catch(() => {});

  console.log("Database initialized cleanly. ZERO mock records seeded. Ready for live user operations.");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
