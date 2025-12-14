'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ImportedOdd {
  playerName: string;
  statType: string;
  line: number;
  overOdds?: number;
  underOdds?: number;
  book: string;
  overImpliedProb?: number;
  underImpliedProb?: number;
  fairImpliedProb?: number;
}

interface MatchedLeg {
  importedOdd: ImportedOdd;
  modelLeg: {
    playerId: string;
    playerName?: string;
    statType: string;
    threshold: number;
    smoothedProb: number;
    confidence: string;
    sampleSize: number;
  };
  edge: number;
  lineDiff: number;
}

export default function OddsImport() {
  const [csvInput, setCsvInput] = useState('');
  const [importedOdds, setImportedOdds] = useState<ImportedOdd[]>([]);
  const [modelLegs, setModelLegs] = useState<any[]>([]);
  const [matchedLegs, setMatchedLegs] = useState<MatchedLeg[]>([]);
  const [selectedLegs, setSelectedLegs] = useState<MatchedLeg[]>([]);
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState(2024);
  const [week, setWeek] = useState(1);

  // Fetch current week (for default values)
  useEffect(() => {
    const fetchWeek = async () => {
      try {
        const response = await fetch('/api/week');
        if (response.ok) {
          const data = await response.json();
          if (data.week && week === 1) {
            setWeek(data.week);
          }
          if (data.season && season === 2024) {
            setSeason(data.season);
          }
        }
      } catch (error) {
        console.error('Error fetching week:', error);
      }
    };
    fetchWeek();
  }, []);

  // Convert American odds to implied probability
  const oddsToImpliedProb = (odds: number): number => {
    if (odds > 0) {
      return 100 / (odds + 100);
    } else {
      return Math.abs(odds) / (Math.abs(odds) + 100);
    }
  };

  // De-vig: remove bookmaker margin when both sides are present
  const devig = (overProb: number, underProb: number): number => {
    const totalProb = overProb + underProb;
    if (totalProb > 0) {
      // Normalize to sum to 1.0 (fair probabilities)
      return overProb / totalProb;
    }
    return overProb;
  };

  // Parse CSV input
  const parseCSV = (csvText: string): ImportedOdd[] => {
    const lines = csvText.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    // Parse header
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
    
    const requiredColumns = ['playername', 'stattype', 'line'];
    const hasRequired = requiredColumns.every(col => headers.includes(col));
    
    if (!hasRequired) {
      throw new Error(`CSV must contain columns: ${requiredColumns.join(', ')}`);
    }

    const playerNameIdx = headers.indexOf('playername');
    const statTypeIdx = headers.indexOf('stattype');
    const lineIdx = headers.indexOf('line');
    const overOddsIdx = headers.indexOf('overodds');
    const underOddsIdx = headers.indexOf('underodds');
    const bookIdx = headers.indexOf('book');

    const odds: ImportedOdd[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row.trim()) continue;

      // Simple CSV parsing (handles quoted fields)
      const values: string[] = [];
      let currentValue = '';
      let inQuotes = false;
      
      for (let j = 0; j < row.length; j++) {
        const char = row[j];
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

      const playerName = values[playerNameIdx]?.trim() || '';
      const statType = values[statTypeIdx]?.trim() || '';
      const lineStr = values[lineIdx]?.trim() || '';
      const overOddsStr = overOddsIdx >= 0 ? values[overOddsIdx]?.trim() : '';
      const underOddsStr = underOddsIdx >= 0 ? values[underOddsIdx]?.trim() : '';
      const book = bookIdx >= 0 ? values[bookIdx]?.trim() : 'Unknown';

      if (!playerName || !statType || !lineStr) continue;

      const lineValue = parseFloat(lineStr);
      if (isNaN(lineValue)) continue;

      const overOdds = overOddsStr ? parseFloat(overOddsStr) : undefined;
      const underOdds = underOddsStr ? parseFloat(underOddsStr) : undefined;

      // Convert odds to implied probabilities
      const overImpliedProb = overOdds !== undefined ? oddsToImpliedProb(overOdds) : undefined;
      const underImpliedProb = underOdds !== undefined ? oddsToImpliedProb(underOdds) : undefined;

      // De-vig if both sides present
      let fairImpliedProb: number | undefined;
      if (overImpliedProb !== undefined && underImpliedProb !== undefined) {
        fairImpliedProb = devig(overImpliedProb, underImpliedProb);
      } else if (overImpliedProb !== undefined) {
        fairImpliedProb = overImpliedProb;
      } else if (underImpliedProb !== undefined) {
        fairImpliedProb = 1 - underImpliedProb; // For under, we want the complement
      }

      odds.push({
        playerName,
        statType,
        line: lineValue,
        overOdds,
        underOdds,
        book,
        overImpliedProb,
        underImpliedProb,
        fairImpliedProb,
      });
    }

    return odds;
  };

  // Normalize player name for matching
  const normalizePlayerName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[.,'"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Normalize stat type for matching
  const normalizeStatType = (statType: string): string => {
    const normalized = statType.toLowerCase().trim();
    // Map common variations
    const mappings: Record<string, string> = {
      'passing yards': 'pass_yards',
      'pass yards': 'pass_yards',
      'rushing yards': 'rush_yards',
      'rush yards': 'rush_yards',
      'receiving yards': 'rec_yards',
      'rec yards': 'rec_yards',
      'receptions': 'receptions',
      'rec': 'receptions',
      'passing tds': 'pass_tds',
      'pass tds': 'pass_tds',
      'passing touchdowns': 'pass_tds',
    };
    return mappings[normalized] || normalized;
  };

  // Find closest line match
  const findClosestLine = (target: number, candidates: number[]): { line: number; diff: number } => {
    if (candidates.length === 0) {
      return { line: target, diff: Infinity };
    }
    let closest = candidates[0];
    let minDiff = Math.abs(candidates[0] - target);
    for (const candidate of candidates) {
      const diff = Math.abs(candidate - target);
      if (diff < minDiff) {
        minDiff = diff;
        closest = candidate;
      }
    }
    return { line: closest, diff: minDiff };
  };

  // Match imported odds to model legs
  const matchOddsToLegs = async () => {
    if (importedOdds.length === 0) return;

    setLoading(true);
    try {
      // Fetch model legs using selected season/week
      const legsParams = new URLSearchParams({
        minProb: '0',
        lastN: '6',
        season: season.toString(),
        week: week.toString(),
      });

      const legsResponse = await fetch(`/api/legs?${legsParams}`);
      if (!legsResponse.ok) {
        throw new Error('Failed to fetch model legs');
      }

      const legsData = await legsResponse.json();
      const legs = legsData.legs || [];
      setModelLegs(legs);

      // Match imported odds to model legs
      const matches: MatchedLeg[] = [];

      for (const odd of importedOdds) {
        const normalizedName = normalizePlayerName(odd.playerName);
        const normalizedStatType = normalizeStatType(odd.statType);

        // Find matching player and stat type
        const candidateLegs = legs.filter((leg: any) => {
          const legName = normalizePlayerName(leg.playerName || '');
          const legStatType = normalizeStatType(leg.statType);
          return legName === normalizedName && legStatType === normalizedStatType;
        });

        if (candidateLegs.length === 0) continue;

        // Find closest line match
        const thresholds = candidateLegs.map((leg: any) => leg.threshold);
        const { line: closestLine, diff: lineDiff } = findClosestLine(odd.line, thresholds);

        // Get the leg with the closest threshold
        const matchedLeg = candidateLegs.find((leg: any) => leg.threshold === closestLine);
        if (!matchedLeg) continue;

        // Calculate edge (model probability - fair implied probability)
        if (odd.fairImpliedProb !== undefined) {
          const edge = matchedLeg.smoothedProb - odd.fairImpliedProb;
          matches.push({
            importedOdd: odd,
            modelLeg: matchedLeg,
            edge,
            lineDiff,
          });
        }
      }

      // Sort by edge (descending - best edges first)
      matches.sort((a, b) => b.edge - a.edge);
      setMatchedLegs(matches);
    } catch (error) {
      console.error('Error matching odds to legs:', error);
      alert(`Error matching odds: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle CSV import
  const handleImport = () => {
    try {
      const odds = parseCSV(csvInput);
      setImportedOdds(odds);
      if (odds.length > 0) {
        // Auto-match after import
        setTimeout(() => matchOddsToLegs(), 100);
      }
    } catch (error) {
      alert(`Error parsing CSV: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Toggle leg selection
  const toggleLegSelection = (leg: MatchedLeg) => {
    const index = selectedLegs.findIndex(
      l => l.importedOdd.playerName === leg.importedOdd.playerName &&
           l.importedOdd.statType === leg.importedOdd.statType &&
           l.importedOdd.line === leg.importedOdd.line
    );
    
    if (index >= 0) {
      setSelectedLegs(selectedLegs.filter((_, i) => i !== index));
    } else {
      setSelectedLegs([...selectedLegs, leg]);
    }
  };

  const formatProbability = (prob: number) => {
    return `${(prob * 100).toFixed(1)}%`;
  };

  const formatEdge = (edge: number) => {
    const sign = edge >= 0 ? '+' : '';
    return `${sign}${(edge * 100).toFixed(1)}%`;
  };

  const getEdgeColor = (edge: number) => {
    if (edge >= 0.05) return '#28a745'; // Green - strong edge
    if (edge >= 0.02) return '#007bff'; // Blue - moderate edge
    if (edge >= 0) return '#ffc107'; // Yellow - small edge
    return '#dc3545'; // Red - negative edge
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/" style={{ color: '#0066cc', textDecoration: 'none' }}>
          ← Back to Parlay Finder
        </Link>
        <h1>Odds Import</h1>
        <p>Import betting odds from CSV and find edges against our model</p>
      </div>

      {/* Season/Week Controls */}
      <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <label style={{ marginRight: '20px' }}>
          Season: 
          <input
            type="number"
            min="2000"
            max="2100"
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value, 10) || 2024)}
            style={{ marginLeft: '10px', width: '80px' }}
          />
        </label>
        <label>
          Week: 
          <input
            type="number"
            min="1"
            max="18"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)}
            style={{ marginLeft: '10px', width: '60px' }}
          />
        </label>
      </div>

      {/* CSV Input */}
      <div style={{ marginBottom: '20px' }}>
        <h2>Import CSV</h2>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
          Required columns: playerName, statType, line, overOdds (optional), underOdds (optional), book (optional)
        </p>
        <textarea
          value={csvInput}
          onChange={(e) => setCsvInput(e.target.value)}
          placeholder="Paste CSV data here..."
          style={{
            width: '100%',
            minHeight: '200px',
            padding: '10px',
            fontFamily: 'monospace',
            fontSize: '12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        <button
          onClick={handleImport}
          disabled={!csvInput.trim() || loading}
          style={{
            marginTop: '10px',
            padding: '10px 20px',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Processing...' : 'Import & Match'}
        </button>
      </div>

      {/* Imported Odds Summary */}
      {importedOdds.length > 0 && (
        <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <strong>Imported: {importedOdds.length} odds</strong>
        </div>
      )}

      {/* Matched Legs Table */}
      {matchedLegs.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h2>Matched Legs (sorted by edge)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Select</th>
                  <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Player</th>
                  <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Stat</th>
                  <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd' }}>Line</th>
                  <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd' }}>Model Prob</th>
                  <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd' }}>Fair Implied</th>
                  <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd' }}>Edge</th>
                  <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Book</th>
                  <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {matchedLegs.map((match, idx) => {
                  const isSelected = selectedLegs.some(
                    l => l.importedOdd.playerName === match.importedOdd.playerName &&
                         l.importedOdd.statType === match.importedOdd.statType &&
                         l.importedOdd.line === match.importedOdd.line
                  );
                  return (
                    <tr
                      key={idx}
                      onClick={() => toggleLegSelection(match)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSelected ? '#e6f2ff' : idx % 2 === 0 ? 'white' : '#f8f9fa',
                        borderBottom: '1px solid #ddd',
                      }}
                    >
                      <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleLegSelection(match)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                        {match.modelLeg.playerName || match.importedOdd.playerName}
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                        {match.importedOdd.statType}
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'right' }}>
                        {match.importedOdd.line}
                        {match.lineDiff > 0 && (
                          <span style={{ fontSize: '11px', color: '#666', marginLeft: '5px' }}>
                            (diff: {match.lineDiff.toFixed(1)})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'right' }}>
                        {formatProbability(match.modelLeg.smoothedProb)}
                        <span style={{ fontSize: '11px', color: '#666', marginLeft: '5px' }}>
                          ({match.modelLeg.confidence})
                        </span>
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'right' }}>
                        {match.importedOdd.fairImpliedProb !== undefined
                          ? formatProbability(match.importedOdd.fairImpliedProb)
                          : 'N/A'}
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'right' }}>
                        <span style={{ color: getEdgeColor(match.edge), fontWeight: 'bold' }}>
                          {formatEdge(match.edge)}
                        </span>
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                        {match.importedOdd.book}
                      </td>
                      <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                        {match.modelLeg.confidence}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Legs */}
      {selectedLegs.length > 0 && (
        <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #0066cc', borderRadius: '5px', backgroundColor: '#e6f2ff' }}>
          <h3>Selected Legs ({selectedLegs.length})</h3>
          <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
            {selectedLegs.map((leg, idx) => (
              <li key={idx} style={{ marginBottom: '5px' }}>
                {leg.modelLeg.playerName || leg.importedOdd.playerName} - {leg.importedOdd.statType} {leg.importedOdd.line}+
                {' '}(Model: {formatProbability(leg.modelLeg.smoothedProb)}, Edge: {formatEdge(leg.edge)})
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>
            Go to <Link href="/" style={{ color: '#0066cc' }}>Parlay Finder</Link> to build parlays with these legs.
          </p>
        </div>
      )}

      {/* No matches message */}
      {importedOdds.length > 0 && matchedLegs.length === 0 && !loading && (
        <div style={{ padding: '15px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
          <p style={{ margin: 0, color: '#856404' }}>
            No matches found. Ensure player names and stat types match the model's format.
          </p>
        </div>
      )}
    </div>
  );
}

