import { prisma } from "./prisma";

/**
 * Integration tests wipe tables, so they refuse to run unless DATABASE_URL
 * names a database whose name contains "test".
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  const name = url ? new URL(url).pathname.slice(1) : "";
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run integration tests against database "${name || "(unset)"}"; point DATABASE_URL at a database whose name contains "test".`,
    );
  }
}

export async function resetTestDatabase(): Promise<void> {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "WebhookDelivery", "ReviewJob", "PullRequest", "Repository" RESTART IDENTITY CASCADE',
  );
}
