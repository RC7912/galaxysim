const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

let galaxies = [];
let nextId = 1;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

// --- Physics constants ---
const G = 1.1;              // gravitational constant (tuned for pixel/frame scale)
const SOFTENING = 30;        // avoids singularities near r=0
const DAMPING = 0.9995;      // tiny energy loss so integration stays stable
const GALAXY_G = 0.35;       // weaker mutual attraction between galaxy centers
const GALAXY_SOFTENING = 90;
const MAX_PARTICLES = 1600;  // perf cap after repeated mergers

function randomGalaxy(x, y) {
  const radius = rand(40, 110);
  const hue = rand(0, 360);
  return makeGalaxy(x, y, radius, hue, rand(55, 80), rand(45, 65));
}

// Build a self-gravitating disk: particles start on a spiral pattern but get
// real circular-orbit velocities derived from the enclosed mass at their
// radius (shell theorem), so the rotation curve - and how arms wind up over
// time - falls out of actual physics instead of a scripted rotation.
function makeGalaxy(x, y, radius, hue, sat, light, seedParticles, armCountOverride) {
  const armCount = armCountOverride || Math.round(rand(2, 4));
  const particleCount = seedParticles || Math.round(radius * 5);
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    const arm = i % armCount;
    const t = Math.random();
    const dist = Math.max(4, t * radius);
    const armOffset = (arm / armCount) * Math.PI * 2;
    const spiralTightness = 3.2;
    const angle = armOffset + t * spiralTightness * Math.PI + rand(-0.25, 0.25);
    const size = rand(0.6, 2.2) * (1 - t * 0.4);
    const hueJitter = rand(-18, 18);
    const lightJitter = rand(-15, 20);
    const pmass = rand(0.6, 1.4);

    particles.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      mass: pmass,
      size, hueJitter, lightJitter
    });
  }

  const centralMass = particles.reduce((s, p) => s + p.mass, 0) * 0.25;
  applyCircularOrbits(particles, centralMass);

  return {
    id: nextId++,
    x, y,
    radius,
    hue, sat, light,
    particles,
    centralMass,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    scale: 0,
    targetScale: 1,
    vx: rand(-0.6, 0.6),
    vy: rand(-0.6, 0.6)
  };
}

// Gives each particle the orbital velocity needed for a (roughly) stable
// circular orbit around the mass enclosed within its radius, plus a bit of
// velocity dispersion so orbits aren't perfectly circular (keeps the disk
// looking alive and lets arms evolve/wind instead of staying frozen).
function applyCircularOrbits(particles, centralMass) {
  const withR = particles.map(p => ({ p, r: Math.hypot(p.x, p.y) }));
  withR.sort((a, b) => a.r - b.r);

  let enclosed = centralMass;
  for (const { p, r } of withR) {
    enclosed += p.mass;
    const rSafe = Math.max(r, 1);
    const vCirc = Math.sqrt((G * enclosed) / (rSafe + SOFTENING));
    const dispersion = rand(0.85, 1.1);
    const tangential = vCirc * dispersion;
    // tangent direction = perpendicular to radius vector
    p.vx = (-p.y / rSafe) * tangential;
    p.vy = (p.x / rSafe) * tangential;
  }
}

// One step of self-gravity for a single galaxy's disk: sort by radius so we
// can use the shell theorem (mass enclosed inside r attracts a particle at
// r as if it were a point mass at the center), then integrate velocity/
// position. This is what produces differential rotation - inner particles
// orbit faster than outer ones, exactly like real rotation curves.
//
// After repeated mergers, mass concentrates near the center and the local
// orbital frequency there gets much higher than a single ~16ms frame step
// can resolve with simple Euler integration - that mismatch injects energy
// every frame and blows the galaxy apart. We fix it by sub-stepping with a
// small fixed dt (so the integrator always resolves the fastest orbits)
// and clamping speed as a hard safety net against any residual blow-up.
const PHYSICS_SUBSTEPS = 40;
const MAX_PARTICLE_SPEED = 18;

function stepGalaxyPhysics(g, dt) {
  const withR = g.particles.map(p => ({ p, r: Math.hypot(p.x, p.y) }));
  withR.sort((a, b) => a.r - b.r);

  // enclosed mass strictly *inside* each particle's radius (shell theorem):
  // a particle should not feel its own mass pulling on itself.
  const enclosedAt = new Array(withR.length);
  let running = g.centralMass;
  for (let i = 0; i < withR.length; i++) {
    enclosedAt[i] = running;
    running += withR[i].p.mass;
  }

  const sampleIndex = Math.floor(withR.length * 0.85);
  const radiusSample = withR.length ? Math.max(withR[sampleIndex]?.r ?? g.radius, 20) : g.radius;

  const subDt = dt / PHYSICS_SUBSTEPS;

  for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
    for (let i = 0; i < withR.length; i++) {
      const p = withR[i].p;
      const enclosed = enclosedAt[i];

      const rNow2 = p.x * p.x + p.y * p.y;
      const denom = Math.pow(rNow2 + SOFTENING * SOFTENING, 1.5);
      const accel = (-G * enclosed) / denom;

      p.vx += accel * p.x * subDt;
      p.vy += accel * p.y * subDt;
      p.vx *= DAMPING;
      p.vy *= DAMPING;

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > MAX_PARTICLE_SPEED) {
        const scaleDown = MAX_PARTICLE_SPEED / speed;
        p.vx *= scaleDown;
        p.vy *= scaleDown;
      }

      p.x += p.vx * subDt;
      p.y += p.vy * subDt;
    }
  }

  // let the visible/glow radius breathe with the actual mass distribution
  g.radius += (radiusSample - g.radius) * 0.02;
}

function mass(g) {
  return g.radius * g.radius;
}

function mergeGalaxies(a, b) {
  const ma = mass(a), mb = mass(b);
  const totalMass = ma + mb;
  const newRadius = Math.min(Math.sqrt(totalMass) * 1.05, 260);
  const nx = (a.x * ma + b.x * mb) / totalMass;
  const ny = (a.y * ma + b.y * mb) / totalMass;
  const nvx = (a.vx * ma + b.vx * mb) / totalMass;
  const nvy = (a.vy * ma + b.vy * mb) / totalMass;

  // circular mean of hues weighted by mass
  const rad = Math.PI / 180;
  const sumX = Math.cos(a.hue * rad) * ma + Math.cos(b.hue * rad) * mb;
  const sumY = Math.sin(a.hue * rad) * ma + Math.sin(b.hue * rad) * mb;
  let newHue = Math.atan2(sumY, sumX) / rad;
  if (newHue < 0) newHue += 360;

  const newSat = Math.min(95, (a.sat * ma + b.sat * mb) / totalMass + rand(-5, 5));
  const newLight = Math.min(75, (a.light * ma + b.light * mb) / totalMass + rand(-5, 5));

  // Merge the real particle sets (converted into the new shared frame) so
  // the collision produces genuine tidal disruption/relaxation instead of
  // just re-rolling a fresh disk. Orbital momentum carries over.
  const carryOver = (galaxy) => galaxy.particles.map(p => ({
    x: p.x + (galaxy.x - nx),
    y: p.y + (galaxy.y - ny),
    vx: p.vx + (galaxy.vx - nvx),
    vy: p.vy + (galaxy.vy - nvy),
    mass: p.mass,
    size: p.size,
    hueJitter: p.hueJitter,
    lightJitter: p.lightJitter
  }));

  let combined = carryOver(a).concat(carryOver(b));

  if (combined.length > MAX_PARTICLES) {
    const keepRatio = MAX_PARTICLES / combined.length;
    const massBoost = 1 / keepRatio; // conserve total mass after downsampling
    combined = combined
      .filter(() => Math.random() < keepRatio)
      .map(p => ({ ...p, mass: p.mass * massBoost }));
  }

  const centralMass = combined.reduce((s, p) => s + p.mass, 0) * 0.15;

  const merged = {
    id: nextId++,
    x: nx, y: ny,
    radius: newRadius,
    hue: newHue, sat: newSat, light: newLight,
    particles: combined,
    centralMass,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    scale: 0,
    targetScale: 1,
    vx: nvx,
    vy: nvy
  };

  return merged;
}

function spawnRandom() {
  const margin = 120;
  const x = rand(margin, window.innerWidth - margin);
  const y = rand(margin + 60, window.innerHeight - margin);
  const g = randomGalaxy(x, y);
  galaxies.push(g);
}

let mode = 'galaxies';

const spawnBtn = document.getElementById('spawnBtn');
const customBtn = document.getElementById('customBtn');
const modeBtn = document.getElementById('modeBtn');
const hint = document.getElementById('hint');

spawnBtn.addEventListener('click', () => {
  if (mode === 'planets') spawnRandomPlanet();
  else spawnRandom();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (mode === 'planets') {
    planets = [];
    planetEffects = [];
    planetDrag = null;
  } else {
    galaxies = [];
  }
});

function setMode(next) {
  mode = next;
  const planetMode = mode === 'planets';
  spawnBtn.textContent = planetMode ? '+ New Planet' : '+ New Galaxy';
  customBtn.textContent = planetMode ? 'Custom Planet' : 'Custom Galaxy';
  modeBtn.textContent = planetMode ? 'Galaxy Mode' : 'Planet Mode';
  hint.textContent = planetMode
    ? 'Planets attract each other and merge on impact. Drag and release to fling one.'
    : 'Drag a galaxy onto another to merge them';
  document.getElementById('armsRow').style.display = planetMode ? 'none' : '';
  sizeInput.min = planetMode ? 5 : 30;
  sizeInput.max = planetMode ? 60 : 180;
  sizeInput.value = planetMode ? 20 : 90;
  sizeValue.textContent = sizeInput.value;

  dragTarget = null;
  planetDrag = null;
  for (const p of planets) p.held = false;
  for (const g of galaxies) g.dragging = false;

  if (planetMode && planets.length === 0) {
    const cx = window.innerWidth / 2;
    const cy = (window.innerHeight + TOOLBAR_HEIGHT) / 2;
    addPlanet(makePlanet(cx, cy, 40, rand(20, 50), 90, 55));
    for (let i = 0; i < 4; i++) spawnRandomPlanet();
  }
}

modeBtn.addEventListener('click', () => setMode(mode === 'planets' ? 'galaxies' : 'planets'));

// --- Custom galaxy creation ---
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

const customPanel = document.getElementById('customPanel');
const colorInput = document.getElementById('colorInput');
const sizeInput = document.getElementById('sizeInput');
const sizeValue = document.getElementById('sizeValue');
const armsInput = document.getElementById('armsInput');
const armsValue = document.getElementById('armsValue');
const placeBtn = document.getElementById('placeBtn');

let placingCustom = false;

sizeInput.addEventListener('input', () => { sizeValue.textContent = sizeInput.value; });
armsInput.addEventListener('input', () => { armsValue.textContent = armsInput.value; });

document.getElementById('customBtn').addEventListener('click', () => {
  customPanel.classList.toggle('hidden');
});

document.getElementById('cancelCustomBtn').addEventListener('click', () => {
  customPanel.classList.add('hidden');
  setPlacing(false);
});

function setPlacing(on) {
  placingCustom = on;
  placeBtn.classList.toggle('armed', on);
  placeBtn.textContent = on ? 'Click canvas to place...' : 'Click canvas to place';
  canvas.classList.toggle('placing', on);
}

placeBtn.addEventListener('click', () => setPlacing(!placingCustom));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && placingCustom) setPlacing(false);
});

function spawnCustomAt(x, y) {
  const { h, s, l } = hexToHsl(colorInput.value);
  const radius = Number(sizeInput.value);
  if (mode === 'planets') {
    spawnCustomPlanetAt(x, y, radius, h, Math.max(30, s), Math.min(Math.max(25, l), 75));
    return;
  }
  const arms = Number(armsInput.value);
  const g = makeGalaxy(x, y, radius, h, Math.max(30, s), Math.max(20, l), null, arms);
  galaxies.push(g);
}

// --- Drag & merge interaction ---
let dragTarget = null;

function galaxyAt(px, py) {
  for (let i = galaxies.length - 1; i >= 0; i--) {
    const g = galaxies[i];
    const d = Math.hypot(px - g.x, py - g.y);
    if (d <= g.radius + 15) return g;
  }
  return null;
}

canvas.addEventListener('mousedown', (e) => {
  if (placingCustom) {
    spawnCustomAt(e.clientX, e.clientY);
    setPlacing(false);
    customPanel.classList.add('hidden');
    return;
  }

  if (mode === 'planets') {
    planetMouseDown(e);
    return;
  }

  const g = galaxyAt(e.clientX, e.clientY);
  if (g) {
    dragTarget = g;
    g.dragging = true;
    g.vx = 0;
    g.vy = 0;
    g.dragOffsetX = e.clientX - g.x;
    g.dragOffsetY = e.clientY - g.y;
    // bring to front
    galaxies = galaxies.filter(x => x !== g);
    galaxies.push(g);
  }
});

window.addEventListener('mousemove', (e) => {
  if (mode === 'planets') {
    planetMouseMove(e);
    return;
  }
  if (dragTarget) {
    dragTarget.x = e.clientX - dragTarget.dragOffsetX;
    dragTarget.y = e.clientY - dragTarget.dragOffsetY;
  }
});

function tryMerge(g) {
  const other = galaxies.find(o => o !== g &&
    Math.hypot(o.x - g.x, o.y - g.y) < (o.radius + g.radius) * 0.65);
  if (!other) return false;
  const merged = mergeGalaxies(g, other);
  galaxies = galaxies.filter(x => x !== g && x !== other);
  galaxies.push(merged);
  return true;
}

window.addEventListener('mouseup', () => {
  if (mode === 'planets') {
    planetMouseUp();
    return;
  }
  if (!dragTarget) return;
  const g = dragTarget;
  g.dragging = false;
  dragTarget = null;
  tryMerge(g);
});

// --- Mutual gravity between galaxy centers ---
// Galaxies are attracted to each other like point masses; left alone long
// enough, they'll drift together and merge on their own, not just via drag.
function stepGalacticGravity(dt) {
  for (let i = 0; i < galaxies.length; i++) {
    const gi = galaxies[i];
    if (gi.dragging) continue;
    let ax = 0, ay = 0;
    const mi = mass(gi);

    for (let j = 0; j < galaxies.length; j++) {
      if (i === j) continue;
      const gj = galaxies[j];
      const dx = gj.x - gi.x;
      const dy = gj.y - gi.y;
      const distSq = dx * dx + dy * dy + GALAXY_SOFTENING * GALAXY_SOFTENING;
      const dist = Math.sqrt(distSq);
      const mj = mass(gj);
      const accel = (GALAXY_G * mj) / distSq;
      ax += accel * (dx / dist);
      ay += accel * (dy / dist);
    }

    gi.vx += ax * dt;
    gi.vy += ay * dt;
  }
}

// --- Rendering loop ---
function hslStr(h, s, l, a = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function drawGalaxy(g) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(g.scale, g.scale * 0.55); // squash into a tilted disk

  // soft glow core
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, g.radius);
  glow.addColorStop(0, hslStr(g.hue, g.sat, Math.min(g.light + 25, 90), 0.9));
  glow.addColorStop(0.15, hslStr(g.hue, g.sat, g.light, 0.35));
  glow.addColorStop(1, hslStr(g.hue, g.sat, g.light, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, g.radius, 0, Math.PI * 2);
  ctx.fill();

  for (const p of g.particles) {
    const h = g.hue + p.hueJitter;
    const l = Math.min(85, Math.max(15, g.light + p.lightJitter));
    ctx.fillStyle = hslStr(h, g.sat, l, 0.85);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

let lastTime = performance.now();

function step(now) {
  const dt = Math.min((now - lastTime) / 16.6667, 2.5); // normalized to ~60fps steps, clamped
  lastTime = now;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  if (mode === 'planets') stepPlanets(dt);
  else stepGalaxies(dt);

  requestAnimationFrame(step);
}

function stepGalaxies(dt) {
  stepGalacticGravity(dt);

  for (const g of galaxies) {
    g.scale += (g.targetScale - g.scale) * 0.08;

    stepGalaxyPhysics(g, dt);

    if (!g.dragging) {
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      const margin = g.radius * 0.5;
      if (g.x < margin || g.x > window.innerWidth - margin) g.vx *= -0.6;
      if (g.y < margin + 50 || g.y > window.innerHeight - margin) g.vy *= -0.6;
      g.x = Math.max(margin, Math.min(window.innerWidth - margin, g.x));
      g.y = Math.max(margin + 50, Math.min(window.innerHeight - margin, g.y));
    }

    drawGalaxy(g);
  }

  // natural gravitational mergers (independent of dragging)
  outer:
  for (let i = 0; i < galaxies.length; i++) {
    for (let j = i + 1; j < galaxies.length; j++) {
      const a = galaxies[i], b = galaxies[j];
      if (a.dragging || b.dragging) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.radius + b.radius) * 0.55) {
        const merged = mergeGalaxies(a, b);
        galaxies = galaxies.filter(x => x !== a && x !== b);
        galaxies.push(merged);
        break outer;
      }
    }
  }
}

// seed with a couple of galaxies
spawnRandom();
spawnRandom();
requestAnimationFrame(step);
