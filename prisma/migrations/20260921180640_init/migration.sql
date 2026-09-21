-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('ONE_V_ONE', 'TEAM', 'DIVISION', 'TOURNAMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'ACCEPTED', 'ACTIVE', 'RESULT_PENDING', 'DISPUTED', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('NONE', 'PLAYER_REPORTED', 'CONFIRMED', 'DISPUTED', 'STAFF_DECIDED');

-- CreateEnum
CREATE TYPE "ResolutionMethod" AS ENUM ('PLAYER_CONFIRMATION', 'REFEREE_DECISION', 'FORCE_COMPLETE');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateEnum
CREATE TYPE "EloChangeReason" AS ENUM ('MATCH', 'RESET', 'ADMIN');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL,
    "matchCategoryId" TEXT,
    "historyChannelId" TEXT,
    "leaderboardChannelId" TEXT,
    "leaderboardMessageId" TEXT,
    "logChannelId" TEXT,
    "staffChannelId" TEXT,
    "refereeRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moderatorRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startingElo" INTEGER NOT NULL DEFAULT 1000,
    "kFactor" INTEGER NOT NULL DEFAULT 32,
    "minElo" INTEGER NOT NULL DEFAULT 0,
    "maxElo" INTEGER NOT NULL DEFAULT 5000,
    "challengeTimeoutSec" INTEGER NOT NULL DEFAULT 60,
    "pairCooldownSec" INTEGER NOT NULL DEFAULT 60,
    "globalCooldownSec" INTEGER NOT NULL DEFAULT 0,
    "challengeCommandCooldownSec" INTEGER NOT NULL DEFAULT 10,
    "maxIncomingChallenges" INTEGER NOT NULL DEFAULT 3,
    "minLeaderboardMatches" INTEGER NOT NULL DEFAULT 5,
    "maxLeaderboardSize" INTEGER NOT NULL DEFAULT 30,
    "maxActiveMatches" INTEGER NOT NULL DEFAULT 40,
    "channelPrefix" TEXT NOT NULL DEFAULT 'queue',
    "matchIdPrefix" TEXT NOT NULL DEFAULT 'SA',
    "autoDeleteChannels" BOOLEAN NOT NULL DEFAULT true,
    "autoDeleteDelaySec" INTEGER NOT NULL DEFAULT 600,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "stickyPanel" BOOLEAN NOT NULL DEFAULT true,
    "matchCounter" INTEGER NOT NULL DEFAULT 0,
    "useEmojis" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "activeSeasonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "elo" INTEGER NOT NULL,
    "highestElo" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
    "highestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "bannedBy" TEXT,
    "currentMatchId" TEXT,
    "statsResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gameMode" "GameMode" NOT NULL DEFAULT 'ONE_V_ONE',
    "challengerId" TEXT NOT NULL,
    "challengedId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "channelId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameMode" "GameMode" NOT NULL DEFAULT 'ONE_V_ONE',
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "resultStatus" "ResultStatus" NOT NULL DEFAULT 'NONE',
    "resolutionMethod" "ResolutionMethod",
    "challengeId" TEXT,
    "challengerId" TEXT NOT NULL,
    "opponentId" TEXT NOT NULL,
    "winnerId" TEXT,
    "loserId" TEXT,
    "refereeDiscordId" TEXT,
    "decisionReason" TEXT,
    "cancelRequestedById" TEXT,
    "cancelledByDiscordId" TEXT,
    "cancelReason" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "categoryId" TEXT,
    "panelMessageId" TEXT,
    "serverLink" TEXT,
    "serverLinkById" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidenceRequestedAt" TIMESTAMP(3),
    "seasonId" TEXT,
    "divisionId" TEXT,
    "teamId" TEXT,
    "tournamentId" TEXT,
    "round" INTEGER,
    "bracketPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "cleanupAt" TIMESTAMP(3),
    "channelDeletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "team" INTEGER NOT NULL,
    "outcome" "Outcome",

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "reportedWinnerId" TEXT,
    "reportedByDiscordId" TEXT,
    "confirmedWinnerId" TEXT,
    "confirmedByDiscordId" TEXT,
    "status" "ResultStatus" NOT NULL DEFAULT 'NONE',
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "matchId" TEXT,
    "seasonId" TEXT,
    "reason" "EloChangeReason" NOT NULL DEFAULT 'MATCH',
    "oldElo" INTEGER NOT NULL,
    "newElo" INTEGER NOT NULL,
    "eloChange" INTEGER NOT NULL,
    "opponentElo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "submittedByDiscordId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attachmentUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchNote" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooldown" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooldown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "matchId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Player_guildId_elo_idx" ON "Player"("guildId", "elo");

-- CreateIndex
CREATE INDEX "Player_guildId_isBanned_matchesPlayed_idx" ON "Player"("guildId", "isBanned", "matchesPlayed");

-- CreateIndex
CREATE INDEX "Player_currentMatchId_idx" ON "Player"("currentMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_guildId_discordId_key" ON "Player"("guildId", "discordId");

-- CreateIndex
CREATE INDEX "Season_guildId_status_idx" ON "Season"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Season_guildId_number_key" ON "Season"("guildId", "number");

-- CreateIndex
CREATE INDEX "Challenge_guildId_status_idx" ON "Challenge"("guildId", "status");

-- CreateIndex
CREATE INDEX "Challenge_status_expiresAt_idx" ON "Challenge"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Challenge_challengerId_status_idx" ON "Challenge"("challengerId", "status");

-- CreateIndex
CREATE INDEX "Challenge_challengedId_status_idx" ON "Challenge"("challengedId", "status");

-- CreateIndex
CREATE INDEX "Challenge_guildId_pairKey_status_idx" ON "Challenge"("guildId", "pairKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Match_challengeId_key" ON "Match"("challengeId");

-- CreateIndex
CREATE INDEX "Match_guildId_status_idx" ON "Match"("guildId", "status");

-- CreateIndex
CREATE INDEX "Match_channelId_idx" ON "Match"("channelId");

-- CreateIndex
CREATE INDEX "Match_winnerId_idx" ON "Match"("winnerId");

-- CreateIndex
CREATE INDEX "Match_loserId_idx" ON "Match"("loserId");

-- CreateIndex
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");

-- CreateIndex
CREATE INDEX "Match_seasonId_idx" ON "Match"("seasonId");

-- CreateIndex
CREATE INDEX "Match_cleanupAt_idx" ON "Match"("cleanupAt");

-- CreateIndex
CREATE INDEX "Match_guildId_completedAt_idx" ON "Match"("guildId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_guildId_matchId_key" ON "Match"("guildId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_guildId_matchNumber_key" ON "Match"("guildId", "matchNumber");

-- CreateIndex
CREATE INDEX "MatchParticipant_playerId_idx" ON "MatchParticipant"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_playerId_key" ON "MatchParticipant"("matchId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");

-- CreateIndex
CREATE INDEX "EloHistory_playerId_createdAt_idx" ON "EloHistory"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "EloHistory_matchId_idx" ON "EloHistory"("matchId");

-- CreateIndex
CREATE INDEX "EloHistory_guildId_createdAt_idx" ON "EloHistory"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_matchId_idx" ON "Evidence"("matchId");

-- CreateIndex
CREATE INDEX "MatchNote_matchId_idx" ON "MatchNote"("matchId");

-- CreateIndex
CREATE INDEX "Cooldown_expiresAt_idx" ON "Cooldown"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cooldown_guildId_key_key" ON "Cooldown"("guildId", "key");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_action_idx" ON "AuditLog"("guildId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_matchId_idx" ON "AuditLog"("matchId");

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_challengedId_fkey" FOREIGN KEY ("challengedId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_reportedWinnerId_fkey" FOREIGN KEY ("reportedWinnerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_confirmedWinnerId_fkey" FOREIGN KEY ("confirmedWinnerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloHistory" ADD CONSTRAINT "EloHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloHistory" ADD CONSTRAINT "EloHistory_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EloHistory" ADD CONSTRAINT "EloHistory_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchNote" ADD CONSTRAINT "MatchNote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
