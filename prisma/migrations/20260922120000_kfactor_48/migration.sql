-- Raise the default rating swing from 32 to 48 (1.5x more volatile).
ALTER TABLE "GuildConfig" ALTER COLUMN "kFactor" SET DEFAULT 48;

-- Servers still on the old default move to the new one. Custom values are left alone.
UPDATE "GuildConfig" SET "kFactor" = 48 WHERE "kFactor" = 32;
