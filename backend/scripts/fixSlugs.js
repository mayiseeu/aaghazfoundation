/**
 * fixSlugs.js — Clean malformed slugs in the BlogPosts table.
 *
 * Fixes three classes of bad slugs introduced during the WordPress import:
 *
 *  1. Leading slash:           "/my-post"           → "my-post"
 *  2. CMS variable leak:       "slug: my-post"      → "my-post"
 *  3. Date prefix in slug:     "2025-05-05-my-post" → "my-post"
 *     (the date already lives in createdAt and appears in the URL path)
 *
 * Usage:
 *   node scripts/fixSlugs.js           # dry-run — safe, read-only preview
 *   node scripts/fixSlugs.js --apply   # write changes to DB
 */

const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN = !process.argv.includes("--apply");

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
};

// ---------------------------------------------------------------------------
// Pure slug-cleaning logic
// ---------------------------------------------------------------------------

/**
 * Returns the cleaned slug, or null if no change is needed.
 */
function cleanSlug(raw) {
  let slug = raw.trim();

  // 1. Strip "slug: " / "slug:" prefix (unresolved CMS template variable)
  const cmsVarMatch = slug.match(/^\/?slug\s*:\s*(.+)$/i);
  if (cmsVarMatch) {
    slug = cmsVarMatch[1].trim();
  }

  // 2. Strip YYYY-MM-DD- date prefix baked into the slug
  //    e.g. "2025-05-05-my-post-title" → "my-post-title"
  const datePrefixMatch = slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  if (datePrefixMatch) {
    slug = datePrefixMatch[1].trim();
  }

  // 3. Strip leading slashes and lowercase
  slug = slug.replace(/^\/+/, "").trim().toLowerCase();

  return slug === raw.trim().toLowerCase() ? null : slug;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nSlug Cleanup Script");
  console.log("===================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (pass --apply to write changes)" : "APPLYING CHANGES"}\n`);

  const conn = await mysql.createConnection(DB_CONFIG);

  try {
    const [rows] = await conn.execute(
      "SELECT id, slug, createdAt FROM BlogPosts ORDER BY createdAt ASC"
    );
    console.log(`Found ${rows.length} posts.\n`);

    const toFix = [];

    for (const row of rows) {
      const fixed = cleanSlug(row.slug);
      if (fixed !== null) {
        const date = new Date(row.createdAt).toISOString().split("T")[0];
        toFix.push({ id: row.id, oldSlug: row.slug, newSlug: fixed, date });
      }
    }

    if (toFix.length === 0) {
      console.log("No malformed slugs found. Nothing to do.");
      return;
    }

    console.log(`Found ${toFix.length} slug(s) to fix:\n`);
    for (const item of toFix) {
      console.log(`  ID ${item.id}  [${item.date}]`);
      console.log(`    BEFORE: ${item.oldSlug}`);
      console.log(`    AFTER:  ${item.newSlug}\n`);
    }

    if (DRY_RUN) {
      console.log("Dry run complete. No changes written.");
      console.log("Run with --apply to commit these changes.\n");
      return;
    }

    // Apply changes
    let updated = 0;
    let skipped = 0;

    for (const item of toFix) {
      // Guard against slug collisions before updating
      const [existing] = await conn.execute(
        "SELECT id FROM BlogPosts WHERE slug = ? AND id != ?",
        [item.newSlug, item.id]
      );

      if (existing.length > 0) {
        console.log(
          `  ⚠️  SKIP ID ${item.id}: target slug "${item.newSlug}" already exists (ID ${existing[0].id})`
        );
        skipped++;
        continue;
      }

      await conn.execute(
        "UPDATE BlogPosts SET slug = ?, updatedAt = NOW() WHERE id = ?",
        [item.newSlug, item.id]
      );
      console.log(`  ✓  ID ${item.id}: "${item.oldSlug}" → "${item.newSlug}"`);
      updated++;
    }

    console.log(`\nDone. Updated: ${updated}, Skipped (collision): ${skipped}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
