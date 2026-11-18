'use strict';
/* =====================================================================
   PROGRESSION: profile, XP + levels, missions, inventory, loadout, drops.
   Everything is saved in localStorage on this computer.
   ===================================================================== */
const XP_PER_LEVEL = 1200, MAX_LEVEL = 40;
let PROFILE = null;
function defaultProfile() {
  return {
    name: 'You', rating: 1000, wins: 0, losses: 0, draws: 0, matches: 0, kills: 0, deaths: 0,
    xp: 0, level: 1, inventory: [], newItems: [],
    equipped: { knife: { T: null, CT: null }, finishes: {} },
    missions: [], missionsDay: '',
  };
}
function loadProgress() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('strikepoint3d_profile') || 'null'); } catch (e) { p = null; }
  PROFILE = Object.assign(defaultProfile(), p || {});
  PROFILE.equipped = Object.assign({ knife: { T: null, CT: null }, finishes: {} }, PROFILE.equipped || {});
  PROFILE.inventory = (PROFILE.inventory || []).filter((id) => { try { itemName(id); return true; } catch (e) { return false; } });
  if (!PROFILE.inventory.length) { // starter items
    PROFILE.inventory.push('w:ak47:sandstorm', 'w:usp:nightops', 'k:bayonet:nightops');
    PROFILE.newItems = PROFILE.inventory.slice();
  }
  refreshMissions();
  saveProgress();
}
function saveProgress() { try { localStorage.setItem('strikepoint3d_profile', JSON.stringify(PROFILE)); } catch (e) { /* ignore */ } }
const levelProgress = () => (PROFILE.level >= MAX_LEVEL ? 1 : (PROFILE.xp % XP_PER_LEVEL) / XP_PER_LEVEL);

// ---------------------------------------------------------- missions
const MISSION_TYPES = [
  { kind: 'roundwin', text: (m) => `Win ${m.target} rounds on ${MAP_DEFS[m.map]().name}`, targets: [6, 10, 14], xp: [500, 800, 1100] },
  { kind: 'kill', text: (m) => `Get ${m.target} kills with ${m.cat === 'rifle' ? 'rifles' : m.cat === 'pistol' ? 'pistols' : m.cat === 'smg' ? 'SMGs' : 'any weapon'}`, targets: [8, 15, 25], xp: [400, 700, 1000] },
  { kind: 'hs', text: (m) => `Get ${m.target} headshot kills`, targets: [4, 8, 12], xp: [500, 800, 1100] },
  { kind: 'objective', text: (m) => `Plant or defuse the bomb ${m.target} times`, targets: [2, 4, 6], xp: [500, 900, 1300] },
  { kind: 'match', text: (m) => `Win ${m.target} ${m.target > 1 ? 'matches' : 'match'}`, targets: [1, 2, 3], xp: [700, 1200, 1800] },
];
function refreshMissions() {
  const day = new Date().toISOString().slice(0, 10);
  if (PROFILE.missionsDay === day && PROFILE.missions.length) return;
  PROFILE.missionsDay = day;
  PROFILE.missions = shuffle(MISSION_TYPES.slice()).slice(0, 3).map((t) => {
    const lvl = randInt(0, 2);
    return { kind: t.kind, target: t.targets[lvl], xp: t.xp[lvl], progress: 0, done: false, map: pick(MAP_ORDER), cat: pick(['rifle', 'pistol', 'smg', 'any']) };
  });
}
const missionText = (m) => MISSION_TYPES.find((t) => t.kind === m.kind).text(m);
// called from the game when the player does something that might count
const MATCH_LOG = { kills: 0, hs: 0, roundWins: 0, objectives: 0, missionXp: 0, completed: [] };
function trackEvent(kind, data) {
  if (!PROFILE || G.state !== 'playing') return;
  if (kind === 'kill') { MATCH_LOG.kills++; if (data.hs) MATCH_LOG.hs++; }
  if (kind === 'roundwin') MATCH_LOG.roundWins++;
  if (kind === 'objective') MATCH_LOG.objectives++;
  for (const m of PROFILE.missions) {
    if (m.done || m.kind !== kind && !(m.kind === 'hs' && kind === 'kill' && data.hs)) continue;
    if (m.kind === 'roundwin' && data.map !== m.map) continue;
    if (m.kind === 'kill' && m.cat !== 'any' && data.cat !== m.cat) continue;
    if (m.kind === 'hs' && !data.hs) continue;
    m.progress++;
    if (m.progress >= m.target) { m.done = true; MATCH_LOG.missionXp += m.xp; MATCH_LOG.completed.push(missionText(m)); }
  }
}
function resetMatchLog() { Object.assign(MATCH_LOG, { kills: 0, hs: 0, roundWins: 0, objectives: 0, missionXp: 0, completed: [] }); }

// ---------------------------------------------------------- match rewards
function awardMatch(result) {
  const won = result === 'win', draw = result === 'draw';
  if (won) trackEvent('match', {});
  const parts = [
    ['Rounds won', MATCH_LOG.roundWins * 40], ['Kills', MATCH_LOG.kills * 15], ['Headshots', MATCH_LOG.hs * 10],
    ['Objectives', MATCH_LOG.objectives * 50], [won ? 'Match win' : draw ? 'Draw' : 'Match played', won ? 400 : draw ? 200 : 120], ['Missions', MATCH_LOG.missionXp],
  ].filter((p) => p[1] > 0);
  const gained = parts.reduce((s, p) => s + p[1], 0);
  const before = PROFILE.level;
  PROFILE.xp += gained;
  PROFILE.level = Math.min(MAX_LEVEL, 1 + Math.floor(PROFILE.xp / XP_PER_LEVEL));
  const drops = [];
  for (let l = before; l < PROFILE.level; l++) drops.push(rollDrop());
  for (const d of drops) { PROFILE.inventory.push(d); PROFILE.newItems.push(d); }
  PROFILE.matches++; PROFILE.kills += MATCH_LOG.kills;
  saveProgress();
  return { parts, gained, levelUp: PROFILE.level > before, drops, completed: MATCH_LOG.completed.slice() };
}
// equip / unequip
function equipItem(id, team) {
  const [kind, a] = id.split(':');
  if (kind === 'k') { for (const t of team === 'both' ? ['T', 'CT'] : [team]) PROFILE.equipped.knife[t] = PROFILE.equipped.knife[t] === id ? null : id; }
  else PROFILE.equipped.finishes[a] = PROFILE.equipped.finishes[a] === id.split(':')[2] ? null : id.split(':')[2];
  PROFILE.newItems = PROFILE.newItems.filter((x) => x !== id);
  saveProgress();
}
const isEquipped = (id, team) => {
  const [kind, a, f] = id.split(':');
  return kind === 'k' ? (team ? PROFILE.equipped.knife[team] === id : PROFILE.equipped.knife.T === id || PROFILE.equipped.knife.CT === id) : PROFILE.equipped.finishes[a] === f;
};
