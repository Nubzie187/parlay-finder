import { NextRequest, NextResponse } from 'next/server';
import { getTopParlays, ParlayOptions } from '@/lib/correlation';
import { Leg } from '@/lib/types';

/**
 * Redirect /api/parlays to /api/parlay for backward compatibility
 * This endpoint is deprecated - use /api/parlay instead
 * 
 * For GET requests: Returns a 308 Permanent Redirect
 * For POST requests: Proxies the request internally by calling the same logic as /api/parlay
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/parlay';
  return NextResponse.redirect(url, 308); // 308 Permanent Redirect
}

export async function POST(request: NextRequest) {
  // Proxy POST requests by calling the same handler logic as /api/parlay
  // This maintains backward compatibility while using the standardized endpoint logic
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

    // Generate top parlays using the same logic as /api/parlay
    const topParlays = getTopParlays(legs, topNCount, parlayOptions);

    // Return response with deprecation warning in headers
    return NextResponse.json({
      count: topParlays.length,
      parlays: topParlays,
      options: {
        ...parlayOptions,
        topN: topNCount,
      },
      _deprecated: true,
      _message: 'This endpoint (/api/parlays) is deprecated. Please use /api/parlay instead.',
    }, { 
      status: 200,
      headers: {
        'X-Deprecated-Endpoint': 'true',
        'X-Use-Instead': '/api/parlay',
      },
    });
  } catch (error) {
    console.error('Error generating parlays (via deprecated /api/parlays):', error);
    
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
        _deprecated: true,
        _message: 'This endpoint (/api/parlays) is deprecated. Please use /api/parlay instead.',
      },
      { 
        status: 500,
        headers: {
          'X-Deprecated-Endpoint': 'true',
          'X-Use-Instead': '/api/parlay',
        },
      }
    );
  }
}

