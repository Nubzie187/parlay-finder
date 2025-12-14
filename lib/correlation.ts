import { Leg, Parlay, PenaltyBreakdown } from './types';

export interface ParlayOptions {
  minLegs?: number;
  maxLegs?: number;
  maxLegsPerGame?: number;
  maxLegsPerTeam?: number;
  allowSameTeamStack?: boolean;
  legCount?: number; // Specific leg count (2-8), sets both minLegs and maxLegs
  singleGame?: boolean; // Single Game Parlay mode
  gameId?: string; // Required when singleGame=true
  minLegProb?: number; // Minimum leg probability (default 0.80)
  allowSameGame?: boolean; // Allow multiple legs from same game (default false, forced true when singleGame=true)
}

const DEFAULT_OPTIONS: Required<Omit<ParlayOptions, 'legCount' | 'singleGame' | 'gameId'>> = {
  minLegs: 2,
  maxLegs: 4,
  maxLegsPerGame: 1,
  maxLegsPerTeam: 2,
  allowSameTeamStack: false,
};

/**
 * Check if a leg is a QB passing yards leg
 */
function isQBPassingYards(leg: Leg): boolean {
  return leg.statType === 'pass_yards' && leg.position?.toUpperCase() === 'QB';
}

/**
 * Check if a leg is a WR/TE receiving yards leg
 */
function isWRTEReceivingYards(leg: Leg): boolean {
  const position = leg.position?.toUpperCase();
  return leg.statType === 'rec_yards' && (position === 'WR' || position === 'TE');
}

/**
 * Check if two legs violate the same-team stacking rule
 */
function violatesSameTeamStack(leg1: Leg, leg2: Leg, allowSameTeamStack: boolean): boolean {
  if (allowSameTeamStack) {
    return false;
  }

  // Check if both legs are from the same team
  if (!leg1.team || !leg2.team || leg1.team !== leg2.team) {
    return false;
  }

  // Check if one is QB passing yards and the other is WR/TE receiving yards
  const leg1IsQBPass = isQBPassingYards(leg1);
  const leg2IsQBPass = isQBPassingYards(leg2);
  const leg1IsWRTERec = isWRTEReceivingYards(leg1);
  const leg2IsWRTERec = isWRTEReceivingYards(leg2);

  return (
    (leg1IsQBPass && leg2IsWRTERec) ||
    (leg2IsQBPass && leg1IsWRTERec)
  );
}

/**
 * Validate if a parlay candidate meets all constraints
 */
function isValidParlay(
  legs: Leg[],
  legCount: number,
  allowSameGame: boolean,
  allowSameTeamStack: boolean
): boolean {
  // Check leg count (must be exactly legCount)
  if (legs.length !== legCount) {
    return false;
  }

  // Check for duplicate players
  const playerIds = legs.map((leg) => leg.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    return false;
  }

  // Check max legs per game (if allowSameGame=false, max 1 leg per game)
  if (!allowSameGame) {
    const gameCounts = new Map<string, number>();
    for (const leg of legs) {
      const gameKey = leg.gameId || leg.gameDate || 'unknown';
      const count = (gameCounts.get(gameKey) || 0) + 1;
      if (count > 1) {
        return false;
      }
      gameCounts.set(gameKey, count);
    }
  }

  // Check same-team stacking rule
  if (!allowSameTeamStack) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (violatesSameTeamStack(legs[i], legs[j], allowSameTeamStack)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Check if a stat type is a TD prop (depends on team scoring)
 */
function isTDProp(statType: Leg['statType']): boolean {
  return statType === 'pass_tds';
}

/**
 * Check if a stat type is a volume stat (RB/WR volume stats)
 */
function isVolumeStat(statType: Leg['statType'], position?: string): boolean {
  const pos = position?.toUpperCase();
  return (
    (statType === 'rush_yards' && pos === 'RB') ||
    (statType === 'rec_yards' && (pos === 'WR' || pos === 'TE')) ||
    (statType === 'receptions' && (pos === 'WR' || pos === 'TE'))
  );
}

/**
 * Count unique games in a parlay
 */
function countUniqueGames(legs: Leg[]): number {
  const games = new Set<string>();
  for (const leg of legs) {
    const gameKey = leg.gameId || leg.gameDate || 'unknown';
    games.add(gameKey);
  }
  return games.size;
}

/**
 * Count legs that depend on team scoring (TD props from same team)
 */
function countTeamScoringDependencies(legs: Leg[]): Map<string, number> {
  const teamTDCounts = new Map<string, number>();
  for (const leg of legs) {
    if (isTDProp(leg.statType) && leg.team) {
      const count = (teamTDCounts.get(leg.team) || 0) + 1;
      teamTDCounts.set(leg.team, count);
    }
  }
  return teamTDCounts;
}

/**
 * Calculate estimated probability for a parlay (product of leg smoothed probabilities)
 */
function calculateParlayProbability(legs: Leg[]): number {
  return legs.reduce((product, leg) => product * leg.smoothedProb, 1);
}

/**
 * Calculate penalties and breakdown for a parlay
 * Returns adjusted probability and list of applied penalties
 */
export function calculateParlayPenalties(
  legs: Leg[]
): { adjustedProbability: number; penalties: PenaltyBreakdown[] } {
  const baseProbability = calculateParlayProbability(legs);
  const penalties: PenaltyBreakdown[] = [];
  let multiplier = 1.0;

  // Count legs per game
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    const gameKey = leg.gameId || leg.gameDate || 'unknown';
    const count = (gameCounts.get(gameKey) || 0) + 1;
    gameCounts.set(gameKey, count);
  }

  // Penalty: More than 1 leg from same game - multiply by 0.90 for each extra leg
  for (const [gameKey, count] of gameCounts.entries()) {
    if (count > 1) {
      const extraLegs = count - 1;
      const penaltyMultiplier = Math.pow(0.90, extraLegs);
      multiplier *= penaltyMultiplier;
      const penaltyAmount = 1 - penaltyMultiplier;
      penalties.push({
        type: 'same_game',
        amount: penaltyAmount,
        reason: `${count} legs from same game (${gameKey}) - ${(penaltyAmount * 100).toFixed(1)}% penalty`,
      });
    }
  }

  // Count legs per team
  const teamCounts = new Map<string, number>();
  const teamLegs: Array<{ team: string; legs: Leg[] }> = [];
  
  for (const leg of legs) {
    if (leg.team) {
      const count = (teamCounts.get(leg.team) || 0) + 1;
      teamCounts.set(leg.team, count);
      
      if (!teamLegs.find(t => t.team === leg.team)) {
        teamLegs.push({ team: leg.team, legs: [] });
      }
      teamLegs.find(t => t.team === leg.team)!.legs.push(leg);
    }
  }

  // Penalty: More than 1 leg from same team - multiply by 0.95 for each extra leg
  for (const [team, count] of teamCounts.entries()) {
    if (count > 1) {
      const extraLegs = count - 1;
      const penaltyMultiplier = Math.pow(0.95, extraLegs);
      multiplier *= penaltyMultiplier;
      const penaltyAmount = 1 - penaltyMultiplier;
      penalties.push({
        type: 'same_team',
        amount: penaltyAmount,
        reason: `${count} legs from ${team} - ${(penaltyAmount * 100).toFixed(1)}% penalty`,
      });
    }
  }

  // Penalty: QB pass yards + WR/TE rec yards same team - multiply by 0.85
  for (const teamGroup of teamLegs) {
    const hasQBPass = teamGroup.legs.some(l => isQBPassingYards(l));
    const hasWRTERec = teamGroup.legs.some(l => isWRTEReceivingYards(l));
    
    if (hasQBPass && hasWRTERec) {
      multiplier *= 0.85;
      penalties.push({
        type: 'qb_wr_stack',
        amount: 0.15,
        reason: `QB pass yards + WR/TE rec yards from ${teamGroup.team} - 15% penalty`,
      });
    }
  }

  const adjustedProbability = baseProbability * multiplier;
  
  return {
    adjustedProbability: Math.max(adjustedProbability, 0),
    penalties,
  };
}

/**
 * Calculate composite score for a parlay (for sorting)
 * Incorporates:
 * - Base probability (product of leg probabilities)
 * - Game diversity bonus (more unique games = higher score)
 * - Volume stat preference (RB/WR volume stats > TD props)
 * - Team scoring dependency penalty (multiple legs from same team that depend on scoring)
 */
function calculateParlayScore(legs: Leg[]): number {
  const baseProbability = calculateParlayProbability(legs);
  
  // Game diversity bonus: boost parlays with more unique games
  const uniqueGames = countUniqueGames(legs);
  const totalLegs = legs.length;
  const gameDiversityRatio = uniqueGames / totalLegs; // 1.0 = all different games, lower = more same-game
  const gameDiversityBonus = gameDiversityRatio * 0.1; // Up to 10% bonus for perfect diversity
  
  // Volume stat preference: boost parlays with more volume stats
  const volumeStatCount = legs.filter((leg) => isVolumeStat(leg.statType, leg.position)).length;
  const tdPropCount = legs.filter((leg) => isTDProp(leg.statType)).length;
  const volumeStatRatio = volumeStatCount / totalLegs;
  const volumeStatBonus = volumeStatRatio * 0.05; // Up to 5% bonus for all volume stats
  
  // Team scoring dependency penalty: penalize parlays where multiple legs depend on same team scoring
  const teamTDCounts = countTeamScoringDependencies(legs);
  let teamScoringPenalty = 0;
  for (const [team, count] of teamTDCounts.entries()) {
    if (count > 1) {
      // Penalty increases with more TD props from same team
      teamScoringPenalty += (count - 1) * 0.15; // 15% penalty per additional TD prop from same team
    }
  }
  
  // Calculate composite score
  const score = baseProbability * (1 + gameDiversityBonus + volumeStatBonus - teamScoringPenalty);
  
  // Ensure score doesn't go negative
  return Math.max(score, baseProbability * 0.1);
}

/**
 * Generate all valid parlays from candidate legs
 */
export function generateParlays(
  candidateLegs: Leg[],
  options: ParlayOptions = {}
): Parlay[] {
  // Default values
  const legCount = Math.max(2, Math.min(8, options.legCount ?? 3));
  const minLegProb = options.minLegProb ?? 0.80;
  const singleGame = options.singleGame ?? false;
  const allowSameGame = singleGame ? true : (options.allowSameGame ?? false);
  const allowSameTeamStack = options.allowSameTeamStack ?? false;

  // Filter legs by minLegProb (using smoothed probability)
  let filteredLegs = candidateLegs.filter(leg => leg.smoothedProb >= minLegProb);

  // Filter legs by gameId if SGP mode
  if (singleGame && options.gameId) {
    filteredLegs = filteredLegs.filter(
      (leg) => leg.gameId === options.gameId
    );
  }

  const parlays: Parlay[] = [];

  // Generate combinations of legs
  const generateCombinations = (
    arr: Leg[],
    size: number,
    start: number = 0,
    current: Leg[] = []
  ): void => {
    if (current.length === size) {
      if (isValidParlay(current, legCount, allowSameGame, allowSameTeamStack)) {
        const { adjustedProbability, penalties } = calculateParlayPenalties(current);
        parlays.push({
          legs: [...current],
          estimatedProbability: adjustedProbability,
          estProbability: adjustedProbability,
          penaltyBreakdown: penalties.length > 0 ? penalties : undefined,
        });
      }
      return;
    }

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      generateCombinations(arr, size, i + 1, current);
      current.pop();
    }
  };

  // Generate parlays with exactly legCount legs
  generateCombinations(filteredLegs, legCount);

  // Calculate average leg smoothed probability for each parlay
  const parlaysWithAvgProb = parlays.map((parlay) => {
    const avgLegProb = parlay.legs.reduce((sum, leg) => sum + leg.smoothedProb, 0) / parlay.legs.length;
    return {
      ...parlay,
      _avgLegProb: avgLegProb,
    };
  });

  // Sort by estProbability desc, then by average leg probability desc
  parlaysWithAvgProb.sort((a, b) => {
    const probDiff = b.estProbability! - a.estProbability!;
    if (probDiff !== 0) {
      return probDiff;
    }
    return b._avgLegProb - a._avgLegProb;
  });

  // Return parlays with only the original fields (remove _avgLegProb)
  return parlaysWithAvgProb.map(({ _avgLegProb, ...parlay }) => parlay);
}

/**
 * Get top N parlays from candidate legs
 */
export function getTopParlays(
  candidateLegs: Leg[],
  topN: number = 20,
  options: ParlayOptions = {}
): Parlay[] {
  const allParlays = generateParlays(candidateLegs, options);
  return allParlays.slice(0, topN);
}

