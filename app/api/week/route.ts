import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSeason, getCurrentWeekData } from '@/lib/week';

/**
 * Get current NFL week
 * This is a simple implementation - in production, you'd fetch this from
 * an NFL API or calculate it based on the current date
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const weekParam = searchParams.get('week');
    
    // If week is provided in query, use it
    if (weekParam) {
      const week = parseInt(weekParam, 10);
      if (isNaN(week) || week < 1 || week > 18) {
        return NextResponse.json(
          { error: 'Invalid week. Must be between 1 and 18.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ week, season: getCurrentSeason() });
    }

    // Otherwise, calculate current week based on date
    const weekData = getCurrentWeekData();
    
    // Return week data with slate (games for the week)
    // In production, this would fetch from NFL API
    const slateParam = searchParams.get('slate');
    if (slateParam === 'true') {
      // Return game slate structure
      // This would typically come from a database or NFL API
      return NextResponse.json({
        ...weekData,
        slate: [], // Empty array - would be populated with game data
        // Example structure: [{ gameId: 'game1', team1: 'KC', team2: 'BUF', gameDate: '2024-01-01' }, ...]
      });
    }
    
    return NextResponse.json(weekData);
  } catch (error) {
    console.error('Error getting current week:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

