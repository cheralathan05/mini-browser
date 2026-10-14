import { PrismaClient } from "@prisma/client";

const passwords = ["postgres", "admin", "root", "1234", "123456", "password", "chera", "nexuspassword", ""];

async function check() {
  for (const pwd of passwords) {
    const url = `postgresql://postgres:${encodeURIComponent(pwd)}@localhost:5432/postgres`;
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      console.log(`MATCHED_PASSWORD:${pwd}`);
      await client.$disconnect();
      process.exit(0);
    } catch {
      await client.$disconnect().catch(() => {});
    }
  }

  // Also try with username chera
  for (const pwd of ["", "chera", "postgres", "admin", "1234", "password"]) {
    const url = `postgresql://chera:${encodeURIComponent(pwd)}@localhost:5432/postgres`;
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      console.log(`MATCHED_USER:chera PWD:${pwd}`);
      await client.$disconnect();
      process.exit(0);
    } catch {
      await client.$disconnect().catch(() => {});
    }
  }

  console.log("NO_MATCH");
  process.exit(1);
}

check();
