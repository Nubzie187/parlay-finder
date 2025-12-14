/**
 * Calculate current NFL season year
 * Default to 2024 if current date calculation would return a future season
 */
export function getCurrentSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  // NFL season starts in September, so if we're before September, use previous year
  let calculatedSeason = year;
  if (now.getMonth() < 8) {
    calculatedSeason = year - 1;
  }
  // Default to 2024 if calculated season is in the future
  return Math.min(calculatedSeason, 2024);
}

/**
 * Calculate current NFL week based on date
 * This is a simplified implementation - adjust based on actual NFL schedule
 * Week 1 typically starts around early September
 */
export function calculateCurrentWeek(): number {
  const now = new Date();
  const seasonStart = new Date(now.getFullYear(), 8, 1); // September 1st
  
  // If we're before September, season hasn't started yet
  if (now < seasonStart) {
    return 1; // Default to week 1
  }

  // Calculate weeks since season start (rough approximation)
  const daysSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(daysSinceStart / 7) + 1;
  
  // NFL regular season is 18 weeks
  return Math.min(Math.max(week, 1), 18);
}

/**
 * Get current week data (week and season)
 */
export function getCurrentWeekData(): { week: number; season: number } {
  return {
    week: calculateCurrentWeek(),
    season: getCurrentSeason(),
  };
}

