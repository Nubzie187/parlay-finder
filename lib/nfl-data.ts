import fs from 'fs/promises';
import path from 'path';
import { GameLog } from './types';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const SOURCE_URLS_CACHE = path.join(CACHE_DIR, 'source_urls.json');

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore
  }
}

/**
 * Load cached source URLs
 */
async function loadCachedSourceUrls(): Promise<Record<number, string>> {
  try {
    await ensureCacheDir();
    const content = await fs.readFile(SOURCE_URLS_CACHE, 'utf-8');
    const data = JSON.parse(content);
    return data || {};
  } catch (error) {
    // File doesn't exist or invalid, return empty object
    return {};
  }
}

/**
 * Save source URL to cache
 */
async function saveCachedSourceUrl(season: number, url: string): Promise<void> {
  await ensureCacheDir();
  const cached = await loadCachedSourceUrls();
  cached[season] = url;
  await fs.writeFile(SOURCE_URLS_CACHE, JSON.stringify(cached, null, 2), 'utf-8');
}

/**
 * Discover the download URL for a season using GitHub Releases API
 */
async function discoverSourceUrl(season: number): Promise<{ url: string; availableSeasons: number[] }> {
  // Check cache first
  const cached = await loadCachedSourceUrls();
  if (cached[season]) {
    return { url: cached[season], availableSeasons: [] };
  }

  // Fetch GitHub releases
  const releasesUrl = 'https://api.github.com/repos/nflverse/nflverse-data/releases';
  const { response, url, method } = await fetchWithDetails(releasesUrl);

  if (!response.ok) {
    const error: any = new Error(`Failed to fetch GitHub releases: HTTP ${response.status}`);
    error.fetchErrors = [{
      url,
      method,
      statusCode: response.status,
      errorMessage: `HTTP ${response.status} ${response.statusText}`,
    }];
    throw error;
  }

  const releases: any[] = await response.json();
  const availableSeasons: number[] = [];
  let foundUrl: string | null = null;

  // Search through all releases for the matching asset
  for (const release of releases) {
    if (!release.assets || !Array.isArray(release.assets)) {
      continue;
    }

    for (const asset of release.assets) {
      const assetName = asset.name || '';
      
      // Check if asset name contains "player_week" and the season year
      if (assetName.includes('player_week') && assetName.includes(String(season))) {
        foundUrl = asset.browser_download_url;
        // Cache it for future use
        await saveCachedSourceUrl(season, foundUrl);
        break;
      }

      // Also collect all available seasons for error reporting
      const seasonMatch = assetName.match(/player_week[_\s]*(\d{4})/);
      if (seasonMatch) {
        const foundSeason = parseInt(seasonMatch[1], 10);
        if (!availableSeasons.includes(foundSeason)) {
          availableSeasons.push(foundSeason);
        }
      }
    }

    if (foundUrl) {
      break;
    }
  }

  // Sort available seasons
  availableSeasons.sort((a, b) => b - a);

  if (!foundUrl) {
    const error: any = new Error(`No player stats asset found for season ${season}`);
    error.availableSeasons = availableSeasons;
    throw error;
  }

  return { url: foundUrl, availableSeasons };
}

/**
 * Get cache file path for season and week
 */
function getCacheFilePath(season: number, week: number): string {
  return path.join(CACHE_DIR, `gamelogs_${season}_${week}.json`);
}

/**
 * Load cached gamelogs if they exist
 */
export async function loadCachedGamelogs(season: number, week: number): Promise<GameLog[] | null> {
  try {
    const cachePath = getCacheFilePath(season, week);
    const content = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(content);
    
    if (Array.isArray(data)) {
      return data as GameLog[];
    }
    
    return null;
  } catch (error) {
    // File doesn't exist or invalid, return null
    return null;
  }
}

/**
 * Save gamelogs to cache
 */
export async function saveCachedGamelogs(season: number, week: number, gameLogs: GameLog[]): Promise<void> {
  await ensureCacheDir();
  const cachePath = getCacheFilePath(season, week);
  await fs.writeFile(cachePath, JSON.stringify(gameLogs, null, 2), 'utf-8');
}

/**
 * Interface for detailed fetch error information
 */
export interface FetchErrorDetails {
  url: string;
  method: string;
  statusCode?: number;
  responseBodyPreview?: string;
  errorName?: string;
  errorMessage: string;
  errorCause?: any;
}

/**
 * Helper to fetch with detailed error information
 */
async function fetchWithDetails(url: string, options: RequestInit = {}): Promise<{ response: Response; url: string; method: string }> {
  const method = options.method || 'GET';
  console.log(`[FETCH] ${method} ${url}`);
  
  try {
    const response = await fetch(url, options);
    return { response, url, method };
  } catch (error) {
    const errorDetails: FetchErrorDetails = {
      url,
      method,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCause: error instanceof Error ? error.cause : undefined,
    };
    
    console.error('[FETCH ERROR]', errorDetails);
    throw errorDetails;
  }
}

/**
 * Fetch NFL player stats from nflverse GitHub releases for a given season and week
 * Downloads full season CSV, parses it, and filters to the requested week
 */
export async function fetchNFLGamelogs(season: number, week: number): Promise<{ gameLogs: GameLog[]; sourceUrl: string }> {
  // Discover the correct download URL using GitHub Releases API
  let sourceUrl: string;
  let availableSeasons: number[] = [];
  
  try {
    const discovery = await discoverSourceUrl(season);
    sourceUrl = discovery.url;
    availableSeasons = discovery.availableSeasons;
  } catch (error) {
    // If discovery fails, check if it's because the season wasn't found
    if (error && typeof error === 'object' && 'availableSeasons' in error) {
      const discoveryError: any = error;
      const errorDetails: any = new Error(`Season ${season} player stats file is not available`);
      errorDetails.fetchErrors = [{
        url: 'https://api.github.com/repos/nflverse/nflverse-data/releases',
        method: 'GET',
        statusCode: 200, // API call succeeded, but asset not found
        errorMessage: `No player stats asset found for season ${season}.`,
      }];
      errorDetails.availableSeasons = discoveryError.availableSeasons || [];
      errorDetails.suggestedSeason = discoveryError.availableSeasons && discoveryError.availableSeasons.length > 0 
        ? discoveryError.availableSeasons[0] 
        : season - 1;
      throw errorDetails;
    }
    // Re-throw other discovery errors
    throw error;
  }
  
  try {
    const { response, url, method } = await fetchWithDetails(sourceUrl);

    // Read response body
    let responseText: string = '';
    let responseBodyPreview: string | undefined;
    try {
      responseText = await response.text();
      responseBodyPreview = responseText.substring(0, 200);
    } catch (e) {
      responseBodyPreview = undefined;
    }

    if (response.status === 404) {
      const error: any = new Error(`Season ${season} player stats file is not available`);
      error.fetchErrors = [{
        url,
        method,
        statusCode: 404,
        responseBodyPreview,
        errorMessage: `Season ${season} file not found at discovered URL.`,
      }];
      error.availableSeasons = availableSeasons;
      error.suggestedSeason = availableSeasons && availableSeasons.length > 0 
        ? availableSeasons[0] 
        : season - 1;
      throw error;
    }

    if (!response.ok) {
      const error: any = new Error(`Failed to fetch NFL data: HTTP ${response.status}`);
      error.fetchErrors = [{
        url,
        method,
        statusCode: response.status,
        responseBodyPreview,
        errorMessage: `HTTP ${response.status} ${response.statusText}`,
      }];
      throw error;
    }

    // Parse CSV and filter to requested week
    try {
      const gameLogs = parseCSVToGameLogs(responseText, season, week);
      return { gameLogs, sourceUrl };
    } catch (parseError) {
      const error: any = new Error(`Failed to parse CSV data`);
      error.fetchErrors = [{
        url,
        method,
        statusCode: response.status,
        responseBodyPreview,
        errorName: parseError instanceof Error ? parseError.name : 'ParseError',
        errorMessage: `Failed to parse CSV: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      }];
      throw error;
    }
  } catch (error) {
    // If it's already our structured error, re-throw it
    if (error && typeof error === 'object' && 'fetchErrors' in error) {
      throw error;
    }

    // Wrap unexpected errors
    const fetchError: FetchErrorDetails = error && typeof error === 'object' && 'url' in error
      ? (error as FetchErrorDetails)
      : {
          url: sourceUrl,
          method: 'GET',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCause: error instanceof Error ? error.cause : undefined,
        };

    const detailedError: any = new Error(`Failed to fetch NFL gamelogs: ${fetchError.errorMessage}`);
    detailedError.fetchErrors = [fetchError];
    throw detailedError;
  }
}


/**
 * Parse CSV to GameLog format and filter to requested week
 * nflverse CSV format: player_id, player_name, position, team, game_id, season, week, etc.
 */
function parseCSVToGameLogs(csvText: string, season: number, week: number): GameLog[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Parse header - handle quoted headers
  const headerLine = lines[0];
  const headers: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField) headers.push(currentField.trim());

  const gameLogs: GameLog[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse CSV line handling quoted fields
    const values: string[] = [];
    let currentValue = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    if (currentValue) values.push(currentValue.trim());

    // Build record object
    const record: any = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });

    // Filter to requested week
    const recordWeek = parseInt(record.week || record.season_type || '0', 10);
    if (recordWeek !== week) {
      continue; // Skip rows not matching requested week
    }

    // Map nflverse CSV columns to our GameLog format
    const gameLog: GameLog = {
      playerId: record.player_id || record.gsis_id || record.id || String(i),
      playerName: record.player_name || record.name || record.full_name || record.player_display_name || '',
      position: record.position || '',
      team: record.team || record.team_abbr || record.recent_team || '',
      gameId: record.game_id || `${season}_${week}_${record.team || ''}`,
      week: week,
      season: season,
      gameDate: record.game_date || record.date || new Date().toISOString().split('T')[0],
      opponent: record.opponent || record.opponent_team || '',
      snaps: record.snaps ? parseInt(record.snaps, 10) : undefined,
      pass_yards: record.passing_yards ? parseInt(record.passing_yards, 10) : (record.pass_yards ? parseInt(record.pass_yards, 10) : 0),
      rush_yards: record.rushing_yards ? parseInt(record.rushing_yards, 10) : (record.rush_yards ? parseInt(record.rush_yards, 10) : 0),
      rec_yards: record.receiving_yards ? parseInt(record.receiving_yards, 10) : (record.rec_yards ? parseInt(record.rec_yards, 10) : 0),
      receptions: record.receptions ? parseInt(record.receptions, 10) : (record.rec ? parseInt(record.rec, 10) : 0),
      pass_tds: record.passing_tds ? parseInt(record.passing_tds, 10) : (record.pass_tds ? parseInt(record.pass_tds, 10) : 0),
      targets: record.targets ? parseInt(record.targets, 10) : undefined,
      rush_attempts: record.rushing_attempts ? parseInt(record.rushing_attempts, 10) : (record.rush_attempts ? parseInt(record.rush_attempts, 10) : undefined),
    };

    gameLogs.push(gameLog);
  }

  return gameLogs;
}

