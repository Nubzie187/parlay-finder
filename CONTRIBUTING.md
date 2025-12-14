# Contributing to Parlay Finder

## Important Guidelines

### No Scraping of Protected Sportsbooks

- **Do not implement scraping functionality** for any sportsbook websites
- Odds data must come from **user input** (CSV import) or **licensed APIs** only
- Any automated data collection from sportsbook websites is strictly prohibited

### Data Sources

- Odds data must be provided by users via CSV import or through licensed API integrations
- Keep the project compliant with sportsbook terms of service
- Respect rate limits and usage restrictions of any APIs used

### Code Standards

- Use generic terms like `book`, `sportsbook`, or `oddsProvider` instead of specific sportsbook names
- Keep sportsbook-specific naming only in sample CSVs or README examples, not in core logic or comments
- Maintain professional and neutral language throughout the codebase

