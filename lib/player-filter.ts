import { GameLog, PlayerStatus } from './types';

/**
 * Get bye weeks for teams in a given week
 * This would typically come from NFL schedule data
 * For now, we'll check if a team has no game in that week
 */
function getByeWeekTeams(
  gameLogs: GameLog[],
  week: number,
  season: number
): Set<string> {
  const byeWeekTeams = new Set<string>();
  const teamsWithGames = new Set<string>();

  // Find all teams that have games in this week
  for (const log of gameLogs) {
    if (log.week === week && log.season === season && log.team) {
      teamsWithGames.add(log.team);
    }
  }

  // Find all unique teams
  const allTeams = new Set<string>();
  for (const log of gameLogs) {
    if (log.team) {
      allTeams.add(log.team);
    }
  }

  // Teams without games in this week are on bye
  for (const team of allTeams) {
    if (!teamsWithGames.has(team)) {
      byeWeekTeams.add(team);
    }
  }

  return byeWeekTeams;
}

/**
 * Check if player has snaps in the last N games
 */
function hasSnapsInLastNGames(
  gameLogs: GameLog[],
  playerId: string,
  n: number = 2
): boolean {
  // Sort by date (most recent first)
  const sortedLogs = [...gameLogs]
    .filter((log) => log.playerId === playerId)
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())
    .slice(0, n);

  if (sortedLogs.length < n) {
    return false; // Not enough games
  }

  // Check if player has snaps in all of the last N games
  return sortedLogs.every((log) => {
    const snaps = log.snaps;
    return snaps !== undefined && snaps !== null && snaps > 0;
  });
}

/**
 * Check if player is active for the current week
 * A player is active if:
 * 1. They have a game in the current week (not on bye)
 * 2. They have snaps in the last 2 games
 */
export function isPlayerActive(
  gameLogs: GameLog[],
  playerId: string,
  currentWeek: number,
  season: number
): PlayerStatus {
  const playerLogs = gameLogs.filter((log) => log.playerId === playerId);
  
  if (playerLogs.length === 0) {
    return {
      playerId,
      isActive: false,
      isOnBye: false,
      hasRecentSnaps: false,
      currentWeek,
    };
  }

  const team = playerLogs[0]?.team;
  const byeWeekTeams = getByeWeekTeams(gameLogs, currentWeek, season);
  const isOnBye = team ? byeWeekTeams.has(team) : false;
  const hasRecentSnaps = hasSnapsInLastNGames(gameLogs, playerId, 2);

  // Player is active if not on bye and has recent snaps
  const isActive = !isOnBye && hasRecentSnaps;

  return {
    playerId,
    team,
    isActive,
    isOnBye,
    hasRecentSnaps,
    currentWeek,
  };
}

/**
 * Filter game logs to only include active players for the current week
 */
export function filterActivePlayers(
  gameLogs: GameLog[],
  currentWeek: number,
  season: number
): GameLog[] {
  // Get unique player IDs
  const playerIds = new Set<string>();
  for (const log of gameLogs) {
    if (log.playerId) {
      playerIds.add(log.playerId);
    }
  }

  // Filter to only active players
  const activePlayerIds = new Set<string>();
  for (const playerId of playerIds) {
    const status = isPlayerActive(gameLogs, playerId, currentWeek, season);
    if (status.isActive) {
      activePlayerIds.add(playerId);
    }
  }

  // Return only game logs for active players
  return gameLogs.filter((log) => activePlayerIds.has(log.playerId));
}

/**
 * Get player statuses for multiple players
 */
export function getPlayerStatuses(
  gameLogs: GameLog[],
  playerIds: string[],
  currentWeek: number,
  season: number
): PlayerStatus[] {
  return playerIds.map((playerId) =>
    isPlayerActive(gameLogs, playerId, currentWeek, season)
  );
}

