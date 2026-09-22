-- Music: new settings and two new tables. Nothing existing is changed.
ALTER TABLE "GuildConfig" ADD COLUMN "musicDjRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GuildConfig" ADD COLUMN "musicVolume" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "GuildConfig" ADD COLUMN "music247" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MusicSession" (
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "textChannelId" TEXT,
    "queue" JSONB NOT NULL,
    "positionSec" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "volume" INTEGER NOT NULL DEFAULT 80,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicSession_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "MusicPlaylist" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tracks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicPlaylist_guildId_ownerId_name_key" ON "MusicPlaylist"("guildId", "ownerId", "name");
CREATE INDEX "MusicPlaylist_guildId_ownerId_idx" ON "MusicPlaylist"("guildId", "ownerId");
