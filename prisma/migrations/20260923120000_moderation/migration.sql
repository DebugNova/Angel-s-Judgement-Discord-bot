-- Moderation: new settings and a table of numbered moderation cases. Nothing existing is changed.
ALTER TABLE "GuildConfig" ADD COLUMN "moderationRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GuildConfig" ADD COLUMN "modLogChannelId" TEXT;
ALTER TABLE "GuildConfig" ADD COLUMN "modDmMembers" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildConfig" ADD COLUMN "modCaseCounter" INTEGER NOT NULL DEFAULT 0;

-- The Seven Angels server: only the "z" role may moderate. (Servers the bot joins later start
-- with no moderation role; the owner picks one with /config roles level:moderation.)
UPDATE "GuildConfig" SET "moderationRoleIds" = ARRAY['1544431253204504776']::TEXT[];

CREATE TABLE "ModCase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetName" TEXT,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "durationSec" INTEGER,
    "channelId" TEXT,
    "details" JSONB,
    "dmSent" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModCase_guildId_caseNumber_key" ON "ModCase"("guildId", "caseNumber");
CREATE INDEX "ModCase_guildId_targetId_idx" ON "ModCase"("guildId", "targetId");
