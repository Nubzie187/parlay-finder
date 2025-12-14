import { readFile } from 'fs/promises';
import { access } from 'fs/promises';
import path from 'path';
import { GameLog } from './types';
import { loadCachedGamelogs } from './nfl-data';

/**
 * Load gamelogs for a range of weeks
 * Returns all game logs from startWeek to endWeek (inclusive) for the given season
 */
export async function loadGameLogsForRange(
  season: number,
  startWeek: number,
  endWeek: number
): Promise<{
  gameLogs: GameLog[];
  filePathUsed: string[];
  fileExists: boolean[];
  parseError?: string;
}> {
  const allGameLogs: GameLog[] = [];
  const filePathsUsed: string[] = [];
  const fileExistsFlags: boolean[] = [];
  let parseError: string | undefined;

  // Load gamelogs for each week in the range
  for (let week = startWeek; week <= endWeek; week++) {
    try {
      const result = await loadGameLogs(season, week);
      if (result.gameLogs && result.gameLogs.length > 0) {
        allGameLogs.push(...result.gameLogs);
        filePathsUsed.push(result.filePathUsed);
        fileExistsFlags.push(result.fileExists);
        if (result.parseError) {
          parseError = result.parseError;
        }
      }
    } catch (error) {
      // Continue loading other weeks even if one fails
      const errorDetails = error as any;
      filePathsUsed.push(errorDetails.filePathUsed || `week_${week}`);
      fileExistsFlags.push(errorDetails.fileExists || false);
      if (errorDetails.parseError) {
        parseError = errorDetails.parseError;
      }
    }
  }

  return {
    gameLogs: allGameLogs,
    filePathUsed: filePathsUsed,
    fileExists: fileExistsFlags,
    parseError,
  };
}

/**
 * Load gamelogs from local file or cached NFL data
 * Uses async fs/promises for file operations
 * Returns game logs or throws an error with details
 */
export async function loadGameLogs(season?: number, week?: number): Promise<{
  gameLogs: GameLog[];
  filePathUsed: string;
  fileExists: boolean;
  parseError?: string;
}> {
  // If season and week are provided, try to load from cached NFL data
  if (season !== undefined && week !== undefined) {
    const cachedLogs = await loadCachedGamelogs(season, week);
    if (cachedLogs && cachedLogs.length > 0) {
      const cachePath = path.join(process.cwd(), 'data', 'cache', `gamelogs_${season}_${week}.json`);
      return {
        gameLogs: cachedLogs,
        filePathUsed: path.resolve(cachePath),
        fileExists: true,
      };
    }
    // If cache doesn't exist, fall through to sample file
  }

  // Default: load from sample file
  const filePathUsed = path.join(process.cwd(), 'data', 'gamelogs.sample.json');
  const absolutePath = path.resolve(filePathUsed);

  let fileExists = false;
  let parseError: string | undefined;

  try {
    // Check if file exists
    try {
      await access(absolutePath);
      fileExists = true;
    } catch (error) {
      fileExists = false;
      throw {
        error: 'Gamelogs file not found',
        filePathUsed: absolutePath,
        fileExists: false,
        message: `Expected file at: ${absolutePath}`,
      };
    }

    // Read file
    let fileContent: string;
    try {
      fileContent = await readFile(absolutePath, 'utf-8');
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
      throw {
        error: 'Failed to read gamelogs file',
        filePathUsed: absolutePath,
        fileExists: true,
        parseError,
        message: `Error reading file: ${parseError}`,
      };
    }

    // Check if file is empty
    if (!fileContent || fileContent.trim().length === 0) {
      throw {
        error: 'Gamelogs file is empty',
        filePathUsed: absolutePath,
        fileExists: true,
        message: 'The file exists but contains no data',
      };
    }

    // Parse JSON
    let data: any;
    try {
      data = JSON.parse(fileContent);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
      throw {
        error: 'Failed to parse gamelogs file as JSON',
        filePathUsed: absolutePath,
        fileExists: true,
        parseError,
        message: `JSON parse error: ${parseError}`,
      };
    }

    // Validate it's an array
    if (!Array.isArray(data)) {
      parseError = 'File does not contain an array';
      throw {
        error: 'Invalid gamelogs file format',
        filePathUsed: absolutePath,
        fileExists: true,
        parseError,
        message: 'File must contain an array of game logs',
      };
    }

    // Check if array is empty
    if (data.length === 0) {
      throw {
        error: 'Gamelogs file contains no records',
        filePathUsed: absolutePath,
        fileExists: true,
        message: 'The file is valid but the array is empty',
      };
    }

    return {
      gameLogs: data as GameLog[],
      filePathUsed: absolutePath,
      fileExists: true,
    };
  } catch (error) {
    // Re-throw our structured errors
    if (error && typeof error === 'object' && 'error' in error) {
      throw error;
    }

    // Wrap unexpected errors
    parseError = error instanceof Error ? error.message : String(error);
    throw {
      error: 'Unexpected error loading gamelogs',
      filePathUsed: absolutePath,
      fileExists,
      parseError,
      message: parseError,
    };
  }
}

