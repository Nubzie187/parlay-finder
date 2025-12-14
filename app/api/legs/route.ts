import { NextRequest, NextResponse } from 'next/server';
import { generateLegs, STAT_THRESHOLDS, normalizeGameLogs, normalizeGameLog } from '@/lib/prob';
import { GameLog, Leg } from '@/lib/types';
import { filterActivePlayers, isPlayerActive } from '@/lib/player-filter';
import { getCurrentWeekData } from '@/lib/week';
import { loadGameLogs, loadGameLogsForRange } from '@/lib/loadGameLogs';

/**
 * Get example schema for gamelogs
 */
function getExampleSchema() {
  return {
    description: 'Array of game log objects',
    example: [
      {
        playerId: "string (required)",
        playerName: "string (optional)",
        gameDate: "string (YYYY-MM-DD, required)",
        gameId: "string (optional)",
        week: "number (1-18, optional)",
        season: "number (optional)",
        team: "string (optional)",
        opponent: "string (optional)",
        position: "string (QB, RB, WR, TE, etc., optional)",
        snaps: "number (optional)",
        pass_yards: "number (optional)",
        rush_yards: "number (optional)",
        rec_yards: "number (optional)",
        receptions: "number (optional)",
        pass_tds: "number (optional)",
      }
    ],
    note: "Include at least 6 games per player for reliable probability calculations"
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const playerId = searchParams.get('playerId');
    const playerName = searchParams.get('playerName') || undefined;
    const lastN = searchParams.get('lastN') 
      ? parseInt(searchParams.get('lastN')!, 10) 
      : undefined;
    const weekParam = searchParams.get('week');
    const seasonParam = searchParams.get('season');
    const minProbParam = searchParams.get('minProb');
    const positionsParam = searchParams.get('positions');

    // Get current week if not provided (default to 2024 season, week 1)
    let currentWeek: number;
    let season: number;
    if (weekParam && seasonParam) {
      currentWeek = parseInt(weekParam, 10);
      season = parseInt(seasonParam, 10);
    } else {
      const weekData = getCurrentWeekData();
      currentWeek = weekData.week || 1;
      season = weekData.season || 2024;
    }

    // Check for debug mode
    const debugMode = searchParams.get('debug') === '1';

    // Load gamelogs - strategy depends on mode
    let rawGameLogs: any[] = [];
    let loadResult: {
      filePathUsed: string;
      fileExists: boolean;
      parseError?: string;
    } | null = null;
    let loadError: any = null;
    let dataSource: 'cache' | 'remote' | 'sample' = 'sample';
    let effectiveSeason = season;
    let effectiveWeek = currentWeek;

    // Allow override via query param (for testing/future use)
    const gamelogsParam = searchParams.get('gamelogs');
    
    if (gamelogsParam) {
      // Use provided gamelogs JSON
      try {
        rawGameLogs = JSON.parse(gamelogsParam);
        loadError = null;
      } catch (e) {
        return NextResponse.json(
          { error: 'Invalid gamelogs JSON in query parameter' },
          { status: 400 }
        );
      }
    } else {
      // Load gamelogs - in bulk mode (no playerId), try to load for current week
      // In single player mode, use sample data as fallback
      try {
        if (!playerId) {
          // Bulk mode: load gamelogs for current week (will fallback to sample if cache doesn't exist)
          const result = await loadGameLogs(season, currentWeek);
          rawGameLogs = result.gameLogs as any[];
          loadResult = {
            filePathUsed: result.filePathUsed,
            fileExists: result.fileExists,
            parseError: result.parseError,
          };
          // Determine data source based on file path
          // If it's from cache directory and exists, it's cached remote data
          // If it's from sample file, it's sample data
          // Otherwise, it might be from a remote fetch (but loadGameLogs doesn't fetch, so it's sample)
          if (result.filePathUsed.includes('cache') && result.fileExists && !result.filePathUsed.includes('gamelogs.sample.json')) {
            dataSource = 'cache';
          } else if (result.filePathUsed.includes('gamelogs.sample.json')) {
            dataSource = 'sample';
          } else {
            // If cache file doesn't exist, we'd need to fetch, but loadGameLogs doesn't do that
            // So this would be sample data
            dataSource = 'sample';
          }
          effectiveSeason = season;
          effectiveWeek = currentWeek;
        } else {
          // Single player mode: use sample data (or cached data if available)
          const result = await loadGameLogs(season, currentWeek);
          rawGameLogs = result.gameLogs as any[];
          loadResult = {
            filePathUsed: result.filePathUsed,
            fileExists: result.fileExists,
            parseError: result.parseError,
          };
          // Determine data source based on file path
          if (result.filePathUsed.includes('cache') && result.fileExists && !result.filePathUsed.includes('gamelogs.sample.json')) {
            dataSource = 'cache';
          } else if (result.filePathUsed.includes('gamelogs.sample.json')) {
            dataSource = 'sample';
          } else {
            dataSource = 'sample';
          }
          effectiveSeason = season;
          effectiveWeek = currentWeek;
        }
      } catch (error) {
        loadError = error;
        loadResult = {
          filePathUsed: (error as any).filePathUsed || 'unknown',
          fileExists: (error as any).fileExists || false,
          parseError: (error as any).parseError || (error instanceof Error ? error.message : String(error)),
        };
        
        // In bulk mode, return error if we can't load gamelogs
        if (!playerId) {
          return NextResponse.json(
            {
              error: (loadError as any).error || 'Failed to load gamelogs',
              filePathUsed: loadResult?.filePathUsed || 'unknown',
              fileExists: loadResult?.fileExists || false,
              parseError: loadResult?.parseError,
              message: (loadError as any).message || `Unable to load gamelogs for ${season} week ${currentWeek}. Please ensure data is cached via /api/gamelogs or data/gamelogs.sample.json exists.`,
            },
            { status: 500 }
          );
        }
        // In single player mode, we'll handle the error later
      }
    }

    // Normalize game logs (map alternate stat keys and default missing stats to 0)
    const gameLogs: GameLog[] = normalizeGameLogs(rawGameLogs);

    // Check if gamelogs are available
    if (!gameLogs || gameLogs.length === 0) {
      const errorMessage = !playerId 
        ? `No gamelogs available for ${season} week ${currentWeek}. Please ensure data is cached via /api/gamelogs or data/gamelogs.sample.json exists.`
        : 'No gamelogs available after normalization. Please ensure data/gamelogs.sample.json contains valid game log data.';
      
      return NextResponse.json(
        {
          error: 'No gamelogs available after normalization.',
          message: errorMessage,
        },
        { status: 400 }
      );
    }

    // Store raw game logs for debug mode (before filtering)
    const rawGameLogsForDebug = [...rawGameLogs];

    // Filter to only active players for current week
    const activeGameLogs = filterActivePlayers(gameLogs, currentWeek, season);

    // MODE 1: Single player mode (playerId provided)
    if (playerId) {
      const lastNValue = lastN || 8;
      const minSampleSize = 4; // Default minimum sample size
      
      // For "last N games", we need to load a range of weeks
      // Load weeks from (currentWeek - lastN*2) to currentWeek to ensure we have enough data
      const startWeek = Math.max(1, currentWeek - lastNValue * 2);
      const endWeek = currentWeek;
      
      // Load gamelogs for the range of weeks
      let rangeGameLogs: GameLog[] = [];
      if (startWeek < endWeek) {
        try {
          const rangeResult = await loadGameLogsForRange(season, startWeek, endWeek);
          rangeGameLogs = normalizeGameLogs(rangeResult.gameLogs);
        } catch (error) {
          // If range loading fails, fall back to single week
          console.warn('Failed to load range of weeks, using single week:', error);
          rangeGameLogs = activeGameLogs;
        }
      } else {
        // If startWeek == endWeek, just use the already loaded activeGameLogs
        rangeGameLogs = activeGameLogs;
      }

      // Filter to only games <= currentWeek (in case we loaded future weeks)
      const gamesUpToWeek = rangeGameLogs.filter(log => {
        if (log.week === undefined || log.week === null) {
          // If week is missing, include it (might be from sample data)
          return true;
        }
        return log.week <= currentWeek && log.season === season;
      });

      // Filter gamelogs for the specific player
      const playerAllGameLogs = gamesUpToWeek.filter(
        (log: GameLog) => log.playerId === playerId
      );

      // Check if player is active
      const playerStatus = isPlayerActive(gameLogs, playerId, currentWeek, season);
      
      if (!playerStatus.isActive) {
        return NextResponse.json(
          { 
            error: `Player ${playerId} is not active for week ${currentWeek}`,
            status: playerStatus,
          },
          { status: 400 }
        );
      }

      if (playerAllGameLogs.length === 0) {
        return NextResponse.json(
          { error: `No gamelogs found for playerId: ${playerId}` },
          { status: 404 }
        );
      }

      // Sort by date (most recent first), then by week desc as fallback
      const sortedLogs = [...playerAllGameLogs].sort((a, b) => {
        // First try to sort by gameDate
        if (a.gameDate && b.gameDate) {
          const dateA = new Date(a.gameDate).getTime();
          const dateB = new Date(b.gameDate).getTime();
          if (dateB !== dateA) {
            return dateB - dateA; // Most recent first
          }
        }
        // Fallback to week
        const weekA = a.week ?? 0;
        const weekB = b.week ?? 0;
        return weekB - weekA; // Most recent week first
      });

      // Take the last N games (most recent N)
      const playerGameLogs = sortedLogs.slice(0, lastNValue);

      // Only include player if they have at least minSampleSize games
      if (playerGameLogs.length < minSampleSize) {
        return NextResponse.json(
          { 
            error: `Player ${playerId} has insufficient games (${playerGameLogs.length} < ${minSampleSize})`,
            gamesFound: playerGameLogs.length,
            minRequired: minSampleSize,
          },
          { status: 400 }
        );
      }

      // Generate legs for single player
      const legs = generateLegs(
        playerId, 
        playerName, 
        playerGameLogs, 
        playerGameLogs.length, // Use actual count, not lastNValue
        undefined, // Use default minProbability
        minSampleSize // Use minSampleSize (default 4)
      );

      return NextResponse.json({
        playerId,
        playerName,
        lastN: playerGameLogs.length, // Return actual count used
        week: currentWeek,
        season,
        legs,
      });
    }

    // MODE 2: Bulk mode (playerId NOT provided) - generate legs for all active players
    const minProb = minProbParam ? parseFloat(minProbParam) : 0.70;
    const lastNValue = lastN || 8;
    const minSampleSize = 4; // Default minimum sample size
    
    // Parse positions filter (comma-separated list)
    const positionsFilter = positionsParam 
      ? positionsParam.split(',').map(p => p.trim().toUpperCase())
      : undefined;

    // For "last N games", we need to load a range of weeks
    // Load weeks from (currentWeek - lastN*2) to currentWeek to ensure we have enough data
    // Then for each player, select their most recent N games <= currentWeek
    const startWeek = Math.max(1, currentWeek - lastNValue * 2);
    const endWeek = currentWeek;
    
    // Load gamelogs for the range of weeks
    let rangeGameLogs: GameLog[] = [];
    if (startWeek < endWeek) {
      try {
        const rangeResult = await loadGameLogsForRange(season, startWeek, endWeek);
        rangeGameLogs = normalizeGameLogs(rangeResult.gameLogs);
      } catch (error) {
        // If range loading fails, fall back to single week
        console.warn('Failed to load range of weeks, using single week:', error);
        rangeGameLogs = activeGameLogs;
      }
    } else {
      // If startWeek == endWeek, just use the already loaded activeGameLogs
      rangeGameLogs = activeGameLogs;
    }

    // Filter to only games <= currentWeek (in case we loaded future weeks)
    const gamesUpToWeek = rangeGameLogs.filter(log => {
      if (log.week === undefined || log.week === null) {
        // If week is missing, include it (might be from sample data)
        return true;
      }
      return log.week <= currentWeek && log.season === season;
    });

    // Get unique players and their game logs
    const playerMap = new Map<string, { name?: string; position?: string; gameLogs: GameLog[] }>();
    
    for (const log of gamesUpToWeek) {
      if (!log.playerId) continue;
      
      if (!playerMap.has(log.playerId)) {
        playerMap.set(log.playerId, {
          name: log.playerName,
          position: log.position,
          gameLogs: [],
        });
      }
      playerMap.get(log.playerId)!.gameLogs.push(log);
    }

    // For each player, select their most recent N games <= currentWeek
    // Sort by date (most recent first), then take first N
    const playerMapWithLastN = new Map<string, { name?: string; position?: string; gameLogs: GameLog[] }>();
    
    for (const [playerId, playerData] of playerMap.entries()) {
      // Sort by date (most recent first), then by week desc as fallback
      const sortedLogs = [...playerData.gameLogs].sort((a, b) => {
        // First try to sort by gameDate
        if (a.gameDate && b.gameDate) {
          const dateA = new Date(a.gameDate).getTime();
          const dateB = new Date(b.gameDate).getTime();
          if (dateB !== dateA) {
            return dateB - dateA; // Most recent first
          }
        }
        // Fallback to week
        const weekA = a.week ?? 0;
        const weekB = b.week ?? 0;
        return weekB - weekA; // Most recent week first
      });

      // Take the last N games (most recent N)
      const lastNGames = sortedLogs.slice(0, lastNValue);

      // Only include player if they have at least minSampleSize games
      if (lastNGames.length >= minSampleSize) {
        playerMapWithLastN.set(playerId, {
          name: playerData.name,
          position: playerData.position,
          gameLogs: lastNGames,
        });
      }
    }

    // Generate legs for all active players (with minProb filter)
    const allLegs: Leg[] = [];
    
    // Generate all legs without minProb filter (for near misses and debug)
    const allLegsUnfiltered: Leg[] = [];
    
    for (const [pid, playerData] of playerMapWithLastN.entries()) {
      // Filter by positions if specified
      if (positionsFilter && playerData.position) {
        if (!positionsFilter.includes(playerData.position.toUpperCase())) {
          continue;
        }
      }

      // Use the actual number of games available (may be less than lastNValue)
      const actualGameCount = playerData.gameLogs.length;

      // Generate legs with minProb filter (for actual results)
      const playerLegs = generateLegs(
        pid,
        playerData.name,
        playerData.gameLogs,
        actualGameCount, // Use actual count, not lastNValue
        minProb,
        minSampleSize // Use minSampleSize (default 4)
      );
      allLegs.push(...playerLegs);

      // Generate legs without minProb filter (for near misses and debug)
      const playerLegsUnfiltered = generateLegs(
        pid,
        playerData.name,
        playerData.gameLogs,
        actualGameCount, // Use actual count, not lastNValue
        0, // No minProb filter
        minSampleSize // Use minSampleSize (default 4)
      );
      allLegsUnfiltered.push(...playerLegsUnfiltered);
    }

    // For debug: get top candidates (even if below minProb)
    let topCandidates: Array<{ playerId: string; playerName?: string; position?: string; statType: string; threshold: number; probability: number; sampleSize: number }> = [];
    if (debugMode) {
      // Sort all legs by smoothedProb desc, then take top 10
      const sortedAllLegs = [...allLegsUnfiltered].sort((a, b) => b.smoothedProb - a.smoothedProb);
      topCandidates = sortedAllLegs.slice(0, 10).map(leg => ({
        playerId: leg.playerId,
        playerName: leg.playerName,
        position: leg.position,
        statType: leg.statType,
        threshold: leg.threshold,
        smoothedProb: leg.smoothedProb,
        rawProb: leg.rawProb, // For display/debug only
        sampleSize: leg.sampleSize,
      }));
    }

    // Filter by minProb (using smoothed probability)
    const filteredLegs = allLegs.filter(leg => leg.smoothedProb >= minProb);

    // Format response with required fields
    const formattedLegs = filteredLegs.map(leg => ({
      playerId: leg.playerId,
      playerName: leg.playerName,
      position: leg.position,
      team: leg.team,
      gameId: leg.gameId,
      statType: leg.statType,
      threshold: leg.threshold,
      smoothedProb: leg.smoothedProb, // Used for filtering, sorting, and calculations
      rawProb: leg.rawProb, // For display/debug only
      confidence: leg.confidence, // Confidence band label
      sampleSize: leg.sampleSize,
      lastNValues: leg.lastNGameValues,
    }));

    const response: any = {
      legs: formattedLegs,
    };

    // Always return near misses (top 20 below threshold) when they exist
    const legsBelowThreshold = allLegsUnfiltered
      .filter(leg => leg.smoothedProb < minProb)
      .sort((a, b) => b.smoothedProb - a.smoothedProb)
      .slice(0, 20);

    if (legsBelowThreshold.length > 0) {
      response.nearMisses = legsBelowThreshold.map(leg => ({
        playerId: leg.playerId,
        playerName: leg.playerName,
        position: leg.position,
        team: leg.team,
        gameId: leg.gameId,
        statType: leg.statType,
        threshold: leg.threshold,
        smoothedProb: leg.smoothedProb,
        rawProb: leg.rawProb, // For display/debug only
        confidence: leg.confidence, // Confidence band label
        sampleSize: leg.sampleSize,
      }));
    }

    // Add message if no legs found
    if (formattedLegs.length === 0) {
      response.message = `No legs found with probability >= ${minProb}. Consider lowering minProb to see available options.`;
      
      // Add detailed debug information when no legs found and debug mode is enabled
      if (debugMode) {
        // Calculate games per player stats (for players that passed position filter)
        const gamesPerPlayer: number[] = [];
        for (const [pid, playerData] of playerMapWithLastN.entries()) {
          // Filter by positions if specified
          if (positionsFilter && playerData.position) {
            if (!positionsFilter.includes(playerData.position.toUpperCase())) {
              continue;
            }
          }
          gamesPerPlayer.push(playerData.gameLogs.length);
        }
        
        // Calculate median properly
        let median = 0;
        if (gamesPerPlayer.length > 0) {
          const sorted = [...gamesPerPlayer].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          median = sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
        }
        
        const gamesPerPlayerStats = gamesPerPlayer.length > 0 ? {
          min: Math.min(...gamesPerPlayer),
          median,
          max: Math.max(...gamesPerPlayer),
        } : { min: 0, median: 0, max: 0 };

        // Get sample rows (first 1-2 gamelog rows after filtering)
        const sampleRows = activeGameLogs.slice(0, 2).map(log => {
          const sample: any = {};
          // Show all keys in the log
          Object.keys(log).forEach(key => {
            sample[key] = (log as any)[key];
          });
          return sample;
        });

        // Calculate stat availability (counts of rows with numeric values)
        const statAvailability = {
          pass_yards: activeGameLogs.filter(log => typeof log.pass_yards === 'number' && !isNaN(log.pass_yards)).length,
          rush_yards: activeGameLogs.filter(log => typeof log.rush_yards === 'number' && !isNaN(log.rush_yards)).length,
          rec_yards: activeGameLogs.filter(log => typeof log.rec_yards === 'number' && !isNaN(log.rec_yards)).length,
          receptions: activeGameLogs.filter(log => typeof log.receptions === 'number' && !isNaN(log.receptions)).length,
          pass_tds: activeGameLogs.filter(log => typeof log.pass_tds === 'number' && !isNaN(log.pass_tds)).length,
        };

        // Get top 20 candidates BEFORE applying minProb filter
        const topCandidatesBeforeFilter = allLegsUnfiltered
          .sort((a, b) => b.smoothedProb - a.smoothedProb)
          .slice(0, 20)
          .map(leg => ({
            playerId: leg.playerId,
            playerName: leg.playerName,
            position: leg.position,
            statType: leg.statType,
            threshold: leg.threshold,
            smoothedProb: leg.smoothedProb,
            rawProb: leg.rawProb,
            sampleSize: leg.sampleSize,
          }));

        response.debug = {
          season,
          week: currentWeek,
          effectiveSeason,
          effectiveWeek,
          dataSource,
          lastN: lastNValue,
          minProb,
          totalGameLogsAfterFilters: gamesUpToWeek.length,
          uniquePlayersAfterFilters: playerMapWithLastN.size,
          gamesPerPlayerStats,
          sampleRow: sampleRows,
          statAvailability,
          topCandidates: topCandidatesBeforeFilter,
        };
      }
    }

    // Add debug information if requested (general debug, not just when no legs)
    if (debugMode && formattedLegs.length > 0) {
      // Get 3 sample normalized records for debug
      const sampleNormalizedRecords = activeGameLogs.slice(0, 3).map(log => {
        // Find corresponding raw log by matching key fields
        const original = rawGameLogsForDebug.find(r => 
          r.playerId === log.playerId && 
          (r.gameId === log.gameId || (!r.gameId && !log.gameId)) &&
          (r.week === log.week || (!r.week && !log.week))
        );
        return {
          original: original || null,
          normalized: {
            playerId: log.playerId,
            playerName: log.playerName,
            gameId: log.gameId,
            week: log.week,
            pass_yards: log.pass_yards ?? 0,
            rush_yards: log.rush_yards ?? 0,
            rec_yards: log.rec_yards ?? 0,
            receptions: log.receptions ?? 0,
            pass_tds: log.pass_tds ?? 0,
          },
        };
      });

      response.debug = {
        season,
        week: currentWeek,
        effectiveSeason,
        effectiveWeek,
        dataSource,
        totalGameLogs: activeGameLogs.length,
        uniquePlayers: playerMap.size,
        minProb,
        lastN: lastNValue,
        positions: positionsFilter || null,
        thresholdsUsed: STAT_THRESHOLDS,
        topCandidates,
        sampleNormalizedRecords,
        filePathUsed: loadResult?.filePathUsed || 'unknown',
        fileExists: loadResult?.fileExists ?? false,
        ...(loadResult?.parseError && { parseError: loadResult.parseError }),
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error generating legs:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, playerName, gameLogs: bodyGameLogs, lastN, week, season } = body;

    if (!playerId) {
      return NextResponse.json(
        { error: 'playerId is required' },
        { status: 400 }
      );
    }

    // Load gamelogs from file (default) or use provided in body (optional override)
    let rawGameLogs: any[] = [];
    
    if (bodyGameLogs && Array.isArray(bodyGameLogs) && bodyGameLogs.length > 0) {
      rawGameLogs = bodyGameLogs;
    } else {
      // Try to load from file
      try {
        const result = await loadGameLogs();
        rawGameLogs = result.gameLogs as any[];
      } catch (error) {
        const loadError = error as any;
        return NextResponse.json(
          {
            error: loadError.error || 'Failed to load gamelogs',
            filePathUsed: loadError.filePathUsed || 'unknown',
            fileExists: loadError.fileExists || false,
            parseError: loadError.parseError,
            message: loadError.message || 'Please ensure data/gamelogs.sample.json exists and contains valid game log data, or provide gamelogs in the request body.',
          },
          { status: 500 }
        );
      }
    }

    // Normalize game logs (map alternate stat keys and default missing stats to 0)
    const gameLogs: GameLog[] = normalizeGameLogs(rawGameLogs);

    if (!gameLogs || gameLogs.length === 0) {
      return NextResponse.json(
        {
          error: 'No gamelogs available after normalization.',
          message: 'Please provide valid game log data.',
        },
        { status: 400 }
      );
    }

    // Get current week if not provided
    let currentWeek: number;
    let currentSeason: number;
    if (week && season) {
      currentWeek = week;
      currentSeason = season;
    } else {
      const weekData = getCurrentWeekData();
      currentWeek = weekData.week;
      currentSeason = weekData.season;
    }

    // Filter to only active players for current week
    const activeGameLogs = filterActivePlayers(gameLogs, currentWeek, currentSeason);

    // Filter gamelogs for the specific player
    const playerGameLogs = activeGameLogs.filter(
      (log: GameLog) => log.playerId === playerId
    );

    // Check if player is active
    const playerStatus = isPlayerActive(gameLogs, playerId, currentWeek, currentSeason);
    
    if (!playerStatus.isActive) {
      return NextResponse.json(
        { 
          error: `Player ${playerId} is not active for week ${currentWeek}`,
          status: playerStatus,
        },
        { status: 400 }
      );
    }

    if (playerGameLogs.length === 0) {
      return NextResponse.json(
        { error: `No gamelogs found for playerId: ${playerId}` },
        { status: 404 }
      );
    }

    // Generate legs
    const legs = generateLegs(playerId, playerName, playerGameLogs, lastN);

    return NextResponse.json({
      playerId,
      playerName,
      lastN: lastN || playerGameLogs.length,
      week: currentWeek,
      season: currentSeason,
      legs,
    }, { status: 200 });
  } catch (error) {
    console.error('Error generating legs:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

