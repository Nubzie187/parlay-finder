import fs from 'fs';
import path from 'path';
import { GameLog } from './types';

const GAMELOGS_FILE_PATH = path.join(process.cwd(), 'data', 'gamelogs.sample.json');

export interface LoadGameLogsResult {
  gameLogs: GameLog[];
  filePath: string;
}

export interface LoadGameLogsError {
  error: string;
  filePath: string;
  details?: string;
}

/**
 * Load gamelogs from local file
 * Returns game logs or throws an error with details
 */
export function loadGameLogs(debug: boolean = false): LoadGameLogsResult {
  const absolutePath = path.resolve(GAMELOGS_FILE_PATH);
  
  if (debug) {
    console.log(`[DEBUG] Attempting to load gamelogs from: ${absolutePath}`);
  }

  // Check if file exists
  if (!fs.existsSync(GAMELOGS_FILE_PATH)) {
    const error: LoadGameLogsError = {
      error: 'Gamelogs file not found',
      filePath: absolutePath,
      details: `Expected file at: ${absolutePath}`,
    };
    throw error;
  }

  try {
    const fileContent = fs.readFileSync(GAMELOGS_FILE_PATH, 'utf-8');
    
    if (!fileContent || fileContent.trim().length === 0) {
      const error: LoadGameLogsError = {
        error: 'Gamelogs file is empty',
        filePath: absolutePath,
        details: 'The file exists but contains no data',
      };
      throw error;
    }

    const data = JSON.parse(fileContent);
    
    // Handle both array and object with array property
    let gameLogs: GameLog[] = [];
    
    if (Array.isArray(data)) {
      gameLogs = data;
    } else if (data.gamelogs && Array.isArray(data.gamelogs)) {
      gameLogs = data.gamelogs;
    } else if (data.data && Array.isArray(data.data)) {
      gameLogs = data.data;
    } else {
      const error: LoadGameLogsError = {
        error: 'Invalid gamelogs file format',
        filePath: absolutePath,
        details: 'File must contain an array of game logs, or an object with "gamelogs" or "data" property containing an array',
      };
      throw error;
    }

    if (gameLogs.length === 0) {
      const error: LoadGameLogsError = {
        error: 'Gamelogs file contains no records',
        filePath: absolutePath,
        details: 'The file is valid but the array is empty',
      };
      throw error;
    }

    return {
      gameLogs,
      filePath: absolutePath,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'error' in error) {
      // Already a LoadGameLogsError, re-throw
      throw error;
    }
    
    // JSON parse error or other error
    const parseError: LoadGameLogsError = {
      error: 'Failed to parse gamelogs file',
      filePath: absolutePath,
      details: error instanceof Error ? error.message : String(error),
    };
    throw parseError;
  }
}

