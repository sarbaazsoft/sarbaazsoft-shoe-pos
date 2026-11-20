import 'dotenv/config';
import { pgClient, rawPool } from './index.ts';
import { seedDatabaseAndAppSettings } from './schemaInit.ts';

async function main() {
  try {
    await pgClient.waitReady;
    const result = await seedDatabaseAndAppSettings();
    console.log(
      `✅ Seed completed: seed.sql=${result.seedSqlApplied ? 'applied' : 'skipped'}, app_settings=${result.appSettingsCount}`
    );
  } catch (err: any) {
    console.error('❌ Database seed failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    if (rawPool) {
      await rawPool.end().catch(() => {});
    }
  }
}

main();
