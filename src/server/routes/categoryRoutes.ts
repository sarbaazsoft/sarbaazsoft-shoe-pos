import { Router } from 'express';
import type { Response } from 'express';
import { pgClient } from '../../db/index.ts';
import { requireAuth } from '../auth.ts';
import type { AuthenticatedRequest as AuthRequest } from '../auth.ts';
import { STANDARD_FOOTWEAR_CATEGORIES } from '../../utils/footwear.ts';

const router = Router();

// ==========================================
// CATEGORIES ROUTES (/api/categories)
// Categories are global for every store (no tenant_id)
// ==========================================

// Ensure categories table exists without tenant_id and is seeded with pre-saved footwear categories
async function ensureGlobalCategoriesTable(): Promise<void> {
  await pgClient
    .exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_unique_idx ON categories (LOWER(BTRIM(name)));
    `)
    .catch(() => {});

  // Pre-saved categories are global for every store: Men, Women, Kids, Toddler, Infant
  for (const stdCat of STANDARD_FOOTWEAR_CATEGORIES) {
    await pgClient
      .query(
        `INSERT INTO categories (name)
         SELECT $1
         WHERE NOT EXISTS (
           SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         )`,
        [stdCat]
      )
      .catch(() => {});
  }
}

// GET /api/categories - Fetch global pre-saved categories for all stores
router.get('/categories', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    await ensureGlobalCategoriesTable();

    const result = await pgClient.query<any>(
      `SELECT DISTINCT ON (LOWER(TRIM(name))) id, name, created_at FROM categories
       ORDER BY LOWER(TRIM(name)), id ASC`
    );

    // Order strictly: Men, Women, Kids, Toddler, Infant first, then other categories
    const orderMap: Record<string, number> = {
      men: 1,
      women: 2,
      kids: 3,
      toddler: 4,
      infant: 5,
    };

    const sorted = result.rows.sort((a, b) => {
      const aRank = orderMap[a.name.trim().toLowerCase()] || 99;
      const bRank = orderMap[b.name.trim().toLowerCase()] || 99;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

    res.json({ categories: sorted });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch categories: ' + err.message });
  }
});

export default router;
