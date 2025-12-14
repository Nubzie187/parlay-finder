import { GameLog, Leg, ConfidenceLevel } from './types';

// Thresholds for different stat types (sorted ascending for lower threshold priority)
// Using safer alt-line style thresholds
export const STAT_THRESHOLDS = {
  pass_yards: [150, 175, 200, 225],
  rush_yards: [25, 40, 50, 60],
  rec_yards: [25, 40, 50, 60],
  receptions: [2, 3, 4, 5],
  pass_tds: [1],
} as const;

/**
 * Normalize game log stat keys to expected format
 * Maps alternate stat keys to standard ones and ensures missing stats default to 0
 */
export function normalizeGameLog(gameLog: any): GameLog {
  const normalized: any = { ...gameLog };

  // Map alternate stat keys to expected ones
  const statMappings: Record<string, string> = {
    passing_yards: 'pass_yards',
    rushing_yards: 'rush_yards',
    receiving_yards: 'rec_yards',
    rec: 'receptions',
    passing_tds: 'pass_tds',
    pass_td: 'pass_tds',
  };

  // Apply mappings: prefer standard key if both exist, otherwise copy alternate to standard
  for (const [altKey, standardKey] of Object.entries(statMappings)) {
    if (altKey in normalized) {
      // If standard key doesn't exist or is null/undefined, use alternate key value
      if (!(standardKey in normalized) || normalized[standardKey] === null || normalized[standardKey] === undefined) {
        normalized[standardKey] = normalized[altKey];
      }
      // Keep both keys for debugging purposes
    }
  }

  // Ensure all expected stat fields exist and default to 0 if missing
  const expectedStatFields: (keyof typeof STAT_THRESHOLDS)[] = [
    'pass_yards',
    'rush_yards',
    'rec_yards',
    'receptions',
    'pass_tds',
  ];

  for (const field of expectedStatFields) {
    if (normalized[field] === undefined || normalized[field] === null) {
      normalized[field] = 0;
    }
  }

  return normalized as GameLog;
}

/**
 * Normalize an array of game logs
 */
export function normalizeGameLogs(gameLogs: any[]): GameLog[] {
  return gameLogs.map(normalizeGameLog);
}

export type StatType = keyof typeof STAT_THRESHOLDS;

// Default filters
const DEFAULT_MIN_PROBABILITY = 0.80;
const DEFAULT_MIN_SAMPLE_SIZE = 6;
const DEFAULT_MIN_TOUCHES_PER_GAME = 5;

/**
 * Calculate standard deviation for consistency metric
 */
function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate average touches/targets per game for a player
 * For RBs: rush_attempts + receptions (or estimate from rush_yards if attempts not available)
 * For WRs/TEs: targets (if available) or receptions
 * For QBs: not applicable (return high value to pass filter)
 */
function calculateAverageTouchesPerGame(gameLogs: GameLog[]): number {
  if (gameLogs.length === 0) return 0;

  const position = gameLogs[0]?.position?.toUpperCase();
  
  // For QBs, we don't filter by touches, so return a high value
  if (position === 'QB') {
    return 100; // High value to pass the filter
  }

  let totalTouches = 0;
  let gamesWithData = 0;

  for (const log of gameLogs) {
    let touches = 0;

    if (position === 'RB') {
      // For RBs: rush attempts + receptions
      if (log.rush_attempts !== undefined && log.rush_attempts !== null) {
        touches += log.rush_attempts;
      } else if (log.rush_yards !== undefined && log.rush_yards !== null) {
        // Estimate: assume ~4.5 yards per carry average, so touches ≈ rush_yards / 4.5
        touches += Math.round((log.rush_yards || 0) / 4.5);
      }
      touches += log.receptions || 0;
    } else if (position === 'WR' || position === 'TE') {
      // For WRs/TEs: targets (if available) or receptions as proxy
      if (log.targets !== undefined && log.targets !== null) {
        touches = log.targets;
      } else {
        touches = log.receptions || 0;
      }
    }

    if (touches > 0) {
      totalTouches += touches;
      gamesWithData++;
    }
  }

  return gamesWithData > 0 ? totalTouches / gamesWithData : 0;
}

/**
 * Check if a stat type has sufficient data in game logs
 * Returns true if at least 4 of the game logs have numeric values for this stat
 */
function hasSufficientStatData(gameLogs: GameLog[], statType: StatType, minCount: number = 4): boolean {
  if (gameLogs.length === 0) {
    return false;
  }

  const statValues = gameLogs
    .map((log) => log[statType] as number | undefined)
    .filter((val): val is number => val !== undefined && val !== null && !isNaN(val));

  return statValues.length >= minCount;
}

// Beta-Binomial smoothing parameters (defaults)
const DEFAULT_BETA_A = 4;
const DEFAULT_BETA_B = 2;

// Confidence band thresholds based on smoothedProb
const CONFIDENCE_THRESHOLDS = {
  Elite: 0.85,   // >= 0.85
  Strong: 0.75,  // >= 0.75 and < 0.85
  Fair: 0.65,    // >= 0.65 and < 0.75
  Speculative: 0.0, // < 0.65
} as const;

/**
 * Determine confidence level based on smoothed probability
 */
export function getConfidenceLevel(smoothedProb: number): ConfidenceLevel {
  if (smoothedProb >= CONFIDENCE_THRESHOLDS.Elite) {
    return 'Elite';
  } else if (smoothedProb >= CONFIDENCE_THRESHOLDS.Strong) {
    return 'Strong';
  } else if (smoothedProb >= CONFIDENCE_THRESHOLDS.Fair) {
    return 'Fair';
  } else {
    return 'Speculative';
  }
}

/**
 * Calculate raw and Beta-Binomial smoothed probability
 * Raw: P = count(stat >= threshold) / N
 * Smoothed: P = (k + a) / (n + a + b) where k = successes, n = sample size
 */
function calculateProbability(
  gameLogs: GameLog[],
  statType: StatType,
  threshold: number,
  betaA: number = DEFAULT_BETA_A,
  betaB: number = DEFAULT_BETA_B
): { 
  rawProb: number; 
  smoothedProb: number; 
  sampleSize: number; 
  lastNGameValues: number[]; 
  consistency: number 
} {
  if (gameLogs.length === 0) {
    return { 
      rawProb: 0, 
      smoothedProb: 0, 
      sampleSize: 0, 
      lastNGameValues: [], 
      consistency: 0 
    };
  }

  const statValues = gameLogs
    .map((log) => log[statType] as number | undefined)
    .filter((val): val is number => val !== undefined && val !== null);

  if (statValues.length === 0) {
    return { 
      rawProb: 0, 
      smoothedProb: 0, 
      sampleSize: 0, 
      lastNGameValues: [], 
      consistency: 0 
    };
  }

  const sampleSize = statValues.length;
  const countAboveThreshold = statValues.filter((val) => val >= threshold).length;
  
  // Raw probability: k/n (for display/debug only)
  const rawProb = countAboveThreshold / sampleSize;
  
  // Beta-Binomial smoothed probability: (k + a) / (n + a + b) (used for filtering, sorting, calculations)
  const smoothedProb = (countAboveThreshold + betaA) / (sampleSize + betaA + betaB);
  
  const consistency = calculateStandardDeviation(statValues);

  return {
    rawProb,
    smoothedProb,
    sampleSize,
    lastNGameValues: statValues,
    consistency,
  };
}

/**
 * Generate reason text for a leg explaining hit rate, average vs threshold, and recent outcome
 * Returns 1-2 sentence explanation
 * Uses raw probability for hit rate display
 */
function generateLegReason(
  statType: StatType,
  threshold: number,
  rawProbability: number, // Use raw probability for hit rate
  sampleSize: number,
  lastNGameValues: number[],
  mostRecentValue: number
): string {
  const hitRate = Math.round(rawProbability * 100);
  const average = lastNGameValues.reduce((sum, val) => sum + val, 0) / lastNGameValues.length;
  const avgDiff = average - threshold;
  const recentHit = mostRecentValue >= threshold;

  // Format stat type for display
  const statDisplay = statType.replace(/_/g, ' ');

  // Build concise reason text (1-2 sentences)
  const avgText = avgDiff >= 0 
    ? `${Math.round(avgDiff)} above` 
    : `${Math.abs(Math.round(avgDiff))} below`;
  
  const recentText = recentHit ? 'hit' : 'missed';
  
  return `Hit ${hitRate}% over last ${sampleSize} games, averaging ${Math.round(average)} ${statDisplay} (${avgText} threshold). Most recent: ${Math.round(mostRecentValue)} ${statDisplay} (${recentText}).`;
}

/**
 * Generate legs for a player based on their game logs
 * Returns legs sorted by probability desc, then consistency (std dev) asc
 */
export function generateLegs(
  playerId: string,
  playerName: string | undefined,
  gameLogs: GameLog[],
  lastN: number = gameLogs.length,
  minProbability: number = DEFAULT_MIN_PROBABILITY,
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  minTouchesPerGame: number = DEFAULT_MIN_TOUCHES_PER_GAME
): Leg[] {
  // Get the last N games, sorted by date (most recent first)
  const sortedLogs = [...gameLogs]
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())
    .slice(0, lastN);

  // Filter out players with insufficient touches/targets per game
  const avgTouchesPerGame = calculateAverageTouchesPerGame(sortedLogs);
  if (avgTouchesPerGame < minTouchesPerGame) {
    return [];
  }

  const legs: Leg[] = [];

  // Generate legs for each stat type, prioritizing lower thresholds first
  for (const [statType, thresholds] of Object.entries(STAT_THRESHOLDS)) {
    const typedStatType = statType as StatType;

    // Skip stat types that don't have sufficient data (at least 4 numeric values)
    if (!hasSufficientStatData(sortedLogs, typedStatType, 4)) {
      continue;
    }

    // Process thresholds in ascending order (lower first)
    // Only include the lowest threshold that meets the probability requirement
    for (const threshold of thresholds) {
      const { rawProb, smoothedProb, sampleSize, lastNGameValues, consistency } = calculateProbability(
        sortedLogs,
        typedStatType,
        threshold
      );

      // Apply filters (use smoothed probability for filtering)
      if (
        sampleSize >= minSampleSize &&
        smoothedProb >= minProbability &&
        lastNGameValues.length > 0
      ) {
        // Get game context from the most recent game log
        const mostRecentLog = sortedLogs[0];
        const mostRecentValue = lastNGameValues[0]; // First value is most recent (sorted desc)
        
        // Generate reason text (use raw probability for display in reason)
        const reason = generateLegReason(
          typedStatType,
          threshold,
          rawProb, // Use raw probability for reason text (display only)
          sampleSize,
          lastNGameValues,
          mostRecentValue
        );

        legs.push({
          playerId,
          playerName,
          statType: typedStatType,
          threshold,
          smoothedProb, // Use smoothed probability for all calculations
          rawProb, // For display/debug only
          confidence: getConfidenceLevel(smoothedProb),
          sampleSize,
          lastNGameValues,
          consistency,
          reason,
          gameId: mostRecentLog.gameId,
          gameDate: mostRecentLog.gameDate,
          team: mostRecentLog.team,
          opponent: mostRecentLog.opponent,
          position: mostRecentLog.position,
        });

        // Prioritize lower thresholds: if this threshold meets the requirement,
        // skip higher thresholds for this stat type
        break;
      }
    }
  }

  // Sort by smoothedProb desc, then consistency (std dev) asc (lower std dev = more consistent)
  legs.sort((a, b) => {
    if (b.smoothedProb !== a.smoothedProb) {
      return b.smoothedProb - a.smoothedProb;
    }
    const consistencyA = a.consistency || 0;
    const consistencyB = b.consistency || 0;
    return consistencyA - consistencyB; // Ascending: lower std dev = better
  });

  return legs;
}

/**
 * Generate legs for multiple players
 * Note: This function assumes gameLogsByPlayerId already contains only active players
 * Use filterActivePlayers() before calling this function
 */
export function generateLegsForPlayers(
  players: Array<{ id: string; name?: string }>,
  gameLogsByPlayerId: Record<string, GameLog[]>,
  lastN?: number,
  minProbability: number = DEFAULT_MIN_PROBABILITY,
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  minTouchesPerGame: number = DEFAULT_MIN_TOUCHES_PER_GAME
): Leg[] {
  const allLegs: Leg[] = [];

  for (const player of players) {
    const playerGameLogs = gameLogsByPlayerId[player.id] || [];
    const legs = generateLegs(
      player.id,
      player.name,
      playerGameLogs,
      lastN,
      minProbability,
      minSampleSize,
      minTouchesPerGame
    );
    allLegs.push(...legs);
  }

  // Sort all legs by smoothedProb desc, then consistency (std dev) asc
  allLegs.sort((a, b) => {
    if (b.smoothedProb !== a.smoothedProb) {
      return b.smoothedProb - a.smoothedProb;
    }
    const consistencyA = a.consistency || 0;
    const consistencyB = b.consistency || 0;
    return consistencyA - consistencyB; // Ascending: lower std dev = better
  });

  return allLegs;
}

