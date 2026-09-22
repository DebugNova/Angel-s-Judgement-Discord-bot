-- Music plays at 100% by default: YouTube's audio is then sent to Discord untouched (best quality).
ALTER TABLE "GuildConfig" ALTER COLUMN "musicVolume" SET DEFAULT 100;
UPDATE "GuildConfig" SET "musicVolume" = 100 WHERE "musicVolume" = 80;
ALTER TABLE "MusicSession" ALTER COLUMN "volume" SET DEFAULT 100;
