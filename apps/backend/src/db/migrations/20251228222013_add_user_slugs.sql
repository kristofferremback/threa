-- =============================================================================
-- Add User Slugs: Human-readable identifiers for @mentions
-- =============================================================================
-- Slugs enable markdown-based mentions: @kristoffer, @erik
-- Generation: lowercase name, spaces to hyphens, remove special chars
-- Collision handling: append number suffix (kristoffer-2, kristoffer-3)

-- Step 1: Add nullable slug column
ALTER TABLE users ADD COLUMN slug TEXT;

-- Step 2: Generate slugs for existing users
-- Uses a CTE to handle collisions by appending row number when duplicates exist
WITH base_slugs AS (
    SELECT
        id,
        LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9 -]', '', 'g'), '\s+', '-', 'g')) AS base_slug
    FROM users
),
numbered_slugs AS (
    SELECT
        id,
        base_slug,
        ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY id) AS dup_num
    FROM base_slugs
)
UPDATE users
SET slug = CASE
    WHEN ns.dup_num = 1 THEN ns.base_slug
    ELSE ns.base_slug || '-' || ns.dup_num
END
FROM numbered_slugs ns
WHERE users.id = ns.id;

-- Step 3: Make slug NOT NULL and add unique constraint
ALTER TABLE users ALTER COLUMN slug SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_slug_unique UNIQUE (slug);

-- Step 4: Add index for efficient slug lookups
CREATE INDEX idx_users_slug ON users (slug);
