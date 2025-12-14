import { NextRequest, NextResponse } from 'next/server';
import { fetchNFLGamelogs, loadCachedGamelogs, saveCachedGamelogs } from '@/lib/nfl-data';
import { getCurrentWeekData } from '@/lib/week';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seasonParam = searchParams.get('season');
    const weekParam = searchParams.get('week');

    // Get season and week from params or use current
    let season: number;
    let week: number;

    if (seasonParam && weekParam) {
      season = parseInt(seasonParam, 10);
      week = parseInt(weekParam, 10);
    } else {
      const weekData = getCurrentWeekData();
      season = weekData.season || 2024;
      week = weekData.week || 1;
    }

    // Validate season and week
    if (isNaN(season) || isNaN(week) || season < 2000 || season > 2100 || week < 1 || week > 18) {
      return NextResponse.json(
        {
          error: 'Invalid season or week',
          message: 'Season must be between 2000-2100 and week must be between 1-18',
        },
        { status: 400 }
      );
    }

    // Try to load from cache first
    let gameLogs = await loadCachedGamelogs(season, week);

    // If not cached, fetch from nflverse GitHub releases
    let sourceUrl: string | undefined;
    if (!gameLogs || gameLogs.length === 0) {
      try {
        const result = await fetchNFLGamelogs(season, week);
        gameLogs = result.gameLogs;
        sourceUrl = result.sourceUrl;
        
        // Save to cache
        if (gameLogs && gameLogs.length > 0) {
          await saveCachedGamelogs(season, week, gameLogs);
        }
      } catch (error) {
        // Extract detailed fetch error information
        const fetchErrors = (error as any)?.fetchErrors || [];
        const suggestedSeason = (error as any)?.suggestedSeason;
        const availableSeasons = (error as any)?.availableSeasons;
        const errorDetails: any = {
          error: 'Failed to fetch NFL data',
          message: `Unable to fetch gamelogs for ${season} week ${week}.`,
        };

        if (fetchErrors.length > 0) {
          errorDetails.fetchAttempts = fetchErrors.map((err: any) => ({
            url: err.url,
            method: err.method || 'GET',
            statusCode: err.statusCode,
            responseBodyPreview: err.responseBodyPreview,
            errorName: err.errorName,
            errorMessage: err.errorMessage,
            errorCause: err.errorCause,
          }));
          
          // Add helpful message for 404 or missing season
          if (fetchErrors[0]?.statusCode === 404 || availableSeasons) {
            if (availableSeasons && availableSeasons.length > 0) {
              errorDetails.message = `Season ${season} player stats file is not available. Available seasons: ${availableSeasons.join(', ')}.`;
              errorDetails.availableSeasons = availableSeasons;
            } else {
              errorDetails.message = `Season ${season} player stats file is not available yet. ${suggestedSeason ? `Try the previous season (${suggestedSeason}).` : 'The data may not be available yet.'}`;
            }
          }
        } else {
          // Check if it's a discovery error (no asset found)
          if (availableSeasons && availableSeasons.length > 0) {
            errorDetails.message = `Season ${season} player stats file is not available. Available seasons: ${availableSeasons.join(', ')}.`;
            errorDetails.availableSeasons = availableSeasons;
          }
          // Fallback for non-fetch errors
          errorDetails.details = error instanceof Error ? error.message : String(error);
          if (error instanceof Error) {
            errorDetails.errorName = error.name;
            errorDetails.errorCause = error.cause;
          }
        }

        console.error('[GAMELOGS API ERROR]', errorDetails);
        // Return 500 error when fetch fails and no cache exists
        return NextResponse.json(errorDetails, { status: 500 });
      }
    }

    if (!gameLogs || gameLogs.length === 0) {
      return NextResponse.json(
        {
          error: 'No gamelogs found',
          message: `No gamelogs available for ${season} week ${week}`,
        },
        { status: 404 }
      );
    }

    // Get unique players
    const uniquePlayerIds = new Set<string>();
    for (const log of gameLogs) {
      if (log.playerId) {
        uniquePlayerIds.add(log.playerId);
      }
    }

    return NextResponse.json({
      totalGameLogs: gameLogs.length,
      uniquePlayers: uniquePlayerIds.size,
      season,
      week,
      ...(sourceUrl && { sourceUrl }),
    });
  } catch (error) {
    console.error('Error in /api/gamelogs:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // TODO: Implement gamelogs POST logic
    return NextResponse.json({ 
      message: 'Gamelog created',
      data: body 
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
