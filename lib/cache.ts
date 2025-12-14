import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Initialize cache directory if it doesn't exist
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Get cache file path for a given key
 */
function getCacheFilePath(key: string): string {
  const sanitizedKey = key.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(CACHE_DIR, `${sanitizedKey}.json`);
}

/**
 * Read data from cache if it exists and hasn't expired
 */
export function getCache<T>(key: string): T | null {
  ensureCacheDir();
  
  const filePath = getCacheFilePath(key);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const entry: CacheEntry<T> = JSON.parse(fileContent);
    
    // Check if cache has expired
    if (Date.now() > entry.expiresAt) {
      // Delete expired cache file
      fs.unlinkSync(filePath);
      return null;
    }
    
    return entry.data;
  } catch (error) {
    console.error(`Error reading cache for key "${key}":`, error);
    return null;
  }
}

/**
 * Write data to cache with TTL (time to live) in milliseconds
 */
export function setCache<T>(key: string, data: T, ttlMs: number): void {
  ensureCacheDir();
  
  const filePath = getCacheFilePath(key);
  const entry: CacheEntry<T> = {
    data,
    expiresAt: Date.now() + ttlMs,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing cache for key "${key}":`, error);
  }
}

/**
 * Delete a cache entry
 */
export function deleteCache(key: string): void {
  const filePath = getCacheFilePath(key);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Error deleting cache for key "${key}":`, error);
    }
  }
}

/**
 * Clear all cache files
 */
export function clearCache(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    return;
  }

  try {
    const files = fs.readdirSync(CACHE_DIR);
    files.forEach((file) => {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
}

