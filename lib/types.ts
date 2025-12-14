// Type definitions for the application

export interface GameLog {
  playerId: string;
  playerName?: string;
  gameDate: string;
  gameId?: string; // Unique identifier for the game
  week?: number; // NFL week number (1-18)
  season?: number; // NFL season year
  team?: string; // Team abbreviation or name
  opponent?: string; // Opponent team
  position?: string; // Player position (QB, RB, WR, TE, etc.)
  snaps?: number; // Number of snaps played in the game
  pass_yards?: number;
  rush_yards?: number;
  rec_yards?: number;
  receptions?: number;
  pass_tds?: number;
  [key: string]: any; // Allow additional fields
}

export interface PlayerStatus {
  playerId: string;
  team?: string;
  isActive: boolean; // Active for current week
  isOnBye: boolean; // Team is on bye week
  hasRecentSnaps: boolean; // Has snaps in last 2 games
  currentWeek?: number;
}

export type ConfidenceLevel = 'Speculative' | 'Fair' | 'Strong' | 'Elite';

export interface Leg {
  playerId: string;
  playerName?: string;
  statType: 'pass_yards' | 'rush_yards' | 'rec_yards' | 'receptions' | 'pass_tds';
  threshold: number;
  smoothedProb: number; // Beta-Binomial smoothed estimate (k+a)/(n+a+b) - used for filtering, sorting, and calculations
  rawProb: number; // Raw probability (k/n) - for display/debug only
  confidence: ConfidenceLevel; // Confidence band based on smoothedProb
  sampleSize: number;
  lastNGameValues: number[];
  consistency?: number; // Standard deviation of stat values (lower = more consistent)
  reason?: string; // Explanation of the leg (hit rate, average vs threshold, recent outcome)
  // Game context (from most recent game log used)
  gameId?: string;
  gameDate?: string;
  team?: string;
  opponent?: string;
  position?: string;
}

export interface PenaltyBreakdown {
  type: string;
  amount: number; // Penalty as multiplier (e.g., 0.15 = 15% reduction)
  reason: string;
}

export interface Parlay {
  legs: Leg[];
  estimatedProbability: number; // Product of leg probabilities, then correlation penalties applied
  estProbability?: number; // Alias for estimatedProbability (for consistency)
  penaltyBreakdown?: PenaltyBreakdown[];
}

export interface Player {
  id: string;
  name: string;
  position?: string;
  [key: string]: any;
}

