import { db, pool } from './client.js';
import { funds, portcos } from './schema.js';

const fundSeed = {
  name: 'DAW Capital',
  slug: 'daw-capital',
};

const portcoSeeds = [
  { code: 'PC1', name: 'Vantage Managed Services', slug: 'vantage-managed-services' },
  { code: 'PC2', name: 'Cascade Care Group', slug: 'cascade-care-group' },
  { code: 'PC3', name: 'Ridgeline Freight & Logistics', slug: 'ridgeline-freight-logistics' },
] as const;

const seed = async () => {
  const [fund] = await db
    .insert(funds)
    .values(fundSeed)
    .onConflictDoUpdate({ target: funds.slug, set: { name: fundSeed.name } })
    .returning({ id: funds.id });

  if (!fund) {
    throw new Error('Unable to seed DAW Capital');
  }

  for (const portco of portcoSeeds) {
    await db
      .insert(portcos)
      .values({ ...portco, fundId: fund.id })
      .onConflictDoUpdate({
        target: [portcos.fundId, portcos.code],
        set: { name: portco.name, slug: portco.slug },
      });
  }

  console.log(`Seeded fund ${fundSeed.name} and ${portcoSeeds.length} portcos.`);
};

try {
  await seed();
} finally {
  await pool.end();
}
