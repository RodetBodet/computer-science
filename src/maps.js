'use strict';
/* =====================================================================
   MAP REGISTRY: three original maps on the same 40 x 32 grid (2 m cells).
   Grid legend:
     #  building block     .  street / ground    ,  asphalt     p  paved plaza
     a  A site floor        b  roofed hall        w  roofed passage
     h  raised platform     g  metal walkway      T / K  attacker / defender spawn
     r  railing             ~  water (out of bounds)
   Each map also carries the knowledge the bots use (routes, holds, lineups).
   ===================================================================== */
const MAP_DEFS = {};
function mapBuilder() {
  const g = Array.from({ length: GH }, () => Array(GW).fill('#'));
  const d = { grid: g, stairs: [], props: [], decals: [], floorDecals: [], lamps: [] };
  d.rect = (ch, x0, z0, x1, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[z][x] = ch; };
  d.prop = (mat, x0, y0, z0, x1, y1, z1, extra) => d.props.push(Object.assign({ mat, min: [x0, y0, z0], max: [x1, y1, z1] }, extra || {}));
  d.container = (color, x, z, alongX, stack) => {
    const L = 6.1, Wd = 2.44, Hh = 2.6;
    for (let s = 0; s < (stack || 1); s++) {
      if (alongX) d.prop('container_' + color[s % color.length], x, s * Hh, z, x + L, (s + 1) * Hh, z + Wd, { pen: 1.6 });
      else d.prop('container_' + color[s % color.length], x, s * Hh, z, x + Wd, (s + 1) * Hh, z + L, { pen: 1.6 });
    }
  };
  d.crate = (x, z, n, size) => { size = size || 1.2; for (let i = 0; i < (n || 1); i++) d.prop('crate', x, i * size, z, x + size, (i + 1) * size, z + size, { pen: 3 }); };
  d.pillar = (x, z, h) => d.prop('concrete', x - 0.3, 0, z - 0.3, x + 0.3, h, z + 0.3, { pillar: true });
  d.stair = (x0, z0, x1, z1, up, mat) => d.stairs.push({ x0, x1, z0, z1, h0: 0, h1: RAISED_H, up, mat: mat || 'concrete' });
  return d;
}

// ====================================================================== DOCKSIDE
MAP_DEFS.dockside = () => {
  const d = mapBuilder(), { rect, prop, container, crate } = d;
  rect('~', 38, 0, 39, 31); rect('r', 37, 1, 37, 26);
  rect('b', 1, 1, 11, 10); rect('w', 12, 2, 17, 4); rect('K', 18, 1, 25, 5); rect(',', 26, 2, 27, 4);
  rect('a', 28, 1, 36, 10); rect('h', 32, 1, 36, 3); rect('.', 34, 4, 35, 5);
  rect(',', 19, 6, 21, 8); rect('.', 18, 9, 21, 26); rect('.', 22, 12, 23, 13); rect('g', 24, 12, 29, 13); rect('.', 28, 10, 29, 11);
  rect(',', 33, 11, 36, 26); rect(',', 27, 22, 36, 26); rect(',', 27, 27, 30, 29); rect('T', 13, 27, 26, 30);
  rect(',', 3, 27, 12, 29); rect('.', 3, 12, 6, 26); rect('w', 3, 11, 6, 11); rect('w', 7, 16, 17, 17);
  d.stair(68, 8, 72, 12, '-z'); d.stair(44, 24, 48, 28, '+x', 'metal'); d.stair(56, 20, 60, 24, '+z', 'metal');
  for (const [x, z] of [[8, 8], [16, 8], [8, 16], [16, 16]]) d.pillar(x, z, ROOF_H.b);
  prop('crate', 12, 0, 9, 14.4, 1.2, 11.4, { pen: 3 }); prop('crate', 12.6, 1.2, 9.6, 13.8, 2.4, 10.8, { pen: 3 }); crate(14.4, 9.2, 1);
  crate(3.2, 3.2, 2); crate(4.4, 3.2, 1);
  prop('metal', 3, 0, 13.6, 11, 2.6, 14.6, { pen: 1.2, shelf: true });
  container(['blue'], 16.5, 17, true);
  prop('vehicle', 19.5, 0, 4.2, 21, 2.1, 7, { pen: 0.8 });
  crate(21.6, 19.6, 1); crate(2.4, 19.8, 2);
  container(['red'], 57.2, 12, true); container(['green', 'orange'], 66.2, 12.5, false, 2);
  crate(60, 4, 1); crate(61.2, 4, 2); crate(72.2, 16.4, 2); crate(70.9, 16.4, 1);
  prop('pallet', 58.2, 0, 6.6, 59.6, 0.3, 7.8, { pen: 3 }); prop('barrier', 62.4, 0, 19, 64.4, 0.9, 19.6, { pen: 0 });
  prop('vehicle', 38.5, 0, 3, 40.4, 1.6, 7.6, { pen: 0.8 }); prop('vehicle', 38.7, 1.6, 4.4, 40.2, 2.3, 6.8, { pen: 0.8 });
  crate(48.6, 8.4, 1); crate(49.8, 8.4, 2);
  prop('vehicle', 37.2, 0, 29, 39.2, 1.5, 33.6, { pen: 0.8 }); prop('vehicle', 37.4, 1.5, 30.4, 39, 2.1, 32.6, { pen: 0.8 });
  prop('barrier', 40.6, 0, 21.4, 42.6, 0.9, 22, { pen: 0 }); prop('barrier', 37, 0, 44.2, 39, 0.9, 44.8, { pen: 0 });
  crate(42.4, 37, 1); crate(42.4, 38.2, 1);
  container(['yellow'], 56, 46, true); container(['blue', 'red'], 66, 45, false, 2);
  crate(62.8, 51.2, 2); crate(64, 51.2, 1); crate(70.6, 31, 1); crate(71.8, 31, 2); crate(67.2, 38.6, 1);
  prop('vehicle', 70.3, 0, 22.8, 72.3, 2.0, 25.2, { pen: 0.8 });
  prop('dumpster', 7, 0, 33.6, 8.6, 1.3, 35.6, { pen: 1.2 }); prop('dumpster', 11.2, 0, 44, 12.8, 1.3, 46, { pen: 1.2 });
  crate(7.2, 25.6, 1); crate(12.4, 53.8, 2);
  prop('vehicle', 30, 0, 55.4, 32.4, 2.8, 61.6, { pen: 0.6 }); prop('vehicle', 44, 0, 54.4, 46.4, 2.8, 60.4, { pen: 0.6 });
  d.decals = [['A', 69, 1.0, 8.02, 0, 1.8], ['A', 57, 4.2, 2.02, 0, 3.0], ['B', 13, 3.4, 2.02, 0, 3.0], ['B', 2.02, 2.4, 12, Math.PI / 2, 2.4]];
  d.floorDecals = [['A', 62, 9, 3.5], ['B', 9, 9, 3.5]];
  d.lamps = [[9, ROOF_H.b - 0.25, 9, 60], [18, ROOF_H.b - 0.25, 15, 60], [25, ROOF_H.w - 0.15, 34, 22], [30, ROOF_H.w - 0.15, 7, 22]];
  return Object.assign(d, {
    id: 'dockside', name: 'Dockside', desc: 'Harbor freight yard. B is inside a warehouse, A is a container yard on the water.',
    theme: { walls: ['concrete', 'brick', 'plaster', 'block'], interior: 'corrugated', floors: {}, fog: 0xb9c6cf, harbor: true },
    sites: { A: { x0: 56, x1: 74, z0: 2, z1: 22, cx: 64, cz: 12 }, B: { x0: 2, x1: 24, z0: 2, z1: 22, cx: 12, cz: 12 } },
    spawns: { T: { x0: 27, x1: 53, z0: 55.5, z1: 61, ex0: 34.5, ex1: 45.5 }, CT: { x0: 46, x1: 51.5, z0: 2.5, z1: 11.5 } },
    callouts: [
      ['B Site', 2, 2, 24, 22], ['B Doors', 6, 22, 14, 24], ['Office', 24, 4, 36, 10], ['Defender Spawn', 36, 2, 52, 12],
      ['Ramp', 52, 4, 56, 10], ['Dock', 64, 2, 74, 8], ['A Site', 56, 2, 74, 22], ['Mid Doors', 38, 12, 44, 18],
      ['Gantry', 44, 24, 60, 28], ['Mid', 36, 18, 44, 54], ['Quay', 66, 22, 74, 46], ['Yard', 54, 44, 74, 54],
      ['Link', 14, 32, 36, 36], ['Alley', 6, 24, 14, 54], ['Lower Alley', 6, 54, 26, 60], ['Attacker Spawn', 26, 54, 54, 62],
    ],
    routes: { A: [[[40, 50], [56, 50], [70, 40], [70, 28]], [[40, 46], [40, 30], [46, 26], [54, 26], [58, 22]]], B: [[[22, 57], [10, 50], [9, 32], [10, 25]], [[40, 46], [38, 35], [24, 34], [10, 34], [10, 25]]] },
    plants: { A: [[62, 8], [60, 17.5], [65, 4.5], [71, 19.5]], B: [[10, 6], [17.5, 12], [6, 18], [21, 9]] },
    holds: { A: [[70, 6, 70, 26], [63, 16, 58, 23], [59, 9, 70, 24], [72.5, 19.5, 70, 34]], B: [[8, 5, 10, 24], [20, 15, 10, 23], [4, 19, 9, 24], [22, 6, 9, 22]], mid: [[40, 14, 40, 40], [43, 16, 38, 44]] },
    entries: { A: [[69, 26], [58, 23], [54, 7]], B: [[10, 23], [25, 6]] },
    utility: {
      A: [['smoke', 68, 28, 55, 7], ['smoke', 52, 26, 63, 16], ['flash', 70, 30, 67, 14], ['molotov', 70, 30, 72, 19]],
      B: [['smoke', 10, 27, 21, 8], ['flash', 10, 30, 12, 14], ['molotov', 10, 30, 8, 6], ['he', 10, 30, 19, 17]],
      CT_A: [['molotov', 64, 10, 69, 26], ['he', 64, 10, 70, 32], ['smoke', 60, 10, 57, 23]],
      CT_B: [['molotov', 14, 12, 10, 23], ['he', 14, 12, 10, 28], ['flash', 14, 12, 10, 24]],
    },
  });
};

// ====================================================================== FOUNDRY
MAP_DEFS.foundry = () => {
  const d = mapBuilder(), { rect, prop, container, crate } = d;
  rect('b', 1, 4, 11, 14);    // B: smelter hall
  rect('w', 12, 3, 15, 5);    // B corridor (defender side)
  rect('K', 16, 1, 23, 5);    // defender spawn
  rect(',', 24, 2, 26, 4);    // A gate
  rect('a', 27, 1, 37, 11);   // A: container yard
  rect('h', 34, 1, 37, 3);    // loading platform
  rect('.', 35, 4, 36, 5);    // platform stairs
  rect(',', 21, 6, 22, 7);    // mid gate
  rect('.', 17, 8, 22, 24);   // courtyard (mid)
  rect('#', 18, 15, 20, 17);  // furnace block splitting mid
  rect('w', 12, 10, 16, 11);  // window connector mid -> B
  rect('w', 23, 14, 26, 15);  // furnace tunnel mid -> A short
  rect('.', 27, 12, 30, 15);  // A short
  rect('.', 33, 12, 36, 26);  // rail road (A long)
  rect(',', 25, 27, 36, 29);  // pipeline road
  rect(',', 17, 25, 18, 26);  // attacker mid entrance
  rect('T', 15, 27, 24, 30);  // attacker spawn
  rect('.', 5, 15, 8, 25);    // lower B
  rect('w', 6, 26, 14, 27);   // sewer
  d.stair(70, 8, 74, 12, '-z');
  // smelter hall
  prop('metal', 4, 0, 10, 8.5, 3.2, 14, { pen: 0 }); prop('metal', 4.6, 3.2, 10.6, 7.9, 4.6, 13.4, { pen: 0 }); // furnace
  prop('metal', 16, 0, 22.5, 20.5, 2.2, 27, { pen: 0.8 });                                                     // press
  container(['orange'], 13, 12.5, false);
  for (const [x, z] of [[6, 20], [18, 11], [20, 18]]) d.pillar(x, z, ROOF_H.b);
  crate(9.5, 23, 2); crate(10.7, 23, 1); crate(21.5, 9, 1); crate(2.6, 27.6, 2);
  // yard
  container(['red'], 56, 14, true); container(['blue', 'yellow'], 63, 16.5, false, 2);
  crate(58, 5, 1); crate(59.2, 5, 2); crate(73.6, 20.6, 1); prop('barrier', 69, 0, 17.8, 71, 0.9, 18.4, { pen: 0 });
  prop('pallet', 66.5, 0, 9, 68, 0.3, 10.5, { pen: 3 });
  // courtyard + roads
  crate(35, 19, 1); crate(44.5, 22, 2); prop('vehicle', 43, 0, 38, 44.6, 2.0, 41, { pen: 0.8 });
  prop('barrier', 34.4, 0, 44, 36.4, 0.9, 44.6, { pen: 0 });
  prop('vehicle', 67.2, 0, 34, 70, 3.2, 45, { pen: 0.5 });              // freight wagon on the rail road
  crate(72, 28, 2); crate(72, 50, 1);
  prop('metal', 51, 0, 59.2, 74, 1.1, 60, { pen: 0 });                   // pipeline
  crate(60, 55, 1); crate(61.2, 55, 2);
  prop('vehicle', 40, 0, 56, 42.4, 2.8, 61.5, { pen: 0.6 });             // truck in spawn
  crate(37, 8.5, 1); crate(38.2, 8.5, 2);
  prop('dumpster', 15.5, 0, 36, 17.6, 1.3, 38, { pen: 1.2 }); crate(10.5, 44, 1);
  d.decals = [['A', 72, 1.0, 8.02, 0, 1.8], ['A', 60, 4.2, 2.02, 0, 3.0], ['B', 2.02, 3.2, 18, Math.PI / 2, 3.0], ['B', 13, 3.4, 8.02, 0, 2.4]];
  d.floorDecals = [['A', 64, 12, 3.5], ['B', 12, 18, 3.5]];
  d.lamps = [[8, ROOF_H.b - 0.25, 15, 60], [17, ROOF_H.b - 0.25, 23, 60], [29, ROOF_H.w - 0.15, 22, 22], [21, ROOF_H.w - 0.15, 54, 22]];
  return Object.assign(d, {
    id: 'foundry', name: 'Foundry', desc: 'Steel works. B is a roofed smelter hall, A a loading yard at the end of the rail road.',
    theme: { walls: ['corrugated', 'concrete', 'block', 'brick'], interior: 'corrugated', floors: { K: 'concreteFloor' }, fog: 0xb2b5b1, harbor: false, stacks: true },
    sites: { A: { x0: 54, x1: 76, z0: 2, z1: 24, cx: 64, cz: 13 }, B: { x0: 2, x1: 24, z0: 8, z1: 30, cx: 13, cz: 19 } },
    spawns: { T: { x0: 31, x1: 49, z0: 55.5, z1: 61 }, CT: { x0: 33, x1: 47, z0: 2.5, z1: 10 } },
    callouts: [
      ['B Hall', 2, 8, 24, 30], ['Window', 24, 20, 34, 24], ['B Corridor', 24, 6, 32, 12], ['Defender Spawn', 32, 2, 48, 12],
      ['A Gate', 48, 4, 54, 10], ['Platform', 68, 2, 76, 8], ['A Yard', 54, 2, 76, 24], ['Mid Gate', 42, 12, 46, 16],
      ['Furnace', 36, 30, 42, 36], ['Courtyard', 34, 16, 46, 50], ['Furnace Tunnel', 46, 28, 54, 32], ['A Short', 54, 24, 62, 32],
      ['Rail Road', 66, 24, 74, 54], ['Pipeline', 50, 54, 74, 60], ['Attacker Spawn', 30, 54, 50, 62], ['Sewer', 12, 52, 30, 56], ['Lower B', 10, 30, 18, 52],
    ],
    routes: {
      A: [[[52, 57], [70, 56], [71, 40], [71, 27]], [[36, 52], [44, 44], [45, 30], [52, 30], [58, 28], [58, 22]]],
      B: [[[29, 55], [16, 54], [14, 44], [14, 32]], [[36, 52], [35, 40], [35, 26], [30, 22], [22, 21]]],
    },
    plants: { A: [[60, 9], [67, 13], [72, 15], [59, 20]], B: [[11, 17], [21, 13], [5, 26], [14, 27]] },
    holds: {
      A: [[72, 5, 71, 28], [64, 10, 58, 27], [74.5, 19, 71, 32], [57.5, 17.5, 58, 28]],
      B: [[10, 9, 14, 32], [21, 15, 26, 22], [11, 21, 14, 34], [22, 29, 26, 22]],
      mid: [[44, 18, 44, 44], [44.5, 14.5, 35, 40]],
    },
    entries: { A: [[58, 25], [71, 25], [51, 7]], B: [[14, 31], [25, 22], [26, 9]] },
    utility: {
      A: [['smoke', 58, 34, 60, 18], ['smoke', 71, 40, 71, 20], ['flash', 71, 30, 68, 14], ['molotov', 58, 30, 64, 11]],
      B: [['smoke', 14, 40, 14, 26], ['flash', 14, 34, 12, 20], ['molotov', 14, 36, 11, 17], ['he', 30, 22, 18, 16]],
      CT_A: [['molotov', 64, 10, 58, 27], ['he', 72, 6, 71, 32], ['smoke', 64, 10, 71, 26]],
      CT_B: [['molotov', 12, 14, 14, 33], ['he', 20, 12, 27, 22], ['flash', 12, 16, 14, 30]],
    },
  });
};

// ====================================================================== OLD QUARTER
MAP_DEFS.oldquarter = () => {
  const d = mapBuilder(), { rect, prop, crate } = d;
  rect('K', 28, 1, 37, 5);    // defender spawn
  rect(',', 14, 2, 27, 4);    // north street
  rect('p', 3, 2, 13, 11);    // A: plaza
  rect('h', 3, 2, 6, 4);      // terrace
  rect('p', 4, 5, 5, 6);      // terrace stairs
  rect('.', 3, 12, 6, 25);    // long alley
  rect('T', 2, 26, 11, 30);   // attacker spawn
  rect(',', 12, 27, 22, 29);  // lower street
  rect('w', 23, 27, 26, 29);  // arches
  rect('p', 27, 19, 37, 27);  // B: courtyard
  rect('.', 15, 21, 17, 26);  // market lane
  rect('p', 14, 13, 21, 20);  // fountain square (mid)
  rect('.', 14, 9, 16, 12);   // A short passage
  rect('.', 22, 5, 24, 14);   // defender lane to mid
  rect('.', 32, 6, 35, 18);   // defender road to B
  rect('w', 22, 19, 26, 20);  // bakery (mid -> B)
  d.stair(8, 10, 12, 14, '-z');
  // plaza
  prop('concrete', 18, 0, 14, 20.4, 1.1, 16.4, { pen: 0 }); prop('concrete', 18.8, 1.1, 14.8, 19.6, 3.4, 15.6, { pen: 0 }); // monument
  prop('vehicle', 22, 0, 18, 25.2, 1.3, 19.6, { pen: 1.2 });            // market cart
  prop('barrier', 14.5, 0, 6, 15.1, 0.9, 9, { pen: 0 }); prop('barrier', 24.5, 0, 9.5, 27, 0.9, 10.1, { pen: 0 });
  crate(8, 18, 2); crate(9.2, 18, 1); crate(26, 21.5, 1);
  // fountain square
  prop('concrete', 34.5, 0, 32.5, 37.5, 0.9, 35.5, { pen: 0 }); prop('concrete', 35.5, 0.9, 33.5, 36.5, 3.2, 34.5, { pen: 0 });
  crate(29, 27, 1); crate(29, 28.2, 2); crate(42, 39.5, 1); prop('vehicle', 39.5, 0, 27, 42.5, 1.3, 28.6, { pen: 1.2 });
  // courtyard B
  prop('concrete', 64, 0, 45, 66.4, 1.0, 47.4, { pen: 0 });             // well
  prop('vehicle', 70, 0, 40, 73.2, 1.3, 41.6, { pen: 1.2 });
  crate(57, 53, 2); crate(58.2, 53, 1); crate(73.6, 52.6, 1); crate(60, 39.4, 1);
  prop('barrier', 54.8, 0, 46, 55.4, 0.9, 49, { pen: 0 });
  // streets
  prop('vehicle', 34, 0, 55.2, 38.6, 1.6, 57.2, { pen: 0.8 }); prop('vehicle', 34.8, 1.6, 55.4, 37.6, 2.2, 57, { pen: 0.8 });
  prop('dumpster', 11.5, 0, 33, 13.4, 1.3, 35, { pen: 1.2 }); crate(7, 42, 1);
  prop('vehicle', 60, 0, 6.4, 64.6, 1.6, 8.4, { pen: 0.8 }); crate(47, 18, 1); crate(70, 22, 2);
  d.decals = [['A', 10, 1.0, 10.02, 0, 1.8], ['A', 20, 4.0, 4.02, 0, 3.0], ['B', 75.98, 3.0, 47, -Math.PI / 2, 3.0], ['B', 65, 3.0, 38.02, 0, 2.4]];
  d.floorDecals = [['A', 18, 11, 3.5], ['B', 65, 50, 3.5]];
  d.lamps = [[50, ROOF_H.w - 0.15, 57, 22], [49, ROOF_H.w - 0.15, 40, 22], [16, 4.6, 20, 18], [66, 4.6, 30, 18]];
  return Object.assign(d, {
    id: 'oldquarter', name: 'Old Quarter', desc: 'Narrow streets of an old town. A is a plaza with a terrace, B a walled courtyard.',
    theme: { walls: ['plaster', 'brick', 'plaster', 'block'], interior: 'plaster', floors: { '.': 'pavers', p: 'pavers', T: 'pavers', K: 'pavers' }, fog: 0xc8c6bd, harbor: false },
    sites: { A: { x0: 6, x1: 28, z0: 4, z1: 24, cx: 15, cz: 16 }, B: { x0: 54, x1: 76, z0: 38, z1: 56, cx: 63, cz: 50 } },
    spawns: { T: { x0: 5, x1: 23, z0: 53, z1: 61 }, CT: { x0: 57, x1: 75, z0: 3, z1: 11 } },
    callouts: [
      ['Terrace', 6, 4, 14, 10], ['A Plaza', 6, 4, 28, 24], ['North Street', 28, 4, 56, 10], ['Defender Spawn', 56, 2, 76, 12],
      ['Long Alley', 6, 24, 14, 52], ['A Short', 28, 18, 34, 26], ['Fountain', 28, 26, 44, 42], ['Defender Lane', 44, 10, 50, 30],
      ['Bakery', 44, 38, 54, 42], ['B Courtyard', 54, 38, 76, 56], ['Arches', 46, 54, 54, 60], ['Lower Street', 24, 54, 46, 60],
      ['Market Lane', 30, 42, 36, 54], ['B Road', 64, 12, 72, 38], ['Attacker Spawn', 4, 52, 24, 62],
    ],
    routes: {
      A: [[[10, 50], [10, 36], [10, 26]], [[28, 57], [33, 48], [34, 38], [31, 28], [31, 22]]],
      B: [[[28, 57], [44, 57], [52, 57], [60, 52]], [[28, 57], [33, 48], [38, 40], [48, 40], [58, 40]]],
    },
    plants: { A: [[22, 8], [16, 21], [26, 14.5], [11, 16]], B: [[60, 43], [70, 51], [72, 44], [59, 50]] },
    holds: {
      A: [[10, 7, 10, 30], [24, 7, 31, 26], [21, 21, 10, 30], [27, 18, 31, 26]],
      B: [[74.5, 43.5, 52, 57], [60, 41, 48, 40], [72.5, 55, 52, 57], [67, 43, 52, 41]],
      mid: [[46, 20, 36, 34], [48, 28, 34, 40]],
    },
    entries: { A: [[10, 25], [31, 23], [29, 7]], B: [[53, 57], [53, 40], [68, 37]] },
    utility: {
      A: [['smoke', 10, 40, 10, 22], ['flash', 10, 32, 14, 16], ['molotov', 31, 30, 24, 10], ['he', 10, 34, 20, 10]],
      B: [['smoke', 40, 57, 58, 50], ['flash', 48, 40, 62, 44], ['molotov', 44, 57, 70, 50], ['he', 48, 40, 70, 42]],
      CT_A: [['molotov', 20, 10, 10, 27], ['he', 22, 8, 31, 26], ['smoke', 20, 12, 30, 24]],
      CT_B: [['molotov', 68, 30, 52, 57], ['he', 70, 40, 50, 40], ['flash', 66, 40, 52, 56]],
    },
  });
};
// ====================================================================== SWITCHYARD
// High-desert rail depot. Attackers start on the west siding, defenders at the depot office to the east.
// A is an open freight platform with a raised signal box; B is a roofed engine shed; mid is a turntable square.
MAP_DEFS.switchyard = () => {
  const d = mapBuilder(), { rect, prop, container, crate } = d;
  rect('T', 1, 12, 5, 19);    // attacker spawn (west siding)
  rect(',', 2, 2, 4, 11);     // west siding north
  rect('.', 5, 2, 19, 4);     // freight lane -> A
  rect('w', 12, 2, 14, 4);    // tarp shed over the freight lane
  rect('a', 20, 1, 31, 9);    // A: freight platform
  rect('h', 28, 1, 31, 3);    // signal box deck (raised)
  rect('.', 29, 4, 30, 5);    // signal box stairs
  rect(',', 32, 4, 35, 12);   // depot road (defenders -> A)
  rect('K', 33, 13, 38, 18);  // defender spawn (depot office yard)
  rect(',', 6, 17, 8, 19);    // attacker exit to mid
  rect('.', 9, 17, 16, 19);   // ballast street
  rect('p', 17, 11, 24, 20);  // turntable square (mid)
  rect('#', 19, 13, 22, 17);  // roundhouse office in the middle of the square
  rect('.', 21, 10, 23, 10);  // switch gap (mid -> A)
  rect('w', 25, 11, 28, 12);  // underpass (mid -> defenders)
  rect(',', 29, 11, 31, 12);  // cut
  rect('w', 18, 21, 19, 21);  // shed door (mid -> B)
  rect('b', 13, 22, 25, 30);  // B: engine shed (roofed hall)
  rect(',', 2, 20, 4, 28);    // south siding
  rect('.', 5, 26, 12, 28);   // coal road -> B west door
  rect('.', 34, 19, 36, 27);  // water tower lane (defenders -> B)
  rect(',', 26, 25, 33, 27);  // tank yard -> B east door
  d.stair(58, 8, 62, 12, '-z', 'metal');
  // A platform: a boxcar, containers and freight
  prop('vehicle', 42.5, 0, 9.4, 53.5, 3.0, 12.0, { pen: 0.5 });          // boxcar
  container(['green'], 44, 14.6, true); container(['yellow', 'blue'], 57.2, 12.4, false, 2);
  crate(41, 3, 2); crate(42.2, 3, 1); crate(54.5, 15.5, 1); crate(62.2, 18.2, 1); crate(51, 4.2, 1);
  prop('pallet', 48, 0, 17, 49.4, 0.3, 18.2, { pen: 3 });
  // freight lane + sidings
  prop('dumpster', 17, 0, 4.2, 19, 1.3, 5.8, { pen: 1.2 }); crate(31.5, 8.6, 1); crate(32.7, 8.6, 2);
  prop('barrier', 4.6, 0, 16, 5.2, 0.9, 19, { pen: 0 });
  prop('vehicle', 5.2, 0, 44, 7.4, 2.4, 50, { pen: 0.8 });                // hopper car on the south siding
  crate(16, 54.6, 1); crate(16, 55.8, 2); prop('barrier', 22, 0, 52.8, 22.6, 0.9, 55.4, { pen: 0 });
  // turntable square
  prop('metal', 34.6, 0, 27, 36.6, 1.1, 30, { pen: 0.8 });                // switch cabinet
  crate(47.4, 22.6, 1); crate(48.6, 22.6, 2); crate(34.8, 38.6, 1);
  prop('barrier', 46, 0, 39.4, 48.6, 0.9, 40, { pen: 0 });
  prop('vehicle', 25, 0, 35, 28.2, 1.4, 36.6, { pen: 1.2 });              // rail trolley in ballast street
  // underpass / cut / depot road
  crate(60.4, 22.4, 1); prop('barrier', 65, 0, 15, 67, 0.9, 15.6, { pen: 0 }); crate(69.6, 9, 1); crate(69.6, 10.2, 2);
  // engine shed
  prop('vehicle', 33, 0, 51.2, 45, 3.4, 54.2, { pen: 0.5 });              // locomotive on the shed track
  for (const [x, z] of [[32, 49], [46, 49], [32, 57], [46, 57]]) d.pillar(x, z, ROOF_H.b);
  crate(27.6, 45.4, 2); crate(28.8, 45.4, 1); crate(49.2, 59.4, 1); crate(36, 59.6, 2); crate(37.2, 59.6, 1);
  prop('metal', 41, 0, 58.6, 44.6, 2.2, 61.4, { pen: 0.8, shelf: true }); // tool racks
  // tank yard + water tower lane
  prop('metal', 57, 0, 50.6, 60, 2.6, 52.6, { pen: 0 });                  // fuel tank
  crate(64, 54.4, 1); container(['red'], 69.4, 44, false);
  d.decals = [['A', 50, 4.2, 2.02, 0, 3.0], ['A', 63.98, 4.4, 5, -Math.PI / 2, 2.0], ['B', 30, 3.4, 44.02, 0, 3.0], ['B', 26.02, 3.0, 47.5, Math.PI / 2, 2.4]];
  d.floorDecals = [['A', 52, 16, 3.5], ['B', 39, 58, 3.5]];
  d.lamps = [[33, ROOF_H.b - 0.25, 53, 60], [44, ROOF_H.b - 0.25, 55, 60], [53, ROOF_H.w - 0.15, 24, 22], [26, ROOF_H.w - 0.15, 6, 22]];
  return Object.assign(d, {
    id: 'switchyard', name: 'Switchyard', desc: 'Desert rail depot. A is a freight platform with a signal box, B a roofed engine shed.',
    theme: { walls: ['block', 'corrugated', 'brick', 'concrete'], interior: 'corrugated', floors: { K: 'concreteFloor', p: 'concreteFloor' }, fog: 0xd2c3a2, harbor: false, depot: true, wet: 0.35, oilStains: true },
    sites: { A: { x0: 40, x1: 64, z0: 2, z1: 20, cx: 50, cz: 13 }, B: { x0: 26, x1: 52, z0: 44, z1: 62, cx: 39, cz: 48.5 } },
    spawns: { T: { x0: 2.5, x1: 11.5, z0: 24.5, z1: 39.5 }, CT: { x0: 66.5, x1: 77.5, z0: 26.5, z1: 37.5 } },
    callouts: [
      ['Signal Box', 56, 2, 64, 8], ['A Platform', 40, 2, 64, 20], ['Tarp Shed', 24, 4, 30, 10], ['Freight Lane', 10, 4, 40, 10],
      ['West Siding', 4, 4, 10, 24], ['Switch Gap', 42, 20, 48, 22], ['Depot Road', 64, 8, 72, 26], ['Defender Spawn', 66, 26, 78, 38],
      ['Underpass', 50, 22, 58, 26], ['Cut', 58, 22, 64, 26], ['Turntable', 34, 22, 50, 42], ['Ballast Street', 12, 34, 34, 40],
      ['Shed Door', 36, 42, 40, 44], ['Engine Shed', 26, 44, 52, 62], ['South Siding', 4, 40, 10, 58], ['Coal Road', 10, 52, 26, 58],
      ['Tank Yard', 52, 50, 68, 56], ['Water Tower', 68, 38, 74, 56], ['Attacker Spawn', 2, 24, 12, 40],
    ],
    routes: {
      A: [[[7, 22], [7, 7], [24, 7], [42, 7]], [[14, 37], [36, 37], [36, 24], [45, 21], [46, 19]]],
      B: [[[7, 38], [7, 55], [20, 55], [30, 55]], [[14, 37], [32, 38], [38, 40], [38, 46]]],
    },
    plants: { A: [[48, 6], [55.5, 19], [45, 18.5], [55, 5]], B: [[31, 47.5], [47, 60.5], [40, 47], [30, 60]] },
    holds: {
      A: [[60, 5, 24, 7], [56, 17.5, 45, 21], [44, 6, 20, 7], [62.5, 15.5, 45, 21]],
      B: [[48.5, 47, 38, 43], [30.5, 51, 26, 55], [49.5, 61, 26, 55], [34, 61, 38, 43]],
      mid: [[56, 23, 36, 24], [62, 24, 40, 24]],
    },
    entries: { A: [[45, 21], [41, 7], [66, 12]], B: [[38, 43], [25, 55], [53, 53]] },
    utility: {
      A: [['smoke', 30, 7, 57, 8], ['flash', 36, 7, 50, 8], ['smoke', 36, 25, 54, 17], ['molotov', 36, 24, 46, 16]],
      B: [['smoke', 15, 55, 33, 50], ['flash', 18, 55, 32, 52], ['molotov', 37, 39, 44, 48], ['he', 37, 39, 40, 50]],
      CT_A: [['molotov', 54, 12, 45, 21], ['he', 52, 7, 40, 7], ['smoke', 58, 10, 44, 21]],
      CT_B: [['molotov', 44, 50, 38, 43], ['he', 46, 56, 26, 55], ['flash', 44, 48, 38, 44]],
    },
  });
};
const MAP_ORDER = ['dockside', 'foundry', 'oldquarter', 'switchyard'];
