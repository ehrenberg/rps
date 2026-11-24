import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBracket, roundTitle, matchStatus, tournamentRole, MATCH_STATUS, tournamentKey, myLiveMatchId, shouldScrollToMatch } from '../../public/assets/js/bracket.js';

const P = (id, name, extra = {}) => ({ id, name, online: true, spectator: false, left: false, ...extra });
const M = (id, p, extra = {}) => ({ id, p, score: [0, 0], target: 2, cur: {}, history: [], winner: null, end: null, from: null, ...extra });

/** 5 Spieler: R1 = m1 (A–B), m2 (C–D), m3 (E–Freilos); R2 = m4 (m1/m2), m5 (m3/–); R3 = m6 (m4/m5) */
function fiveState(overrides = {}) {
  return {
    players: [P('a', 'Anna'), P('b', 'Ben'), P('c', 'Cem'), P('d', 'Dora'), P('e', 'Eli')],
    bracket: [['m1', 'm2', 'm3'], ['m4', 'm5'], ['m6']],
    matches: {
      m1: M('m1', ['a', 'b'], { score: [2, 1], winner: 0, end: 'score' }),
      m2: M('m2', ['c', 'd'], { score: [1, 0] }),
      m3: M('m3', ['e', null], { winner: 0, end: 'bye' }),
      m4: M('m4', ['a', null], { from: ['m1', 'm2'] }),
      m5: M('m5', ['e', null], { from: ['m3', null] }),
      m6: M('m6', [null, null], { from: ['m4', 'm5'] }),
    },
    myMatch: null,
    champion: null,
    ...overrides,
  };
}

test('roundTitle: von hinten benannt', () => {
  assert.equal(roundTitle(2, 3), 'Finale');
  assert.equal(roundTitle(1, 3), 'Halbfinale');
  assert.equal(roundTitle(0, 3), 'Viertelfinale');
  assert.equal(roundTitle(0, 6), 'Runde 1');
  assert.equal(roundTitle(0, 1), 'Finale');
});

test('matchStatus: Freilos, fertig, läuft, offen', () => {
  const s = fiveState();
  assert.equal(matchStatus(s.matches.m3), MATCH_STATUS.BYE);
  assert.equal(matchStatus(s.matches.m1), MATCH_STATUS.DONE);
  assert.equal(matchStatus(s.matches.m2), MATCH_STATUS.LIVE);
  assert.equal(matchStatus(s.matches.m4), MATCH_STATUS.PENDING);
  assert.equal(matchStatus(M('x', ['a', 'b'], { end: 'leave', winner: null })), MATCH_STATUS.DONE);
});

test('buildBracket: Runden, Titel, Slots, Platzhalter, eigenes Match', () => {
  const b = buildBracket(fiveState(), 'c');
  assert.deepEqual(b.rounds.map((r) => r.title), ['Viertelfinale', 'Halbfinale', 'Finale']);
  assert.deepEqual(b.rounds.map((r) => r.matches.length), [3, 2, 1]);
  const [m1, m2, m3] = b.rounds[0].matches;
  assert.equal(m1.label, 'Spiel 1');
  assert.deepEqual(m1.slots.map((s) => [s.name, s.score, s.won]), [['Anna', 2, true], ['Ben', 1, false]]);
  assert.equal(m2.mine, true);
  assert.equal(m2.slots[0].me, true);
  assert.equal(m3.slots[1].placeholder, 'Freilos');
  assert.equal(m3.slots[0].score, null, 'Freilos ohne Punkte');
  const m4 = b.rounds[1].matches[0];
  assert.equal(m4.slots[0].name, 'Anna');
  assert.equal(m4.slots[1].placeholder, 'Sieger Spiel 2');
  assert.equal(b.rounds[2].matches[0].slots[1].placeholder, 'Sieger Spiel 5');
  assert.equal(b.champion, null);
});

test('buildBracket: Champion, gegangene Spieler, leerer Baum', () => {
  const s = fiveState({ champion: 'e', players: [...fiveState().players.slice(0, 4), P('e', 'Eli', { left: true })] });
  const b = buildBracket(s, null);
  assert.deepEqual(b.champion, { id: 'e', name: 'Eli' });
  assert.equal(b.rounds[0].matches[2].slots[0].left, true);
  assert.deepEqual(buildBracket({ players: [], matches: {} }, 'a'), { rounds: [], champion: null });
});

test('tournamentRole: Zuschauer, spielt, wartet, ausgeschieden, Champion', () => {
  const s = fiveState();
  assert.equal(tournamentRole(s, 'z'), 'spectator');
  assert.equal(tournamentRole({ ...s, myMatch: 'm2' }, 'c'), 'playing');
  assert.equal(tournamentRole(s, 'a'), 'waiting');
  assert.equal(tournamentRole(s, 'e'), 'waiting', 'Freilos = weiter');
  assert.equal(tournamentRole(s, 'b'), 'out');
  assert.equal(tournamentRole({ ...s, champion: 'a' }, 'a'), 'champion');
});

test('tournamentKey: gleich für dasselbe Turnier, neu für ein neues Turnier im selben Raum', () => {
  assert.equal(tournamentKey({ bracket: [['m1', 'm2'], ['m3']] }), 't:m1,m2,m3');
  assert.notEqual(tournamentKey({ bracket: [['m4', 'm5'], ['m6']] }), tournamentKey({ bracket: [['m1', 'm2'], ['m3']] }));
  assert.equal(tournamentKey({}), 't:');
});

test('myLiveMatchId: eigenes laufendes Match im Baum, sonst null', () => {
  const live = { rounds: [{ matches: [{ id: 'm1', mine: false, status: 'live' }, { id: 'm2', mine: true, status: 'live' }] }] };
  assert.equal(myLiveMatchId(live), 'm2');
  const done = { rounds: [{ matches: [{ id: 'm2', mine: true, status: 'done' }] }] };
  assert.equal(myLiveMatchId(done), null);
});

test('shouldScrollToMatch: nur beim ersten Rendern bzw. wenn sich das eigene Match ändert', () => {
  assert.equal(shouldScrollToMatch(undefined, 'm2'), true, 'erstes Rendern');
  assert.equal(shouldScrollToMatch('m2', 'm2'), false, 'jede neue Version: nicht herumreißen');
  assert.equal(shouldScrollToMatch('m2', 'm5'), true);
  assert.equal(shouldScrollToMatch('m2', null), false);
});
