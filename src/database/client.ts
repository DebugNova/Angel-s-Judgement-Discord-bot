import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Lazily-created singleton Prisma client. The database is the single source of truth. */
export function db(): PrismaClient {
  client ??= new PrismaClient({ log: ['warn', 'error'] });
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
