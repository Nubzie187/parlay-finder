import { NextRequest, NextResponse } from 'next/server';
import { calculateParlayPenalties } from '@/lib/correlation';
import { Leg } from '@/lib/types';

interface IncomingLeg {
  playerId: string;
  gameId?: string;
  team?: string;
  market: string; // e.g., 'pass_yards', 'rush_yards', 'rec_yards', 'receptions', 'pass_tds'
  threshold: number;
  probability: number;
}

interface ParlayProbRequest {
  legs: IncomingLeg[];
}

interface ParlayProbResponse {
  estProbability: number;
  penaltyBreakdown?: Array<{
    type: string;
    amount: number;
    reason: string;
  }>;
  baseProbability: number;
}

/**
 * Map incoming leg format to internal Leg type
 */
function mapIncomingLegToLeg(incomingLeg: IncomingLeg): Leg {
  // Map market to statType
  const marketToStatType: Record<string, Leg['statType']> = {
    'pass_yards': 'pass_yards',
    'rush_yards': 'rush_yards',
    'rec_yards': 'rec_yards',
    'receptions': 'receptions',
    'pass_tds': 'pass_tds',
  };

  const statType = marketToStatType[incomingLeg.market] || 'pass_yards';

  // Infer position from market type for penalty calculations
  let position: string | undefined;
  if (statType === 'pass_yards' || statType === 'pass_tds') {
    position = 'QB';
  } else if (statType === 'rec_yards' || statType === 'receptions') {
    position = 'WR'; // Default to WR, could be TE but penalty logic handles both
  } else if (statType === 'rush_yards') {
    position = 'RB';
  }

  return {
    playerId: incomingLeg.playerId,
    statType,
    threshold: incomingLeg.threshold,
    smoothedProb: incomingLeg.probability, // Treat incoming probability as smoothed
    rawProb: incomingLeg.probability, // Assume same if not provided (for display only)
    gameId: incomingLeg.gameId,
    team: incomingLeg.team,
    position,
    sampleSize: 0, // Not provided in incoming format
    lastNGameValues: [], // Not provided in incoming format
  };
}

/**
 * Calculate base probability (product of leg smoothed probabilities)
 */
function calculateBaseProbability(legs: Leg[]): number {
  return legs.reduce((product, leg) => product * leg.smoothedProb, 1);
}

export async function POST(request: NextRequest) {
  try {
    const body: ParlayProbRequest = await request.json();

    if (!body.legs || !Array.isArray(body.legs) || body.legs.length === 0) {
      return NextResponse.json(
        { error: 'legs array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Map incoming legs to internal Leg format
    const legs: Leg[] = body.legs.map(mapIncomingLegToLeg);

    // Calculate base probability
    const baseProbability = calculateBaseProbability(legs);

    // Calculate penalties using the same logic as /api/parlay
    const { adjustedProbability, penalties } = calculateParlayPenalties(legs);

    const response: ParlayProbResponse = {
      estProbability: adjustedProbability,
      baseProbability,
      penaltyBreakdown: penalties.length > 0 ? penalties : undefined,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error calculating parlay probability:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

