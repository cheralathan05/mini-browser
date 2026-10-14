import { prisma } from '../backend/src/config/db.js';

async function check() {
  const dbInfo = await prisma.$queryRawUnsafe(`SELECT datname, pg_encoding_to_char(encoding) as encoding, datcollate, datctype FROM pg_database WHERE datname = 'nexus_db'`);
  console.log('Database info:', dbInfo);
  const clientEnc = await prisma.$queryRawUnsafe(`SHOW client_encoding`);
  console.log('Client encoding:', clientEnc);
  const serverEnc = await prisma.$queryRawUnsafe(`SHOW server_encoding`);
  console.log('Server encoding:', serverEnc);
  process.exit(0);
}

check().catch(console.error);
