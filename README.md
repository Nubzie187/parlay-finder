# Parlay Finder

A Next.js App Router project with API routes and file-based caching.

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── players/route.ts      # /api/players endpoint
│   │   ├── gamelogs/route.ts     # /api/gamelogs endpoint
│   │   ├── legs/route.ts         # /api/legs endpoint
│   │   └── parlay/route.ts       # /api/parlay endpoint
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Home page
├── lib/
│   └── cache.ts                  # Cache helper utility
├── data/
│   └── cache/                    # Cache storage directory
└── package.json
```

## Cache Helper

The cache helper (`lib/cache.ts`) provides a simple file-based caching system with TTL (Time To Live) support:

- `getCache<T>(key: string): T | null` - Retrieve cached data
- `setCache<T>(key: string, data: T, ttlMs: number): void` - Store data with TTL in milliseconds
- `deleteCache(key: string): void` - Delete a specific cache entry
- `clearCache(): void` - Clear all cache files

Cache files are stored in `data/cache/` as JSON files. Expired entries are automatically cleaned up on read.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Access the API routes:
- `GET/POST /api/players`
- `GET/POST /api/gamelogs`
- `GET/POST /api/legs`
- `GET/POST /api/parlay`

## API Routes

All API routes currently return placeholder responses. Implement the business logic as needed.

