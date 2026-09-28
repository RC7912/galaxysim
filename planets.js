// Planet mode: N-body gravity between planets, collisions merge them.
// Shares canvas/ctx/rand/hslStr with renderer.js (all resolved at call time).

const PLANET_G = 0.0125;
const PLANET_DENSITY = 1;
const PLANET_SUBSTEPS = 8;
const PLANET_MAX_RADIUS = 90;
const TRAIL_LENGTH = 60;
const WALL_RESTITUTION = 0.5;
const TOOLBAR_HEIGHT = 50;

let planets = [];
let planetEffects = [];
let planetDrag = null; // { planet, lastX, lastY, lastT, vx, vy }

const backgroundStars = Array.from({ length: 220 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() * 1.2 + 0.2,
  a: Math.random() * 0.6 + 0.2
}));

function massFromRadius(r) {
  return PLANET_DENSITY * r * r * r;
}

function radiusFromMass(m) {
  return Math.min(Math.cbrt(m / PLANET_DENSITY), PLANET_MAX_RADIUS);
}

function randomSurface() {
  const bands = [];
  const bandCount = Math.round(rand(2, 6));
  for (let i = 0; i < bandCount; i++) {
    bands.push({ y: rand(-1, 1), h: rand(0.06, 0.25), light: rand(-18, 18), alpha: rand(0.15, 0.4) });
  }
  return {
    bands,
    hasRings: Math.random() < 0.3,
    ringTilt: rand(0.2, 0.45),
    ringHueShift: rand(-30, 30)
  };
}

function makePlanet(x, y, radius, hue, sat, light) {
  return {
    x, y,
    vx: 0, vy: 0,
    radius,
    mass: massFromRadius(radius),
    hue, sat, light,
    ...randomSurface(),
    trail: [],
    held: false,
    scale: 0
  };
}

function heaviestPlanet(except) {
  let best = null;
  for (const p of planets) {
    if (p === except) continue;
    if (!best || p.mass > best.mass) best = p;
  }
  return best;
}

// New planets start on a circular orbit around the heaviest body so a
// system forms instead of everything just falling straight together.
function giveOrbitalVelocity(p) {
  const host = heaviestPlanet(p);
  if (!host || host.mass < p.mass) return;
  const dx = p.x - host.x;
  const dy = p.y - host.y;
  const d = Math.hypot(dx, dy);
  if (d < host.radius + p.radius + 5) return;
  const v = Math.sqrt((PLANET_G * host.mass) / d);
  p.vx = host.vx + (-dy / d) * v;
  p.vy = host.vy + (dx / d) * v;
}

function addPlanet(p) {
  giveOrbitalVelocity(p);
  planets.push(p);
}

function spawnRandomPlanet() {
  const margin = 80;
  const x = rand(margin, window.innerWidth - margin);
  const y = rand(margin + TOOLBAR_HEIGHT, window.innerHeight - margin);
  const p = makePlanet(x, y, rand(6, 28), rand(0, 360), rand(45, 85), rand(40, 60));
  addPlanet(p);
}

function spawnCustomPlanetAt(x, y, radius, hue, sat, light) {
  addPlanet(makePlanet(x, y, radius, hue, sat, light));
}

function blendHue(h1, w1, h2, w2) {
  const rad = Math.PI / 180;
  const sx = Math.cos(h1 * rad) * w1 + Math.cos(h2 * rad) * w2;
  const sy = Math.sin(h1 * rad) * w1 + Math.sin(h2 * rad) * w2;
  let h = Math.atan2(sy, sx) / rad;
  if (h < 0) h += 360;
  return h;
}

function mergePlanets(a, b) {
  const m = a.mass + b.mass;
  const merged = makePlanet(
    (a.x * a.mass + b.x * b.mass) / m,
    (a.y * a.mass + b.y * b.mass) / m,
    radiusFromMass(m),
    blendHue(a.hue, a.mass, b.hue, b.mass),
    (a.sat * a.mass + b.sat * b.mass) / m,
    (a.light * a.mass + b.light * b.mass) / m
  );
  merged.mass = m;
  merged.vx = (a.vx * a.mass + b.vx * b.mass) / m;
  merged.vy = (a.vy * a.mass + b.vy * b.mass) / m;
  merged.scale = 0.85;
  merged.trail = (a.mass >= b.mass ? a.trail : b.trail).slice();

  planetEffects.push({ x: merged.x, y: merged.y, r: merged.radius, life: 1, hue: merged.hue });
  return merged;
}

function resolvePlanetCollisions() {
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const a = planets[i], b = planets[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) {
          const m = mergePlanets(a, b);
          if (planetDrag && (planetDrag.planet === a || planetDrag.planet === b)) planetDrag = null;
          planets = planets.filter(p => p !== a && p !== b);
          planets.push(m);
          merged = true;
          break outer;
        }
      }
    }
  }
}

function stepPlanetGravity(dt) {
  const sub = dt / PLANET_SUBSTEPS;
  for (let s = 0; s < PLANET_SUBSTEPS; s++) {
    for (let i = 0; i < planets.length; i++) {
      const pi = planets[i];
      if (pi.held) continue;
      let ax = 0, ay = 0;
      for (let j = 0; j < planets.length; j++) {
        if (i === j) continue;
        const pj = planets[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const soft = (pi.radius + pj.radius) * 0.5;
        const d2 = dx * dx + dy * dy + soft * soft;
        const inv = (PLANET_G * pj.mass) / (d2 * Math.sqrt(d2));
        ax += dx * inv;
        ay += dy * inv;
      }
      pi.vx += ax * sub;
      pi.vy += ay * sub;
    }
    for (const p of planets) {
      if (p.held) continue;
      p.x += p.vx * sub;
      p.y += p.vy * sub;
    }
    resolvePlanetCollisions();
  }

  for (const p of planets) {
    if (p.held) continue;
    const minX = p.radius, maxX = window.innerWidth - p.radius;
    const minY = TOOLBAR_HEIGHT + p.radius, maxY = window.innerHeight - p.radius;
    if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx) * WALL_RESTITUTION; }
    if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx) * WALL_RESTITUTION; }
    if (p.y < minY) { p.y = minY; p.vy = Math.abs(p.vy) * WALL_RESTITUTION; }
    if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy) * WALL_RESTITUTION; }
  }
}

// --- Input ---
function planetAt(x, y) {
  for (let i = planets.length - 1; i >= 0; i--) {
    const p = planets[i];
    if (Math.hypot(x - p.x, y - p.y) <= p.radius + 8) return p;
  }
  return null;
}

function planetMouseDown(e) {
  const p = planetAt(e.clientX, e.clientY);
  if (!p) return;
  p.held = true;
  p.vx = 0;
  p.vy = 0;
  planetDrag = { planet: p, offX: e.clientX - p.x, offY: e.clientY - p.y, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
}

function planetMouseMove(e) {
  if (!planetDrag) return;
  const now = performance.now();
  const frames = Math.max((now - planetDrag.lastT) / 16.6667, 0.1);
  const ivx = (e.clientX - planetDrag.lastX) / frames;
  const ivy = (e.clientY - planetDrag.lastY) / frames;
  planetDrag.vx = planetDrag.vx * 0.6 + ivx * 0.4;
  planetDrag.vy = planetDrag.vy * 0.6 + ivy * 0.4;
  planetDrag.lastX = e.clientX;
  planetDrag.lastY = e.clientY;
  planetDrag.lastT = now;
  planetDrag.planet.x = e.clientX - planetDrag.offX;
  planetDrag.planet.y = e.clientY - planetDrag.offY;
}

// Releasing flings the planet with the mouse's velocity (slingshot).
function planetMouseUp() {
  if (!planetDrag) return;
  const p = planetDrag.planet;
  const stale = performance.now() - planetDrag.lastT > 80;
  const maxFling = 25;
  p.vx = stale ? 0 : Math.max(-maxFling, Math.min(maxFling, planetDrag.vx));
  p.vy = stale ? 0 : Math.max(-maxFling, Math.min(maxFling, planetDrag.vy));
  p.held = false;
  planetDrag = null;
  resolvePlanetCollisions();
}

// --- Rendering ---
function drawStars() {
  for (const s of backgroundStars) {
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x * window.innerWidth, s.y * window.innerHeight, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrail(p) {
  if (p.trail.length < 2) return;
  for (let i = 1; i < p.trail.length; i++) {
    const a = p.trail[i - 1], b = p.trail[i];
    ctx.strokeStyle = hslStr(p.hue, p.sat, p.light, (i / p.trail.length) * 0.35);
    ctx.lineWidth = Math.max(1, p.radius * 0.15);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawRings(p, front) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, p.ringTilt);
  ctx.lineWidth = p.radius * 0.35;
  ctx.strokeStyle = hslStr(p.hue + p.ringHueShift, p.sat * 0.6, p.light + 15, 0.55);
  ctx.beginPath();
  // front half = lower half of the ellipse on screen
  if (front) ctx.arc(0, 0, p.radius * 1.9, 0, Math.PI);
  else ctx.arc(0, 0, p.radius * 1.9, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlanet(p) {
  const r = p.radius * p.scale;
  if (r <= 0.5) return;

  const atmo = ctx.createRadialGradient(p.x, p.y, r * 0.9, p.x, p.y, r * 1.5);
  atmo.addColorStop(0, hslStr(p.hue, p.sat, p.light + 10, 0.35));
  atmo.addColorStop(1, hslStr(p.hue, p.sat, p.light, 0));
  ctx.fillStyle = atmo;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  if (p.hasRings) drawRings(p, false);

  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.clip();

  const body = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  body.addColorStop(0, hslStr(p.hue, p.sat, Math.min(p.light + 22, 90)));
  body.addColorStop(0.6, hslStr(p.hue, p.sat, p.light));
  body.addColorStop(1, hslStr(p.hue, p.sat, Math.max(p.light - 28, 5)));
  ctx.fillStyle = body;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);

  for (const band of p.bands) {
    ctx.fillStyle = hslStr(p.hue + band.light, p.sat, p.light + band.light, band.alpha);
    ctx.fillRect(p.x - r, p.y + band.y * r, r * 2, band.h * r);
  }

  // night-side shadow
  const shade = ctx.createRadialGradient(p.x - r * 0.5, p.y - r * 0.5, r * 0.6, p.x, p.y, r * 1.3);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.restore();

  if (p.hasRings) drawRings(p, true);
}

function drawPlanetEffects(dt) {
  for (const fx of planetEffects) {
    fx.life -= 0.03 * dt;
    const radius = fx.r * (1 + (1 - fx.life) * 2.5);
    ctx.strokeStyle = hslStr(fx.hue, 90, 75, Math.max(fx.life, 0));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  planetEffects = planetEffects.filter(fx => fx.life > 0);
}

function stepPlanets(dt) {
  drawStars();
  stepPlanetGravity(dt);

  for (const p of planets) {
    p.scale += (1 - p.scale) * 0.15;
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > TRAIL_LENGTH) p.trail.shift();
  }

  for (const p of planets) drawTrail(p);
  for (const p of planets) drawPlanet(p);
  drawPlanetEffects(dt);
}
