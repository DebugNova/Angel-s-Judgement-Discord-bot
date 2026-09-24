-- Raise the default rating swing from 48 to 120 (an even duel moves 60 points instead of 24).
ALTER TABLE "GuildConfig" ALTER COLUMN "kFactor" SET DEFAULT 120;

-- Servers still on the old default move to the new one. Custom values are left alone.
UPDATE "GuildConfig" SET "kFactor" = 120 WHERE "kFactor" = 48;
