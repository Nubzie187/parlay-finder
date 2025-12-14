'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Leg {
  playerId: string;
  playerName?: string;
  statType: string;
  threshold: number;
  probability?: number; // Legacy field
  smoothedProb?: number;
  rawProb?: number;
  confidence?: 'Speculative' | 'Fair' | 'Strong' | 'Elite';
  gameId?: string;
  team?: string;
  position?: string;
  reason?: string;
}

interface PenaltyBreakdown {
  type: string;
  amount: number;
  reason: string;
}

interface Parlay {
  legs: Leg[];
  estimatedProbability: number;
  estProbability?: number;
  penaltyBreakdown?: PenaltyBreakdown[];
}

interface Game {
  gameId: string;
  team1?: string;
  team2?: string;
  gameDate?: string;
}

export default function Home() {
  const [legCount, setLegCount] = useState(4);
  const [singleGame, setSingleGame] = useState(false);
  const [gameId, setGameId] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedLegs, setSelectedLegs] = useState<Leg[]>([]);
  const [candidateLegs, setCandidateLegs] = useState<Leg[]>([]);
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(false);
  const [minLegProb, setMinLegProb] = useState(0.70);
  const [lastNGames, setLastNGames] = useState(8);
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [season, setSeason] = useState(2024);
  const [week, setWeek] = useState(1);
  const [parlayProb, setParlayProb] = useState<{
    baseProbability?: number;
    estProbability?: number;
    penaltyBreakdown?: PenaltyBreakdown[];
  } | null>(null);
  const [roundRobinSize, setRoundRobinSize] = useState<2 | 3 | null>(null);
  const [roundRobinCombos, setRoundRobinCombos] = useState<Array<{
    legs: Leg[];
    minProb: number;
    maxProb: number;
    avgProb: number;
  }>>([]);
  const [noCandidateLegs, setNoCandidateLegs] = useState(false);

  // Fetch game slate and current week
  useEffect(() => {
    const fetchSlate = async () => {
      try {
        const response = await fetch('/api/week?slate=true');
        const data = await response.json();
        if (data.slate) {
          setGames(data.slate);
        }
        if (data.week) {
          setCurrentWeek(data.week);
          // Set default week if not already set
          if (week === 1) {
            setWeek(data.week);
          }
        }
        if (data.season) {
          // Set default season if not already set
          if (season === 2024) {
            setSeason(data.season);
          }
        }
      } catch (error) {
        console.error('Error fetching slate:', error);
      }
    };
    fetchSlate();
  }, []);

  // Auto-update legCount in Manual mode based on selectedLegs
  useEffect(() => {
    if (mode === 'manual') {
      setLegCount(selectedLegs.length);
    }
  }, [selectedLegs, mode]);

  // Calculate parlay for selected legs (manual mode)
  useEffect(() => {
    const calculateManualParlay = async () => {
      // Block if fewer than 2 legs selected
      if (selectedLegs.length < 2) {
        setParlayProb(null);
        return;
      }

      // Filter by gameId if SGP
      let legsToUse = selectedLegs;
      if (singleGame && gameId) {
        legsToUse = selectedLegs.filter(leg => leg.gameId === gameId);
      }

      if (legsToUse.length < 2) {
        setParlayProb(null);
        return;
      }

      try {
        // Use /api/parlay-prob to get baseProbability, estProbability, and penaltyBreakdown
        const response = await fetch('/api/parlay-prob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legs: legsToUse.map(leg => ({
              playerId: leg.playerId,
              gameId: leg.gameId,
              team: leg.team,
              market: leg.statType,
              threshold: leg.threshold,
              probability: leg.smoothedProb || leg.probability, // Use smoothedProb for calculations
            })),
          }),
        });
        const data = await response.json();
        if (data.estProbability !== undefined) {
          setParlayProb({
            baseProbability: data.baseProbability,
            estProbability: data.estProbability,
            penaltyBreakdown: data.penaltyBreakdown,
          });
        } else {
          setParlayProb(null);
        }
      } catch (error) {
        console.error('Error calculating parlay:', error);
        setParlayProb(null);
      }
    };

    if (mode === 'manual') {
      calculateManualParlay();
    }
  }, [selectedLegs, singleGame, gameId, mode]);


  const handleLegClick = (leg: Leg) => {
    if (singleGame && gameId && leg.gameId !== gameId) {
      return; // Don't allow selecting legs from different game in SGP mode
    }

    const index = selectedLegs.findIndex(
      l => l.playerId === leg.playerId && l.statType === leg.statType && l.threshold === leg.threshold
    );
    
    if (index >= 0) {
      setSelectedLegs(selectedLegs.filter((_, i) => i !== index));
    } else {
      setSelectedLegs([...selectedLegs, leg]);
    }
  };

  const handleGenerateParlays = async () => {
    // Only handle Auto mode here
    if (mode !== 'auto') {
      return;
    }

    setLoading(true);
    setNoCandidateLegs(false);
    setParlays([]);

    try {
      // Build query params for bulk leg fetch using selected season/week
      const legsParams = new URLSearchParams({
        minProb: minLegProb.toString(),
        lastN: lastNGames.toString(),
        season: season.toString(),
        week: week.toString(),
      });
      // If SGP is enabled, filter legs by gameId
      if (singleGame && gameId) {
        // Note: /api/legs doesn't support gameId filter directly, but we'll filter client-side
        // The API will return all legs, and we'll filter by gameId if needed
      }

      // Always fetch candidate legs from /api/legs in Auto mode
      const legsResponse = await fetch(`/api/legs?${legsParams}`);
      if (!legsResponse.ok) {
        const errorData = await legsResponse.json();
        throw new Error(errorData.error || 'Failed to fetch legs');
      }

      const legsData = await legsResponse.json();
      let fetchedLegs: Leg[] = [];
      
      if (legsData.legs && Array.isArray(legsData.legs)) {
        fetchedLegs = legsData.legs;
      }

      // If SGP is enabled, filter legs by gameId
      if (singleGame && gameId) {
        fetchedLegs = fetchedLegs.filter(leg => leg.gameId === gameId);
      }

      // Store fetched legs in state
      setCandidateLegs(fetchedLegs);

      // If no legs found, show inline message and return early
      if (!fetchedLegs || fetchedLegs.length === 0) {
        setNoCandidateLegs(true);
        setLoading(false);
        return;
      }

      // Build query params for parlay options
      const params = new URLSearchParams({
        legCount: legCount.toString(),
        minLegProb: minLegProb.toString(),
      });

      if (singleGame) {
        params.append('singleGame', 'true');
        if (gameId) {
          params.append('gameId', gameId);
        }
      }

      // POST request with legs in body (use exact legs from /api/legs response)
      const response = await fetch(`/api/parlay?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          legs: fetchedLegs, // Use exact legs from /api/legs, not candidateLegs or selectedLegs
          legCount: legCount,
          topN: 20,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.message || errorData.error || 'Failed to generate parlays';
        const debugInfo = errorData.debug ? 
          `\n\nDebug Info:\n- Leg Count: ${errorData.debug.legCount}\n- Min Leg Prob: ${errorData.debug.minLegProb}\n- Candidate Legs: ${errorData.debug.candidateLegsCount}\n- Sample Legs: ${JSON.stringify(errorData.debug.sampleLegs, null, 2)}` : '';
        const stackInfo = errorData.stack ? `\n\nStack Trace:\n${errorData.stack}` : '';
        throw new Error(errorMessage + debugInfo + stackInfo);
      }

      const data = await response.json();
      setParlays(data.parlays || []);
    } catch (error) {
      console.error('Error generating parlays:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error generating parlays';
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatProbability = (prob: number) => {
    return `${(prob * 100).toFixed(1)}%`;
  };

  const getConfidenceColor = (confidence?: string) => {
    switch (confidence) {
      case 'Elite': return '#28a745'; // Green
      case 'Strong': return '#007bff'; // Blue
      case 'Fair': return '#ffc107'; // Yellow
      case 'Speculative': return '#dc3545'; // Red
      default: return '#6c757d'; // Gray
    }
  };

  const getConfidenceBadgeStyle = (confidence?: string) => {
    const color = getConfidenceColor(confidence);
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '3px',
      fontSize: '11px',
      fontWeight: 'bold',
      color: 'white',
      backgroundColor: color,
      marginLeft: '8px',
    };
  };

  // Generate round-robin combinations
  const generateRoundRobin = (legs: Leg[], size: 2 | 3) => {
    const combinations: Leg[][] = [];
    
    const generateCombos = (arr: Leg[], size: number, start: number = 0, current: Leg[] = []) => {
      if (current.length === size) {
        combinations.push([...current]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        generateCombos(arr, size, i + 1, current);
        current.pop();
      }
    };

    generateCombos(legs, size);
    return combinations;
  };

  // Calculate probability range for round-robin combinations
  const calculateRoundRobinRanges = async (combinations: Leg[][]) => {
    const results = [];
    
    for (const combo of combinations) {
      try {
        const response = await fetch('/api/parlay-prob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legs: combo.map(leg => ({
              playerId: leg.playerId,
              gameId: leg.gameId,
              team: leg.team,
              market: leg.statType,
              threshold: leg.threshold,
              probability: leg.smoothedProb || leg.probability || 0,
            })),
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          const baseProb = data.baseProbability || 0;
          const estProb = data.estProbability || baseProb;
          
          results.push({
            legs: combo,
            minProb: estProb, // With penalties (conservative)
            maxProb: baseProb, // Without penalties (optimistic)
            avgProb: (estProb + baseProb) / 2,
          });
        }
      } catch (error) {
        console.error('Error calculating combo probability:', error);
      }
    }

    // Sort by avgProb descending
    results.sort((a, b) => b.avgProb - a.avgProb);
    return results;
  };

  // Handle round-robin generation
  const handleRoundRobin = async (size: 2 | 3) => {
    if (selectedLegs.length < size) {
      return;
    }

    setLoading(true);
    try {
      const combinations = generateRoundRobin(selectedLegs, size);
      const ranges = await calculateRoundRobinRanges(combinations);
      setRoundRobinSize(size);
      setRoundRobinCombos(ranges);
    } catch (error) {
      console.error('Error generating round-robin:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter candidate legs by minLegProb (using smoothedProb)
  const filteredCandidateLegs = candidateLegs.filter(leg => (leg.smoothedProb || leg.probability) >= minLegProb);

  return (
    <main style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Parlay Finder</h1>
        <Link href="/odds-import" style={{ color: '#0066cc', textDecoration: 'none', fontSize: '16px' }}>
          Odds Import →
        </Link>
      </div>

      {/* Controls */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Mode: 
            <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'manual')} style={{ marginLeft: '10px' }}>
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
          </label>
        </div>

        {mode === 'auto' && (
          <>
            <div style={{ marginBottom: '10px' }}>
              <label>
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
              <label style={{ marginLeft: '20px' }}>
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
            <div style={{ marginBottom: '10px' }}>
              <label>
                Min Leg Probability: 
                <input
                  type="number"
                  min="0.10"
                  max="0.95"
                  step="0.01"
                  value={minLegProb}
                  onChange={(e) => setMinLegProb(Math.max(0.10, Math.min(0.95, parseFloat(e.target.value) || 0.70)))}
                  style={{ marginLeft: '10px', width: '80px' }}
                />
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                  (Range: 0.10 - 0.95)
                </span>
              </label>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>
                Last N Games: 
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={lastNGames}
                  onChange={(e) => setLastNGames(Math.max(1, Math.min(16, parseInt(e.target.value) || 8)))}
                  style={{ marginLeft: '10px', width: '60px' }}
                />
              </label>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>
                Leg Count (2-8): 
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={legCount}
                  onChange={(e) => setLegCount(Math.max(2, Math.min(8, parseInt(e.target.value) || 2)))}
                  style={{ marginLeft: '10px', width: '60px' }}
                />
              </label>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label>
                <input
                  type="checkbox"
                  checked={singleGame}
                  onChange={(e) => {
                    setSingleGame(e.target.checked);
                    if (!e.target.checked) setGameId('');
                  }}
                />
                Single Game Parlay (SGP)
              </label>
            </div>

            {singleGame && (
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Game: 
                  <select
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    style={{ marginLeft: '10px' }}
                  >
                    <option value="">Select a game</option>
                    {games.map((game) => (
                      <option key={game.gameId} value={game.gameId}>
                        {game.team1} vs {game.team2} ({game.gameDate || game.gameId})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <button onClick={handleGenerateParlays} disabled={loading || (singleGame && !gameId)}>
                {loading ? 'Generating...' : 'Generate Parlays'}
              </button>
            </div>
          </>
        )}

        {mode === 'manual' && (
          <div>
            <p>Click legs below to add/remove from your parlay</p>
            <div style={{ marginBottom: '10px' }}>
              <label>
                Min Leg Probability: 
                <input
                  type="number"
                  min="0.10"
                  max="0.95"
                  step="0.01"
                  value={minLegProb}
                  onChange={(e) => setMinLegProb(Math.max(0.10, Math.min(0.95, parseFloat(e.target.value) || 0.70)))}
                  style={{ marginLeft: '10px', width: '80px' }}
                />
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                  (Range: 0.10 - 0.95)
                </span>
              </label>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>
                Leg Count: 
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={legCount}
                  disabled
                  style={{ marginLeft: '10px', width: '60px', backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
                />
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                  (Auto-set to {selectedLegs.length} selected leg{selectedLegs.length !== 1 ? 's' : ''})
                </span>
              </label>
            </div>
            {selectedLegs.length < 2 && (
              <div style={{ marginBottom: '10px', padding: '8px', backgroundColor: '#fff3cd', borderRadius: '3px', color: '#856404' }}>
                Please select at least 2 legs to calculate parlay probability
              </div>
            )}
            {singleGame && (
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Game: 
                  <select
                    value={gameId}
                    onChange={(e) => {
                      setGameId(e.target.value);
                      setSelectedLegs([]);
                    }}
                    style={{ marginLeft: '10px' }}
                  >
                    <option value="">Select a game</option>
                    {games.map((game) => (
                      <option key={game.gameId} value={game.gameId}>
                        {game.team1} vs {game.team2} ({game.gameDate || game.gameId})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Legs Panel (Manual Mode) */}
      {mode === 'manual' && selectedLegs.length > 0 && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #0066cc', borderRadius: '5px', backgroundColor: '#e6f2ff' }}>
          <h3>Selected Legs ({selectedLegs.length})</h3>
          {selectedLegs.map((leg, idx) => (
            <div key={idx} style={{ marginBottom: '5px', padding: '5px', backgroundColor: 'white', borderRadius: '3px' }}>
              <span>
                {leg.playerName || leg.playerId} - {leg.statType} {leg.threshold}+ ({formatProbability(leg.smoothedProb || leg.probability || 0)})
                {leg.confidence && (
                  <span style={getConfidenceBadgeStyle(leg.confidence)}>
                    {leg.confidence}
                  </span>
                )}
              </span>
              <button onClick={() => handleLegClick(leg)} style={{ marginLeft: '10px', fontSize: '12px' }}>Remove</button>
            </div>
          ))}
          {selectedLegs.length >= 2 && (
            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'white', borderRadius: '3px' }}>
              <div style={{ marginBottom: '10px' }}>
                <strong>Round-Robin Options:</strong>
                <div style={{ marginTop: '5px' }}>
                  <button 
                    onClick={() => handleRoundRobin(2)} 
                    disabled={loading || selectedLegs.length < 2}
                    style={{ marginRight: '10px', padding: '5px 10px' }}
                  >
                    {loading ? 'Generating...' : `Generate All ${selectedLegs.length}C2 Combinations`}
                  </button>
                  {selectedLegs.length >= 3 && (
                    <button 
                      onClick={() => handleRoundRobin(3)} 
                      disabled={loading || selectedLegs.length < 3}
                      style={{ padding: '5px 10px' }}
                    >
                      {loading ? 'Generating...' : `Generate All ${selectedLegs.length}C3 Combinations`}
                    </button>
                  )}
                </div>
              </div>
              
              {parlayProb && (
                <>
                  <div style={{ marginBottom: '5px' }}>
                    <strong>Base Probability: {formatProbability(parlayProb.baseProbability || 0)}</strong>
                  </div>
                  <div style={{ marginBottom: '5px' }}>
                    <strong>Estimated Probability: {formatProbability(parlayProb.estProbability || 0)}</strong>
                  </div>
                  <div style={{ marginTop: '5px' }}>
                    <strong>Correlation Penalties:</strong>
                    {parlayProb.penaltyBreakdown && parlayProb.penaltyBreakdown.length > 0 ? (
                      <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                        {parlayProb.penaltyBreakdown.map((penalty, idx) => (
                          <li key={idx}>
                            {penalty.reason} (-{formatProbability(penalty.amount)})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ marginTop: '5px', fontStyle: 'italic', color: '#666' }}>
                        No correlation penalties applied
                      </div>
                    )}
                  </div>
                </>
              )}

              {roundRobinCombos.length > 0 && (
                <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '3px' }}>
                  <strong>Round-Robin {roundRobinSize}-Leg Combinations ({roundRobinCombos.length} total):</strong>
                  <div style={{ marginTop: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                    {roundRobinCombos.map((combo, idx) => (
                      <div key={idx} style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'white', borderRadius: '3px', fontSize: '12px' }}>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Combo {idx + 1}:</strong> {combo.legs.map(l => l.playerName || l.playerId).join(' + ')}
                        </div>
                        <div style={{ color: '#666' }}>
                          Probability Range: {formatProbability(combo.minProb)} - {formatProbability(combo.maxProb)} 
                          (Avg: {formatProbability(combo.avgProb)})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Candidate Legs (for demo - would come from API) */}
      {mode === 'manual' && candidateLegs.length === 0 && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
          <p>Load candidate legs from /api/legs endpoint</p>
          <button onClick={() => {
            // Demo: Add some sample legs (filtered by minLegProb)
            const sampleLegs = [
              { playerId: '1', playerName: 'Player 1', statType: 'rush_yards', threshold: 100, probability: 0.85, gameId: 'game1', team: 'KC', position: 'RB' },
              { playerId: '2', playerName: 'Player 2', statType: 'rec_yards', threshold: 75, probability: 0.80, gameId: 'game1', team: 'KC', position: 'WR' },
              { playerId: '3', playerName: 'Player 3', statType: 'pass_yards', threshold: 250, probability: 0.75, gameId: 'game2', team: 'BUF', position: 'QB' },
            ];
            setCandidateLegs(sampleLegs.filter(leg => (leg.smoothedProb || leg.probability) >= minLegProb));
          }}>
            Load Sample Legs
          </button>
        </div>
      )}

      {/* Leg Selection (Manual Mode) */}
      {mode === 'manual' && candidateLegs.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Available Legs (min probability: {formatProbability(minLegProb)})</h3>
          {filteredCandidateLegs.length === 0 ? (
            <div style={{ padding: '10px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', marginBottom: '10px' }}>
              <p style={{ margin: 0, color: '#856404' }}>
                No legs found at this probability threshold ({formatProbability(minLegProb)}).
              </p>
            </div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }}>
            {filteredCandidateLegs
              .filter(leg => !singleGame || !gameId || leg.gameId === gameId)
              .map((leg, idx) => {
                const isSelected = selectedLegs.some(
                  l => l.playerId === leg.playerId && l.statType === leg.statType && l.threshold === leg.threshold
                );
                return (
                  <div
                    key={idx}
                    onClick={() => handleLegClick(leg)}
                    style={{
                      padding: '10px',
                      border: `2px solid ${isSelected ? '#0066cc' : '#ccc'}`,
                      borderRadius: '5px',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? '#e6f2ff' : 'white',
                    }}
                  >
                    <div><strong>{leg.playerName || leg.playerId}</strong> ({leg.position})</div>
                    <div>{leg.statType} {leg.threshold}+</div>
                    <div>
                      Probability: {formatProbability(leg.smoothedProb || leg.probability || 0)}
                      {leg.confidence && (
                        <span style={getConfidenceBadgeStyle(leg.confidence)}>
                          {leg.confidence}
                        </span>
                      )}
                    </div>
                    {leg.reason && <div style={{ fontSize: '12px', marginTop: '5px', color: '#666' }}>{leg.reason}</div>}
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* No Candidate Legs Message (Auto Mode) */}
      {mode === 'auto' && noCandidateLegs && !loading && (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
          <p style={{ margin: 0, color: '#856404', fontWeight: 'bold' }}>
            No candidate legs found
          </p>
          <p style={{ margin: '5px 0 0 0', color: '#856404', fontSize: '14px' }}>
            Try lowering the minimum leg probability threshold or adjusting other filters.
          </p>
        </div>
      )}

      {/* Parlays List */}
      {parlays.length > 0 && (
        <div>
          <h2>Suggested Parlays ({parlays.length})</h2>
          {parlays.map((parlay, idx) => (
            <div key={idx} style={{ marginBottom: '15px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px' }}>
              <h3>Parlay #{idx + 1}</h3>
              <div style={{ marginBottom: '10px' }}>
                <strong>Estimated Probability: {formatProbability(parlay.estProbability || parlay.estimatedProbability)}</strong>
              </div>
              {parlay.penaltyBreakdown && parlay.penaltyBreakdown.length > 0 && (
                <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '3px' }}>
                  <strong>Penalty Breakdown:</strong>
                  <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                    {parlay.penaltyBreakdown.map((penalty, pIdx) => (
                      <li key={pIdx}>
                        {penalty.reason} (-{formatProbability(penalty.amount)})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <strong>Legs:</strong>
                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                  {parlay.legs.map((leg, lIdx) => (
                    <li key={lIdx}>
                      {leg.playerName || leg.playerId} - {leg.statType} {leg.threshold}+ ({formatProbability(leg.smoothedProb || leg.probability)})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
