import { NextRequest, NextResponse } from 'next/server';
import { getTopParlays, ParlayOptions } from '@/lib/correlation';
import { Leg } from '@/lib/types';

export async function GET(request: NextRequest) {
  let candidateLegs: Leg[] = [];
  let options: ParlayOptions = {
    legCount: 3,
    minLegProb: 0.80,
    singleGame: false,
    allowSameGame: false,
    allowSameTeamStack: false,
  };

  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Get candidate legs from query params
    const legsParam = searchParams.get('legs');
    if (!legsParam) {
      return NextResponse.json(
        { error: 'legs parameter is required (JSON array of legs)' },
        { status: 400 }
      );
    }

    try {
      candidateLegs = JSON.parse(legsParam);
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid legs JSON in query parameter' },
        { status: 400 }
      );
    }

    if (!Array.isArray(candidateLegs) || candidateLegs.length === 0) {
      return NextResponse.json(
        { error: 'legs must be a non-empty array' },
        { status: 400 }
      );
    }

    // Parse options with defaults
    const legCountParam = searchParams.get('legCount');
    const singleGameParam = searchParams.get('singleGame');
    const gameIdParam = searchParams.get('gameId');
    const minLegProbParam = searchParams.get('minLegProb');
    const allowSameGameParam = searchParams.get('allowSameGame');
    const allowSameTeamStackParam = searchParams.get('allowSameTeamStack');
    
    options = {
      legCount: legCountParam 
        ? Math.max(2, Math.min(8, parseInt(legCountParam, 10))) 
        : 3, // Default 3
      minLegProb: minLegProbParam 
        ? parseFloat(minLegProbParam) 
        : 0.80, // Default 0.80
      singleGame: singleGameParam === 'true',
      gameId: gameIdParam || undefined,
      allowSameGame: allowSameGameParam === 'true',
      allowSameTeamStack: allowSameTeamStackParam === 'true',
    };

    // Validate SGP requirements
    if (options.singleGame && !options.gameId) {
      return NextResponse.json(
        { error: 'gameId is required when singleGame=true' },
        { status: 400 }
      );
    }

    // Force allowSameGame=true when singleGame=true
    if (options.singleGame) {
      options.allowSameGame = true;
    }

    const topN = 20; // Always return top 20

    // Generate top parlays
    const topParlays = getTopParlays(candidateLegs, topN, options);

    return NextResponse.json({
      count: topParlays.length,
      parlays: topParlays,
      options: {
        ...options,
        topN,
      },
    });
  } catch (error) {
    console.error('Error generating parlays:', error);
    
    const isDev = process.env.NODE_ENV === 'development';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Sample first 2 legs
    const sampleLegs = candidateLegs.slice(0, 2).map(leg => ({
      playerId: leg.playerId,
      playerName: leg.playerName,
      statType: leg.statType,
      threshold: leg.threshold,
      smoothedProb: leg.smoothedProb,
      gameId: leg.gameId,
      team: leg.team,
    }));

    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: errorMessage,
        ...(isDev && errorStack && { stack: errorStack }),
        debug: {
          legCount: options.legCount,
          minLegProb: options.minLegProb,
          candidateLegsCount: candidateLegs.length,
          sampleLegs,
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let candidateLegs: Leg[] = [];
  let parlayOptions: ParlayOptions = {
    legCount: 3,
    minLegProb: 0.80,
    singleGame: false,
    allowSameGame: false,
    allowSameTeamStack: false,
  };

  try {
    const body = await request.json();
    const { legs, topN } = body;

    // Basic validation: legs is required and must be a non-empty array
    if (!legs) {
      return NextResponse.json(
        { error: 'legs is required in request body' },
        { status: 400 }
      );
    }

    if (!Array.isArray(legs)) {
      return NextResponse.json(
        { error: 'legs must be an array' },
        { status: 400 }
      );
    }

    if (legs.length === 0) {
      return NextResponse.json(
        { error: 'legs array must not be empty' },
        { status: 400 }
      );
    }

    candidateLegs = legs;

    // Parse options from query params with defaults
    const searchParams = request.nextUrl.searchParams;
    const legCountParam = searchParams.get('legCount');
    const singleGameParam = searchParams.get('singleGame');
    const gameIdParam = searchParams.get('gameId');
    const minLegProbParam = searchParams.get('minLegProb');
    const allowSameGameParam = searchParams.get('allowSameGame');
    const allowSameTeamStackParam = searchParams.get('allowSameTeamStack');
    
    parlayOptions = {
      legCount: legCountParam 
        ? Math.max(2, Math.min(8, parseInt(legCountParam, 10))) 
        : 3, // Default 3
      minLegProb: minLegProbParam 
        ? parseFloat(minLegProbParam) 
        : 0.80, // Default 0.80
      singleGame: singleGameParam === 'true',
      gameId: gameIdParam || undefined,
      allowSameGame: allowSameGameParam === 'true',
      allowSameTeamStack: allowSameTeamStackParam === 'true',
    };

    // Validate SGP requirements
    if (parlayOptions.singleGame && !parlayOptions.gameId) {
      return NextResponse.json(
        { error: 'gameId is required when singleGame=true' },
        { status: 400 }
      );
    }

    // Force allowSameGame=true when singleGame=true
    if (parlayOptions.singleGame) {
      parlayOptions.allowSameGame = true;
    }

    const topNCount = topN ?? 20; // Use provided topN or default to 20

    // Generate top parlays
    const topParlays = getTopParlays(legs, topNCount, parlayOptions);

    return NextResponse.json({
      count: topParlays.length,
      parlays: topParlays,
      options: {
        ...parlayOptions,
        topN: topNCount,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Error generating parlays:', error);
    
    const isDev = process.env.NODE_ENV === 'development';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Sample first 2 legs
    const sampleLegs = candidateLegs.slice(0, 2).map(leg => ({
      playerId: leg.playerId,
      playerName: leg.playerName,
      statType: leg.statType,
      threshold: leg.threshold,
      smoothedProb: leg.smoothedProb,
      gameId: leg.gameId,
      team: leg.team,
    }));

    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: errorMessage,
        ...(isDev && errorStack && { stack: errorStack }),
        debug: {
          legCount: parlayOptions.legCount,
          minLegProb: parlayOptions.minLegProb,
          candidateLegsCount: candidateLegs.length,
          sampleLegs,
        },
      },
      { status: 500 }
    );
  }
}

