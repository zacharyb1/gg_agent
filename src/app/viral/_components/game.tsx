"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditPlan } from "~/lib/ai-editor/types";
import type { FeatureSnapshot, ViralMoment } from "~/lib/ai-editor/viral";
import { IPhoneFrame } from "./IPhoneFrame";
import { FONT_DISPLAY, FONT_MONO, MOODS } from "./moods";
import { createMusicEngine, type MusicEngine } from "./music";
import { ViralOverlay } from "./Overlay";
import { renderEdit } from "./renderEdit";
import { createSfxEngine, type SfxEngine } from "./sfx";

const ARENA_W = 960;
const ARENA_H = 600;
const PLAYER_RADIUS = 16;
const ALLY_RADIUS = 15;
const PLAYER_SPEED = 250;
const ALLY_SPEED = 220;
const PLAYER_FIRE_RATE = 0.18;
const ALLY_FIRE_RATE = 0.55;
const ALLY_AIM_RANGE = 340;
const ALLY_IDEAL_RANGE = 140;
const ALLY_LEASH = 320;
const ALLY_SEPARATION = ALLY_RADIUS * 3;
const BULLET_SPEED = 760;
const BULLET_DAMAGE = 11;
const ALLY_BULLET_DAMAGE = 7;
const PLAYER_MAX_HP = 100;
const ALLY_MAX_HP = 70;
const WAVE_BREAK_SECONDS = 2;

type Vec = { x: number; y: number };

type Bullet = {
	pos: Vec;
	vel: Vec;
	startPos: Vec;
	damage: number;
	ttl: number;
	team: "player" | "ally";
	owner: string;
};

type ZombieType = "walker" | "runner" | "brute";

type Zombie = {
	pos: Vec;
	vel: Vec;
	hp: number;
	maxHp: number;
	speed: number;
	radius: number;
	damage: number;
	type: ZombieType;
	hitFlash: number;
	wobble: number;
};

type Ally = {
	pos: Vec;
	hp: number;
	maxHp: number;
	angle: number;
	cooldown: number;
	alive: boolean;
	respawnTimer: number;
	followOffset: Vec;
	uniform: string;
	headband: string;
	hitFlash: number;
};

type Player = {
	pos: Vec;
	hp: number;
	maxHp: number;
	angle: number;
	cooldown: number;
	hitFlash: number;
};

type Particle = {
	pos: Vec;
	vel: Vec;
	life: number;
	maxLife: number;
	color: string;
	size: number;
};

type FloatingText = {
	pos: Vec;
	vel: Vec;
	text: string;
	life: number;
	color: string;
};

type Obstacle =
	| { kind: "crate"; x: number; y: number; w: number; h: number }
	| { kind: "sandbag"; x: number; y: number; w: number; h: number }
	| { kind: "barrel"; x: number; y: number; r: number };

type Phase = "menu" | "playing" | "gameover";

type GameRuntime = {
	phase: Phase;
	player: Player;
	allies: Ally[];
	zombies: Zombie[];
	bullets: Bullet[];
	particles: Particle[];
	texts: FloatingText[];
	obstacles: Obstacle[];
	wave: number;
	zombiesToSpawn: number;
	spawnTimer: number;
	waveBreak: number;
	bannerText: string;
	bannerTime: number;
	bannerMaxTime: number;
	kills: number;
	shakeTime: number;
	shakeMag: number;
	keys: Set<string>;
	mouse: Vec;
	shooting: boolean;
	paused: boolean;
	sfx: SfxEngine | null;
	// Viral-moment instrumentation for the post-match AI edit.
	events: GameEvent[];
	matchStartMs: number;
	lastPlayerKillMs: number;
	lowHpFlaggedAt: number;        // -1 when not flagged
	// Telemetry stream: one snapshot every ~250ms during play, fed to the
	// post-match viral classifier alongside `events`.
	snapshots: FeatureSnapshot[];
	lastSnapshotMs: number;
	bucketKills: number;
	bucketHits: number;
	bucketShots: number;
};

export type GameEvent =
	| {
			kind: "kill";
			t: number;
			killer: string;
			victim: string;
			killerHp: number;
			killerMaxHp: number;
			victimKind: string;
			range: number;
			chainSeconds: number;
	  }
	| { kind: "ally_kill"; t: number; killer: string; victim: string }
	| { kind: "ally_death"; t: number; victim: string }
	| { kind: "low_hp_save"; t: number; subject: string; hpAfter: number }
	| { kind: "long_shot"; t: number; killer: string; range: number }
	| {
			kind: "match_end";
			t: number;
			result: "win" | "loss";
			durationMs: number;
	  };

export function viralScore(e: GameEvent): number {
	let s = 0;
	if (e.kind === "kill") {
		s += 30;
		if (e.chainSeconds < 4) s += 40;
		if (e.chainSeconds < 2) s += 30;
		if (e.killerHp / e.killerMaxHp < 0.25) s += 35;
		if (e.range > 400) s += 25;
	}
	if (e.kind === "low_hp_save") s += 25;
	if (e.kind === "ally_death") s -= 10;
	if (e.kind === "match_end") s += e.result === "win" ? 50 : 15;
	return s;
}

function nowT(s: GameRuntime) {
	return performance.now() - s.matchStartMs;
}

function clamp(n: number, min: number, max: number) {
	return Math.min(Math.max(n, min), max);
}

function rand(min: number, max: number) {
	return min + Math.random() * (max - min);
}

function chance(p: number) {
	return Math.random() < p;
}

function obstacleBox(o: Obstacle) {
	if (o.kind === "barrel") {
		return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
	}
	return { x: o.x, y: o.y, w: o.w, h: o.h };
}

function obstacleBottomY(o: Obstacle) {
	if (o.kind === "barrel") return o.y + o.r;
	return o.y + o.h;
}

function rectsOverlap(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
	pad: number,
) {
	return (
		a.x - pad < b.x + b.w &&
		a.x + a.w + pad > b.x &&
		a.y - pad < b.y + b.h &&
		a.y + a.h + pad > b.y
	);
}

function generateObstacles(): Obstacle[] {
	const obstacles: Obstacle[] = [];
	const cx = ARENA_W / 2;
	const cy = ARENA_H / 2;
	const minDistFromCenter = 150;
	let attempts = 0;
	while (obstacles.length < 11 && attempts < 200) {
		attempts++;
		const roll = Math.random();
		let candidate: Obstacle;
		if (roll < 0.4) {
			const horizontal = Math.random() < 0.5;
			const w = horizontal ? rand(70, 130) : rand(28, 36);
			const h = horizontal ? rand(28, 36) : rand(70, 130);
			candidate = {
				kind: "sandbag",
				x: rand(60, ARENA_W - 60 - w),
				y: rand(60, ARENA_H - 60 - h),
				w,
				h,
			};
		} else if (roll < 0.78) {
			const s = rand(36, 56);
			candidate = {
				kind: "crate",
				x: rand(60, ARENA_W - 60 - s),
				y: rand(60, ARENA_H - 60 - s),
				w: s,
				h: s,
			};
		} else {
			const r = rand(15, 22);
			candidate = {
				kind: "barrel",
				x: rand(80, ARENA_W - 80),
				y: rand(80, ARENA_H - 80),
				r,
			};
		}
		const box = obstacleBox(candidate);
		const closestX = clamp(cx, box.x, box.x + box.w);
		const closestY = clamp(cy, box.y, box.y + box.h);
		if (Math.hypot(cx - closestX, cy - closestY) < minDistFromCenter) continue;
		let collides = false;
		for (const other of obstacles) {
			if (rectsOverlap(box, obstacleBox(other), 28)) {
				collides = true;
				break;
			}
		}
		if (collides) continue;
		obstacles.push(candidate);
	}
	return obstacles;
}

function resolveObstacleCollision(
	pos: Vec,
	radius: number,
	obstacles: Obstacle[],
) {
	for (const o of obstacles) {
		if (o.kind === "barrel") {
			const dx = pos.x - o.x;
			const dy = pos.y - o.y;
			const d = Math.hypot(dx, dy);
			const min = radius + o.r;
			if (d < min) {
				if (d === 0) {
					pos.x += min;
				} else {
					pos.x = o.x + (dx / d) * min;
					pos.y = o.y + (dy / d) * min;
				}
			}
		} else {
			const closestX = clamp(pos.x, o.x, o.x + o.w);
			const closestY = clamp(pos.y, o.y, o.y + o.h);
			const dx = pos.x - closestX;
			const dy = pos.y - closestY;
			const d = Math.hypot(dx, dy);
			if (d < radius) {
				if (d === 0) {
					const ocx = o.x + o.w / 2;
					const ocy = o.y + o.h / 2;
					if (Math.abs(pos.x - ocx) > Math.abs(pos.y - ocy)) {
						pos.x = pos.x >= ocx ? o.x + o.w + radius : o.x - radius;
					} else {
						pos.y = pos.y >= ocy ? o.y + o.h + radius : o.y - radius;
					}
				} else {
					pos.x = closestX + (dx / d) * radius;
					pos.y = closestY + (dy / d) * radius;
				}
			}
		}
	}
}

function bulletHitsObstacle(pos: Vec, obstacles: Obstacle[]) {
	for (const o of obstacles) {
		if (o.kind === "barrel") {
			const dx = pos.x - o.x;
			const dy = pos.y - o.y;
			if (dx * dx + dy * dy < o.r * o.r) return true;
		} else if (
			pos.x >= o.x &&
			pos.x <= o.x + o.w &&
			pos.y >= o.y &&
			pos.y <= o.y + o.h
		) {
			return true;
		}
	}
	return false;
}

function createSquad(): Ally[] {
	return [
		{
			pos: { x: ARENA_W / 2 - 60, y: ARENA_H / 2 + 30 },
			hp: ALLY_MAX_HP,
			maxHp: ALLY_MAX_HP,
			angle: 0,
			cooldown: 0,
			alive: true,
			respawnTimer: 0,
			followOffset: { x: -55, y: 35 },
			uniform: "#3a6a3d",
			headband: "#e94545",
			hitFlash: 0,
		},
		{
			pos: { x: ARENA_W / 2 + 60, y: ARENA_H / 2 + 30 },
			hp: ALLY_MAX_HP,
			maxHp: ALLY_MAX_HP,
			angle: 0,
			cooldown: 0,
			alive: true,
			respawnTimer: 0,
			followOffset: { x: 55, y: 35 },
			uniform: "#436b30",
			headband: "#f1f1f1",
			hitFlash: 0,
		},
		{
			pos: { x: ARENA_W / 2, y: ARENA_H / 2 + 60 },
			hp: ALLY_MAX_HP,
			maxHp: ALLY_MAX_HP,
			angle: 0,
			cooldown: 0,
			alive: true,
			respawnTimer: 0,
			followOffset: { x: 0, y: 60 },
			uniform: "#2f5f3a",
			headband: "#1a1a1a",
			hitFlash: 0,
		},
	];
}

function createInitialState(): GameRuntime {
	return {
		phase: "menu",
		player: {
			pos: { x: ARENA_W / 2, y: ARENA_H / 2 },
			hp: PLAYER_MAX_HP,
			maxHp: PLAYER_MAX_HP,
			angle: -Math.PI / 2,
			cooldown: 0,
			hitFlash: 0,
		},
		allies: createSquad(),
		zombies: [],
		bullets: [],
		particles: [],
		texts: [],
		obstacles: generateObstacles(),
		wave: 0,
		zombiesToSpawn: 0,
		spawnTimer: 0,
		waveBreak: 0,
		bannerText: "",
		bannerTime: 0,
		bannerMaxTime: 1,
		kills: 0,
		shakeTime: 0,
		shakeMag: 0,
		keys: new Set(),
		mouse: { x: ARENA_W / 2, y: ARENA_H / 2 - 80 },
		shooting: false,
		paused: false,
		sfx: null,
		events: [],
		matchStartMs: performance.now(),
		lastPlayerKillMs: -Infinity,
		lowHpFlaggedAt: -1,
		snapshots: [],
		lastSnapshotMs: 0,
		bucketKills: 0,
		bucketHits: 0,
		bucketShots: 0,
	};
}

function startWave(s: GameRuntime, wave: number) {
	s.wave = wave;
	s.zombiesToSpawn = 5 + wave * 4;
	s.spawnTimer = 0.4;
	s.bannerText = `WAVE ${wave}`;
	s.bannerTime = 2.4;
	s.bannerMaxTime = 2.4;
}

function spawnZombie(s: GameRuntime) {
	const wave = s.wave;
	const margin = 50;
	const side = Math.floor(Math.random() * 4);
	const pos: Vec =
		side === 0
			? { x: rand(0, ARENA_W), y: -margin }
			: side === 1
				? { x: ARENA_W + margin, y: rand(0, ARENA_H) }
				: side === 2
					? { x: rand(0, ARENA_W), y: ARENA_H + margin }
					: { x: -margin, y: rand(0, ARENA_H) };

	let type: ZombieType = "walker";
	let hp = 30 + wave * 6;
	let speed = 75 + wave * 3.5;
	let radius = 14;
	let damage = 14;
	const r = Math.random();
	if (wave >= 3 && r < 0.26) {
		type = "runner";
		hp = 18 + wave * 3;
		speed = 145 + wave * 4;
		radius = 11;
		damage = 9;
	} else if (wave >= 2 && r < 0.38) {
		type = "brute";
		hp = 110 + wave * 18;
		speed = 48 + wave * 1.4;
		radius = 22;
		damage = 24;
	}

	s.zombies.push({
		pos,
		vel: { x: 0, y: 0 },
		hp,
		maxHp: hp,
		speed,
		radius,
		damage,
		type,
		hitFlash: 0,
		wobble: Math.random() * Math.PI * 2,
	});
}

function nearestZombie(s: GameRuntime, from: Vec, maxDist: number) {
	let best: Zombie | null = null;
	let bestD = maxDist;
	for (const z of s.zombies) {
		const d = Math.hypot(z.pos.x - from.x, z.pos.y - from.y);
		if (d < bestD) {
			bestD = d;
			best = z;
		}
	}
	return best;
}

function fireBullet(
	s: GameRuntime,
	pos: Vec,
	angle: number,
	dmg: number,
	team: "player" | "ally",
	owner: string,
) {
	const offsetR = 18;
	const sx = pos.x + Math.cos(angle) * offsetR;
	const sy = pos.y + Math.sin(angle) * offsetR;
	s.bullets.push({
		pos: { x: sx, y: sy },
		startPos: { x: sx, y: sy },
		vel: {
			x: Math.cos(angle) * BULLET_SPEED,
			y: Math.sin(angle) * BULLET_SPEED,
		},
		damage: dmg,
		ttl: 1.2,
		team,
		owner,
	});
}

function spawnMuzzleFlash(s: GameRuntime, pos: Vec, angle: number) {
	for (let i = 0; i < 5; i++) {
		s.particles.push({
			pos: { x: pos.x + Math.cos(angle) * 18, y: pos.y + Math.sin(angle) * 18 },
			vel: {
				x: Math.cos(angle) * rand(80, 200) + rand(-50, 50),
				y: Math.sin(angle) * rand(80, 200) + rand(-50, 50),
			},
			life: 0.18,
			maxLife: 0.18,
			color: chance(0.5) ? "#fff2a8" : "#ffd24a",
			size: rand(2, 4.5),
		});
	}
}

function spawnBlood(s: GameRuntime, pos: Vec, count: number) {
	for (let i = 0; i < count; i++) {
		const a = Math.random() * Math.PI * 2;
		const speed = rand(40, 220);
		s.particles.push({
			pos: { x: pos.x, y: pos.y },
			vel: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
			life: rand(0.4, 0.9),
			maxLife: 0.9,
			color: chance(0.7) ? "#9a1313" : "#5b0c0c",
			size: rand(2, 5),
		});
	}
}

function triggerShake(s: GameRuntime, time: number, mag: number) {
	s.shakeTime = Math.max(s.shakeTime, time);
	s.shakeMag = Math.max(s.shakeMag, mag);
}

function update(s: GameRuntime, dt: number) {
	if (s.phase !== "playing" || s.paused) return;
	const d = Math.min(dt, 0.05);
	updatePlayer(s, d);
	updateAllies(s, d);
	updateZombies(s, d);
	updateBullets(s, d);
	updateParticles(s, d);
	updateTexts(s, d);
	spawnLogic(s, d);
	if (s.shakeTime > 0) s.shakeTime -= d;
	if (s.bannerTime > 0) s.bannerTime -= d;

	// Track when the player first dips below 25% HP — used by low_hp_save.
	const hpFrac = s.player.hp / s.player.maxHp;
	if (hpFrac < 0.25 && s.lowHpFlaggedAt < 0) {
		s.lowHpFlaggedAt = nowT(s);
	} else if (hpFrac >= 0.4) {
		s.lowHpFlaggedAt = -1;
	}

	// Sample a telemetry snapshot every ~250ms.
	const tNow = nowT(s);
	if (tNow - s.lastSnapshotMs >= 250) {
		let runners = 0;
		let brutes = 0;
		let nearestD = 1e9;
		for (const z of s.zombies) {
			if (z.type === "runner") runners += 1;
			else if (z.type === "brute") brutes += 1;
			const dd = Math.hypot(
				z.pos.x - s.player.pos.x,
				z.pos.y - s.player.pos.y,
			);
			if (dd < nearestD) nearestD = dd;
		}
		const allyAlive = s.allies.reduce((n, a) => n + (a.alive ? 1 : 0), 0);
		const dist01 = nearestD < 1e8 ? Math.max(0, 1 - nearestD / 600) : 0;
		const density01 = Math.min(1, s.zombies.length / 8);
		const threatProxim = Math.min(1, dist01 * 0.7 + density01 * 0.5);
		s.snapshots.push({
			t: tNow,
			playerHpFrac: hpFrac,
			alliesAlive: allyAlive,
			zombiesOnScreen: s.zombies.length,
			zombieRunners: runners,
			zombieBrutes: brutes,
			threatProxim,
			killsBucket: s.bucketKills,
			hitsTakenBucket: Math.round(s.bucketHits),
			shotsFiredBucket: s.bucketShots,
			wave: s.wave,
		});
		s.lastSnapshotMs = tNow;
		s.bucketKills = 0;
		s.bucketHits = 0;
		s.bucketShots = 0;
	}

	if (s.player.hp <= 0) {
		s.phase = "gameover";
		s.bannerText = "OVERRUN";
		s.bannerTime = 9999;
		s.bannerMaxTime = 1;
		spawnBlood(s, s.player.pos, 30);
		s.events.push({
			kind: "match_end",
			t: nowT(s),
			result: "loss",
			durationMs: nowT(s),
		});
	}
}

function updatePlayer(s: GameRuntime, dt: number) {
	const p = s.player;
	let dx = 0;
	let dy = 0;
	if (s.keys.has("w") || s.keys.has("arrowup")) dy -= 1;
	if (s.keys.has("s") || s.keys.has("arrowdown")) dy += 1;
	if (s.keys.has("a") || s.keys.has("arrowleft")) dx -= 1;
	if (s.keys.has("d") || s.keys.has("arrowright")) dx += 1;
	const m = Math.hypot(dx, dy);
	if (m > 0) {
		dx /= m;
		dy /= m;
	}
	p.pos.x = clamp(
		p.pos.x + dx * PLAYER_SPEED * dt,
		PLAYER_RADIUS,
		ARENA_W - PLAYER_RADIUS,
	);
	p.pos.y = clamp(
		p.pos.y + dy * PLAYER_SPEED * dt,
		PLAYER_RADIUS,
		ARENA_H - PLAYER_RADIUS,
	);
	resolveObstacleCollision(p.pos, PLAYER_RADIUS, s.obstacles);
	p.pos.x = clamp(p.pos.x, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS);
	p.pos.y = clamp(p.pos.y, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS);
	p.angle = Math.atan2(s.mouse.y - p.pos.y, s.mouse.x - p.pos.x);
	p.cooldown = Math.max(0, p.cooldown - dt);
	p.hitFlash = Math.max(0, p.hitFlash - dt);
	if (s.shooting && p.cooldown <= 0) {
		fireBullet(s, p.pos, p.angle, BULLET_DAMAGE, "player", "player");
		spawnMuzzleFlash(s, p.pos, p.angle);
		s.sfx?.play("playerShoot");
		p.cooldown = PLAYER_FIRE_RATE;
		s.bucketShots += 1;
	}
}

function updateAllies(s: GameRuntime, dt: number) {
	for (const a of s.allies) {
		if (!a.alive) {
			a.respawnTimer -= dt;
			continue;
		}
		a.cooldown = Math.max(0, a.cooldown - dt);
		a.hitFlash = Math.max(0, a.hitFlash - dt);

		const z = nearestZombie(s, a.pos, ALLY_AIM_RANGE);
		let desiredX = a.pos.x;
		let desiredY = a.pos.y;

		if (z) {
			// Hold ideal firing distance from the target.
			const dx = a.pos.x - z.pos.x;
			const dy = a.pos.y - z.pos.y;
			const d = Math.hypot(dx, dy) || 1;
			desiredX = z.pos.x + (dx / d) * ALLY_IDEAL_RANGE;
			desiredY = z.pos.y + (dy / d) * ALLY_IDEAL_RANGE;
			a.angle = Math.atan2(z.pos.y - a.pos.y, z.pos.x - a.pos.x);
			if (a.cooldown <= 0) {
				fireBullet(s, a.pos, a.angle, ALLY_BULLET_DAMAGE, "ally", `ally:${a.uniform}`);
				spawnMuzzleFlash(s, a.pos, a.angle);
				s.sfx?.play("allyShoot");
				a.cooldown = ALLY_FIRE_RATE;
			}
		} else {
			// No threats: only regroup if the player has wandered out of leash.
			const pdx = s.player.pos.x - a.pos.x;
			const pdy = s.player.pos.y - a.pos.y;
			const pd = Math.hypot(pdx, pdy);
			if (pd > ALLY_LEASH) {
				const t = (pd - ALLY_LEASH * 0.6) / pd;
				desiredX = a.pos.x + pdx * t;
				desiredY = a.pos.y + pdy * t;
			}
			a.angle = s.player.angle;
		}

		// Spread out from other allies so they don't bunch up.
		for (const b of s.allies) {
			if (b === a || !b.alive) continue;
			const sdx = a.pos.x - b.pos.x;
			const sdy = a.pos.y - b.pos.y;
			const sd = Math.hypot(sdx, sdy);
			if (sd > 0 && sd < ALLY_SEPARATION) {
				const force = (ALLY_SEPARATION - sd) / ALLY_SEPARATION;
				desiredX += (sdx / sd) * force * 60;
				desiredY += (sdy / sd) * force * 60;
			}
		}

		const mdx = desiredX - a.pos.x;
		const mdy = desiredY - a.pos.y;
		const md = Math.hypot(mdx, mdy);
		if (md > 4) {
			const move = Math.min(md, ALLY_SPEED * dt);
			a.pos.x += (mdx / md) * move;
			a.pos.y += (mdy / md) * move;
		}
		resolveObstacleCollision(a.pos, ALLY_RADIUS, s.obstacles);
		a.pos.x = clamp(a.pos.x, ALLY_RADIUS, ARENA_W - ALLY_RADIUS);
		a.pos.y = clamp(a.pos.y, ALLY_RADIUS, ARENA_H - ALLY_RADIUS);
	}
}

type ZombieTarget =
	| { pos: Vec; isPlayer: true }
	| { pos: Vec; isPlayer: false; ally: Ally };

function updateZombies(s: GameRuntime, dt: number) {
	for (const z of s.zombies) {
		z.wobble += dt * 5;
		let best: ZombieTarget = { pos: s.player.pos, isPlayer: true };
		let bestD = Math.hypot(s.player.pos.x - z.pos.x, s.player.pos.y - z.pos.y);
		for (const a of s.allies) {
			if (!a.alive) continue;
			const d = Math.hypot(a.pos.x - z.pos.x, a.pos.y - z.pos.y);
			if (d < bestD) {
				bestD = d;
				best = { pos: a.pos, isPlayer: false, ally: a };
			}
		}
		const dx = best.pos.x - z.pos.x;
		const dy = best.pos.y - z.pos.y;
		const d = Math.hypot(dx, dy) || 1;
		const wobbleScale = z.type === "runner" ? 0.25 : 0.55;
		z.vel.x = (dx / d) * z.speed + Math.cos(z.wobble) * 14 * wobbleScale;
		z.vel.y = (dy / d) * z.speed + Math.sin(z.wobble * 0.7) * 10 * wobbleScale;
		z.pos.x += z.vel.x * dt;
		z.pos.y += z.vel.y * dt;
		resolveObstacleCollision(z.pos, z.radius, s.obstacles);
		z.hitFlash = Math.max(0, z.hitFlash - dt);
		const targetRadius = best.isPlayer ? PLAYER_RADIUS : ALLY_RADIUS;
		if (d < z.radius + targetRadius) {
			const dmg = z.damage * dt;
			if (best.isPlayer) {
				s.player.hp = Math.max(0, s.player.hp - dmg);
				s.player.hitFlash = 0.15;
				triggerShake(s, 0.18, 6);
				s.sfx?.play("playerHurt");
				s.bucketHits += dmg;
			} else {
				best.ally.hp = Math.max(0, best.ally.hp - dmg);
				best.ally.hitFlash = 0.15;
				if (best.ally.hp <= 0 && best.ally.alive) {
					best.ally.alive = false;
					best.ally.respawnTimer = 0;
					spawnBlood(s, best.ally.pos, 18);
					s.events.push({
						kind: "ally_death",
						t: nowT(s),
						victim: `ally:${best.ally.uniform}`,
					});
				}
			}
		}
	}
	resolveZombieCollisions(s);
}

function resolveZombieCollisions(s: GameRuntime) {
	for (let i = 0; i < s.zombies.length; i++) {
		for (let j = i + 1; j < s.zombies.length; j++) {
			const a = s.zombies[i];
			const b = s.zombies[j];
			if (!a || !b) continue;
			const dx = b.pos.x - a.pos.x;
			const dy = b.pos.y - a.pos.y;
			const d = Math.hypot(dx, dy);
			const min = a.radius + b.radius;
			if (d > 0 && d < min) {
				const overlap = (min - d) / 2;
				const ux = dx / d;
				const uy = dy / d;
				a.pos.x -= ux * overlap;
				a.pos.y -= uy * overlap;
				b.pos.x += ux * overlap;
				b.pos.y += uy * overlap;
			}
		}
	}
}

function updateBullets(s: GameRuntime, dt: number) {
	for (let i = s.bullets.length - 1; i >= 0; i--) {
		const b = s.bullets[i];
		if (!b) continue;
		b.pos.x += b.vel.x * dt;
		b.pos.y += b.vel.y * dt;
		b.ttl -= dt;
		if (
			b.ttl <= 0 ||
			b.pos.x < -20 ||
			b.pos.y < -20 ||
			b.pos.x > ARENA_W + 20 ||
			b.pos.y > ARENA_H + 20
		) {
			s.bullets.splice(i, 1);
			continue;
		}
		if (bulletHitsObstacle(b.pos, s.obstacles)) {
			for (let k = 0; k < 4; k++) {
				s.particles.push({
					pos: { x: b.pos.x, y: b.pos.y },
					vel: { x: rand(-120, 120), y: rand(-120, 120) },
					life: 0.18,
					maxLife: 0.18,
					color: "#d8c9a3",
					size: rand(1.5, 3),
				});
			}
			s.bullets.splice(i, 1);
			continue;
		}
		let hit = false;
		for (let j = s.zombies.length - 1; j >= 0; j--) {
			const z = s.zombies[j];
			if (!z) continue;
			const dx = z.pos.x - b.pos.x;
			const dy = z.pos.y - b.pos.y;
			if (dx * dx + dy * dy < (z.radius + 4) * (z.radius + 4)) {
				z.hp -= b.damage;
				z.hitFlash = 0.1;
				spawnBlood(s, b.pos, 4);
				s.texts.push({
					pos: { x: z.pos.x, y: z.pos.y - z.radius },
					vel: { x: 0, y: -30 },
					text: `${Math.round(b.damage)}`,
					life: 0.6,
					color: b.team === "player" ? "#ffe26a" : "#a8e6ff",
				});
				if (z.hp <= 0) {
					s.zombies.splice(j, 1);
					s.kills += 1;
					if (b.team === "player") s.bucketKills += 1;
					spawnBlood(s, z.pos, 16);
					s.sfx?.play("zombieKill");
					const range = Math.hypot(
						b.pos.x - b.startPos.x,
						b.pos.y - b.startPos.y,
					);
					const t = nowT(s);
					if (b.team === "player") {
						// Sentinel for "no prior kill" — Infinity would JSON-serialize
						// to null and crash downstream consumers.
						const chainSeconds =
							s.lastPlayerKillMs < 0
								? 9999
								: (t - s.lastPlayerKillMs) / 1000;
						s.events.push({
							kind: "kill",
							t,
							killer: "player",
							victim: `zombie:${z.type}`,
							killerHp: Math.round(s.player.hp),
							killerMaxHp: s.player.maxHp,
							victimKind: z.type,
							range,
							chainSeconds,
						});
						s.lastPlayerKillMs = t;
						if (range > 350) {
							s.events.push({
								kind: "long_shot",
								t,
								killer: "player",
								range,
							});
						}
						// Low-HP save: if the kill closed a window where player
						// was flagged below 25%, fire a save event.
						if (
							s.lowHpFlaggedAt > 0 &&
							t - s.lowHpFlaggedAt < 1500 &&
							s.player.hp > 0
						) {
							s.events.push({
								kind: "low_hp_save",
								t,
								subject: "player",
								hpAfter: Math.round(s.player.hp),
							});
							s.lowHpFlaggedAt = -1;
						}
					} else {
						s.events.push({
							kind: "ally_kill",
							t,
							killer: b.owner,
							victim: `zombie:${z.type}`,
						});
					}
				} else {
					s.sfx?.play("zombieHit");
				}
				hit = true;
				break;
			}
		}
		if (hit) s.bullets.splice(i, 1);
	}
}

function updateParticles(s: GameRuntime, dt: number) {
	for (let i = s.particles.length - 1; i >= 0; i--) {
		const p = s.particles[i];
		if (!p) continue;
		p.pos.x += p.vel.x * dt;
		p.pos.y += p.vel.y * dt;
		p.vel.x *= 0.9;
		p.vel.y *= 0.9;
		p.life -= dt;
		if (p.life <= 0) s.particles.splice(i, 1);
	}
}

function updateTexts(s: GameRuntime, dt: number) {
	for (let i = s.texts.length - 1; i >= 0; i--) {
		const t = s.texts[i];
		if (!t) continue;
		t.pos.x += t.vel.x * dt;
		t.pos.y += t.vel.y * dt;
		t.life -= dt;
		if (t.life <= 0) s.texts.splice(i, 1);
	}
}

function spawnLogic(s: GameRuntime, dt: number) {
	if (s.zombiesToSpawn > 0) {
		s.spawnTimer -= dt;
		if (s.spawnTimer <= 0) {
			spawnZombie(s);
			s.zombiesToSpawn -= 1;
			s.spawnTimer = clamp(0.6 - s.wave * 0.05, 0.12, 0.6);
		}
	} else if (s.zombies.length === 0) {
		if (s.waveBreak <= 0) {
			s.waveBreak = WAVE_BREAK_SECONDS;
			s.player.hp = Math.min(
				s.player.maxHp,
				s.player.hp + s.player.maxHp * 0.2,
			);
			for (const a of s.allies) {
				if (a.alive) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.3);
			}
		}
		s.waveBreak -= dt;
		if (s.waveBreak <= 0) {
			startWave(s, s.wave + 1);
			s.waveBreak = 0;
		}
	}
}

function render(ctx: CanvasRenderingContext2D, s: GameRuntime) {
	ctx.save();
	if (s.shakeTime > 0) {
		const m = s.shakeMag * (s.shakeTime / 0.18);
		ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
	}
	drawGround(ctx);

	type DrawItem = { y: number; draw: () => void };
	const items: DrawItem[] = [];
	for (const a of s.allies) {
		if (a.alive) items.push({ y: a.pos.y, draw: () => drawAlly(ctx, a) });
		else items.push({ y: a.pos.y, draw: () => drawDeadAlly(ctx, a) });
	}
	items.push({ y: s.player.pos.y, draw: () => drawPlayer(ctx, s.player) });
	for (const z of s.zombies)
		items.push({ y: z.pos.y, draw: () => drawZombie(ctx, z) });
	for (const o of s.obstacles)
		items.push({ y: obstacleBottomY(o), draw: () => drawObstacle(ctx, o) });
	items.sort((a, b) => a.y - b.y);
	for (const it of items) it.draw();

	for (const b of s.bullets) drawBullet(ctx, b);
	for (const p of s.particles) drawParticle(ctx, p);

	for (const z of s.zombies) {
		drawHpBar(ctx, z.pos, z.hp, z.maxHp, z.radius + 8, 28, 4, "#e25b5b");
	}
	for (const a of s.allies) {
		if (a.alive && a.hp < a.maxHp) {
			drawHpBar(ctx, a.pos, a.hp, a.maxHp, ALLY_RADIUS + 12, 28, 4, "#7be37b");
		}
	}

	for (const t of s.texts) {
		ctx.globalAlpha = clamp(t.life / 0.6, 0, 1);
		ctx.fillStyle = t.color;
		ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(t.text, t.pos.x, t.pos.y);
	}
	ctx.globalAlpha = 1;
	ctx.restore();

	drawVignette(ctx);
	if (s.bannerTime > 0 && s.bannerText && s.phase !== "gameover") {
		drawBanner(ctx, s.bannerText, s.bannerTime, s.bannerMaxTime);
	}
	drawCrosshair(ctx, s.mouse);
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle) {
	ctx.save();
	if (o.kind === "barrel") {
		ctx.beginPath();
		ctx.ellipse(o.x, o.y + o.r * 0.6, o.r * 0.95, o.r * 0.4, 0, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(0,0,0,0.4)";
		ctx.fill();
		ctx.beginPath();
		ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
		ctx.fillStyle = "#5a3a1f";
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.55)";
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(o.x, o.y, o.r * 0.7, 0, Math.PI * 2);
		ctx.strokeStyle = "#3a2410";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(o.x, o.y, o.r * 0.3, 0, Math.PI * 2);
		ctx.fillStyle = "#3a2410";
		ctx.fill();
	} else if (o.kind === "crate") {
		ctx.fillStyle = "rgba(0,0,0,0.4)";
		ctx.fillRect(o.x + 3, o.y + 5, o.w, o.h);
		const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
		grad.addColorStop(0, "#8a6a3a");
		grad.addColorStop(1, "#5e4422");
		ctx.fillStyle = grad;
		ctx.fillRect(o.x, o.y, o.w, o.h);
		ctx.strokeStyle = "#2d1d0c";
		ctx.lineWidth = 2;
		ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
		ctx.beginPath();
		ctx.moveTo(o.x + 4, o.y + 4);
		ctx.lineTo(o.x + o.w - 4, o.y + o.h - 4);
		ctx.moveTo(o.x + o.w - 4, o.y + 4);
		ctx.lineTo(o.x + 4, o.y + o.h - 4);
		ctx.stroke();
	} else {
		ctx.fillStyle = "rgba(0,0,0,0.4)";
		ctx.fillRect(o.x + 2, o.y + 5, o.w, o.h);
		const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
		grad.addColorStop(0, "#a89868");
		grad.addColorStop(1, "#6e5e36");
		ctx.fillStyle = grad;
		ctx.fillRect(o.x, o.y, o.w, o.h);
		ctx.strokeStyle = "rgba(0,0,0,0.45)";
		ctx.lineWidth = 1;
		const isHoriz = o.w > o.h;
		const segLen = 26;
		const count = Math.max(2, Math.round((isHoriz ? o.w : o.h) / segLen));
		for (let i = 1; i < count; i++) {
			ctx.beginPath();
			if (isHoriz) {
				const x = o.x + (o.w / count) * i;
				ctx.moveTo(x, o.y);
				ctx.lineTo(x, o.y + o.h);
			} else {
				const y = o.y + (o.h / count) * i;
				ctx.moveTo(o.x, y);
				ctx.lineTo(o.x + o.w, y);
			}
			ctx.stroke();
		}
		ctx.strokeStyle = "#3e3318";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
	}
	ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D) {
	const grad = ctx.createRadialGradient(
		ARENA_W / 2,
		ARENA_H / 2,
		100,
		ARENA_W / 2,
		ARENA_H / 2,
		Math.max(ARENA_W, ARENA_H) * 0.7,
	);
	grad.addColorStop(0, "#23381f");
	grad.addColorStop(1, "#0e1a0c");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, ARENA_W, ARENA_H);
	ctx.strokeStyle = "rgba(255,255,255,0.04)";
	ctx.lineWidth = 1;
	for (let x = 0; x < ARENA_W; x += 60) {
		ctx.beginPath();
		ctx.moveTo(x + 0.5, 0);
		ctx.lineTo(x + 0.5, ARENA_H);
		ctx.stroke();
	}
	for (let y = 0; y < ARENA_H; y += 60) {
		ctx.beginPath();
		ctx.moveTo(0, y + 0.5);
		ctx.lineTo(ARENA_W, y + 0.5);
		ctx.stroke();
	}
	ctx.strokeStyle = "rgba(255, 70, 70, 0.55)";
	ctx.lineWidth = 3;
	ctx.strokeRect(1.5, 1.5, ARENA_W - 3, ARENA_H - 3);
}

function drawSoldier(
	ctx: CanvasRenderingContext2D,
	pos: Vec,
	angle: number,
	uniform: string,
	headband: string,
	radius: number,
	hitFlash: number,
) {
	ctx.save();
	ctx.translate(pos.x, pos.y);
	ctx.shadowColor = "rgba(0,0,0,0.5)";
	ctx.shadowBlur = 6;
	ctx.shadowOffsetY = 2;
	ctx.beginPath();
	ctx.ellipse(0, radius * 0.7, radius * 0.85, radius * 0.35, 0, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
	ctx.rotate(angle);

	// Rifle
	ctx.fillStyle = "#1a1a1a";
	ctx.fillRect(radius * 0.4, -2, radius * 1.5, 4);
	ctx.fillStyle = "#3a3a3a";
	ctx.fillRect(radius * 0.2, -3, radius * 0.4, 6);

	// Body
	ctx.beginPath();
	ctx.arc(0, 0, radius, 0, Math.PI * 2);
	ctx.fillStyle = uniform;
	ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.4)";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// Vest detail
	ctx.fillStyle = "rgba(0,0,0,0.25)";
	ctx.fillRect(-radius * 0.7, -radius * 0.5, radius * 0.9, radius);

	// Headband (around upper part of head)
	ctx.beginPath();
	ctx.arc(0, 0, radius * 0.55, -Math.PI * 0.85, -Math.PI * 0.15, false);
	ctx.lineWidth = 3;
	ctx.strokeStyle = headband;
	ctx.stroke();

	// Helmet/face accent
	ctx.beginPath();
	ctx.arc(radius * 0.15, 0, radius * 0.45, 0, Math.PI * 2);
	ctx.fillStyle = "#ddc59a";
	ctx.fill();

	if (hitFlash > 0) {
		ctx.globalAlpha = clamp(hitFlash / 0.15, 0, 1) * 0.65;
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.globalAlpha = 1;
	}
	ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: Player) {
	drawSoldier(
		ctx,
		p.pos,
		p.angle,
		"#3d6e3a",
		"#ffffff",
		PLAYER_RADIUS,
		p.hitFlash,
	);
	// Player ring marker
	ctx.beginPath();
	ctx.arc(p.pos.x, p.pos.y, PLAYER_RADIUS + 4, 0, Math.PI * 2);
	ctx.strokeStyle = "rgba(120, 220, 120, 0.55)";
	ctx.lineWidth = 1.5;
	ctx.stroke();
}

function drawAlly(ctx: CanvasRenderingContext2D, a: Ally) {
	drawSoldier(
		ctx,
		a.pos,
		a.angle,
		a.uniform,
		a.headband,
		ALLY_RADIUS,
		a.hitFlash,
	);
}

function drawDeadAlly(ctx: CanvasRenderingContext2D, a: Ally) {
	ctx.save();
	ctx.translate(a.pos.x, a.pos.y);
	ctx.beginPath();
	ctx.arc(0, 0, ALLY_RADIUS, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(70,40,40,0.65)";
	ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.4)";
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.restore();
}

function drawZombie(ctx: CanvasRenderingContext2D, z: Zombie) {
	ctx.save();
	ctx.translate(z.pos.x, z.pos.y);
	// Shadow
	ctx.beginPath();
	ctx.ellipse(
		0,
		z.radius * 0.7,
		z.radius * 0.85,
		z.radius * 0.35,
		0,
		0,
		Math.PI * 2,
	);
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	ctx.fill();

	const angle = Math.atan2(z.vel.y, z.vel.x);
	ctx.rotate(angle);

	// Body
	const bodyColor =
		z.type === "brute"
			? "#3a4a25"
			: z.type === "runner"
				? "#5a5a30"
				: "#4a5a32";
	ctx.beginPath();
	ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
	ctx.fillStyle = bodyColor;
	ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.5)";
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// Ragged tear marks
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	ctx.fillRect(-z.radius * 0.5, -z.radius * 0.15, z.radius * 0.6, 3);
	ctx.fillRect(-z.radius * 0.2, z.radius * 0.2, z.radius * 0.5, 2);

	// Face / eyes
	ctx.fillStyle = "#3a2a22";
	ctx.beginPath();
	ctx.arc(z.radius * 0.2, 0, z.radius * 0.5, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#ff3030";
	ctx.beginPath();
	ctx.arc(z.radius * 0.4, -z.radius * 0.18, z.radius * 0.13, 0, Math.PI * 2);
	ctx.arc(z.radius * 0.4, z.radius * 0.18, z.radius * 0.13, 0, Math.PI * 2);
	ctx.fill();

	if (z.type === "brute") {
		ctx.strokeStyle = "#1a1a1a";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(0, 0, z.radius - 3, 0, Math.PI * 2);
		ctx.stroke();
	}

	if (z.hitFlash > 0) {
		ctx.globalAlpha = clamp(z.hitFlash / 0.1, 0, 1) * 0.7;
		ctx.beginPath();
		ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.globalAlpha = 1;
	}
	ctx.restore();
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet) {
	const angle = Math.atan2(b.vel.y, b.vel.x);
	ctx.save();
	ctx.translate(b.pos.x, b.pos.y);
	ctx.rotate(angle);
	ctx.shadowColor =
		b.team === "player"
			? "rgba(255, 220, 80, 0.9)"
			: "rgba(140, 200, 255, 0.9)";
	ctx.shadowBlur = 8;
	ctx.fillStyle = b.team === "player" ? "#ffe26a" : "#a8d8ff";
	ctx.fillRect(-6, -1.5, 12, 3);
	ctx.restore();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
	const a = clamp(p.life / p.maxLife, 0, 1);
	ctx.globalAlpha = a;
	ctx.fillStyle = p.color;
	ctx.beginPath();
	ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;
}

function drawHpBar(
	ctx: CanvasRenderingContext2D,
	pos: Vec,
	hp: number,
	maxHp: number,
	yOffset: number,
	width: number,
	height: number,
	color: string,
) {
	const x = pos.x - width / 2;
	const y = pos.y - yOffset;
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
	ctx.fillStyle = "#1a1a1a";
	ctx.fillRect(x, y, width, height);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width * clamp(hp / maxHp, 0, 1), height);
}

function drawVignette(ctx: CanvasRenderingContext2D) {
	const grad = ctx.createRadialGradient(
		ARENA_W / 2,
		ARENA_H / 2,
		ARENA_H * 0.4,
		ARENA_W / 2,
		ARENA_H / 2,
		Math.max(ARENA_W, ARENA_H) * 0.75,
	);
	grad.addColorStop(0, "rgba(0,0,0,0)");
	grad.addColorStop(1, "rgba(0,0,0,0.55)");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, ARENA_W, ARENA_H);
}

function drawBanner(
	ctx: CanvasRenderingContext2D,
	text: string,
	time: number,
	maxTime: number,
) {
	const t = clamp(time / maxTime, 0, 1);
	const fade = t > 0.7 ? (1 - t) / 0.3 : t < 0.2 ? t / 0.2 : 1;
	ctx.globalAlpha = clamp(fade, 0, 1);
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.fillRect(0, ARENA_H / 2 - 50, ARENA_W, 100);
	ctx.fillStyle = "#ffffff";
	ctx.font = "bold 56px ui-sans-serif, system-ui, sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, ARENA_W / 2, ARENA_H / 2);
	ctx.globalAlpha = 1;
}

function drawCrosshair(ctx: CanvasRenderingContext2D, mouse: Vec) {
	ctx.save();
	ctx.translate(mouse.x, mouse.y);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(0, 0, 12, 0, Math.PI * 2);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(-16, 0);
	ctx.lineTo(-6, 0);
	ctx.moveTo(6, 0);
	ctx.lineTo(16, 0);
	ctx.moveTo(0, -16);
	ctx.lineTo(0, -6);
	ctx.moveTo(0, 6);
	ctx.lineTo(0, 16);
	ctx.stroke();
	ctx.restore();
}

export default function Game() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const stateRef = useRef<GameRuntime>(createInitialState());
	const musicRef = useRef<MusicEngine | null>(null);
	const sfxRef = useRef<SfxEngine | null>(null);
	const [, setTick] = useState(0);
	const [muted, setMuted] = useState(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const eventsRef = useRef<GameEvent[]>([]);
	const snapshotsRef = useRef<FeatureSnapshot[]>([]);
	const matchEndedAtRef = useRef<number>(0);
	const [matchSummary, setMatchSummary] = useState<{
		eventCount: number;
		snapshotCount: number;
		blobUrl: string | null;
	}>({ eventCount: 0, snapshotCount: 0, blobUrl: null });
	const [viralState, setViralState] = useState<{
		status: "idle" | "detecting" | "done";
		moments: ViralMoment[];
	}>({ status: "idle", moments: [] });
	const [editState, setEditState] = useState<{
		status: "idle" | "loading" | "done" | "error";
		plan: EditPlan | null;
	}>({ status: "idle", plan: null });
	const [videoState, setVideoState] = useState<{
		status: "idle" | "rendering" | "done" | "error";
		progress: number;
		blobUrl: string | null;
	}>({ status: "idle", progress: 0, blobUrl: null });
	const [hud, setHud] = useState({
		hp: PLAYER_MAX_HP,
		maxHp: PLAYER_MAX_HP,
		wave: 0,
		kills: 0,
		alliesAlive: 3,
		alliesTotal: 3,
		phase: "menu" as Phase,
		paused: false,
	});

	useEffect(() => {
		musicRef.current = createMusicEngine();
		sfxRef.current = createSfxEngine();
		stateRef.current.sfx = sfxRef.current;
		return () => {
			musicRef.current?.dispose();
			sfxRef.current?.dispose();
			musicRef.current = null;
			sfxRef.current = null;
		};
	}, []);

	useEffect(() => {
		musicRef.current?.setMuted(muted);
		sfxRef.current?.setMuted(muted);
	}, [muted]);

	useEffect(() => {
		const m = musicRef.current;
		if (!m) return;
		if (hud.phase === "playing" && !hud.paused) m.start();
		else m.stop();
	}, [hud.phase, hud.paused]);

	// On gameover: stop recorder, run the viral-moment classifier on the
	// captured events + telemetry. Edit CTA only shows up if anything
	// scored above the viral threshold.
	useEffect(() => {
		if (hud.phase !== "gameover") return;
		const events = [...stateRef.current.events];
		const snapshots = [...stateRef.current.snapshots];
		eventsRef.current = events;
		snapshotsRef.current = snapshots;
		matchEndedAtRef.current = Date.now();
		setMatchSummary({
			eventCount: events.length,
			snapshotCount: snapshots.length,
			blobUrl: null,
		});
		setViralState({ status: "detecting", moments: [] });

		const finishUp = async (blob: Blob | null) => {
			const blobUrl = blob ? URL.createObjectURL(blob) : null;
			setMatchSummary({
				eventCount: events.length,
				snapshotCount: snapshots.length,
				blobUrl,
			});
			try {
				const res = await fetch("/api/viral-detect", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ events, snapshots }),
				});
				if (!res.ok) throw new Error(`viral-detect ${res.status}`);
				const json = (await res.json()) as { moments: ViralMoment[] };
				setViralState({
					status: "done",
					moments: json.moments ?? [],
				});
			} catch (err) {
				console.error("[game] viral-detect failed", err);
				setViralState({ status: "done", moments: [] });
			}
		};

		const rec = recorderRef.current;
		if (rec && rec.state === "recording") {
			rec.onstop = () => {
				const blob =
					chunksRef.current.length > 0
						? new Blob(chunksRef.current, { type: "video/webm" })
						: null;
				void finishUp(blob);
			};
			try {
				rec.stop();
			} catch {
				void finishUp(null);
			}
		} else {
			void finishUp(null);
		}
	}, [hud.phase]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = ARENA_W * dpr;
		canvas.height = ARENA_H * dpr;
		canvas.style.width = `${ARENA_W}px`;
		canvas.style.height = `${ARENA_H}px`;
		ctx.scale(dpr, dpr);

		let raf = 0;
		let last = performance.now();
		let hudClock = 0;

		const onKeyDown = (e: KeyboardEvent) => {
			const k = e.key.toLowerCase();
			if (
				k === "w" ||
				k === "a" ||
				k === "s" ||
				k === "d" ||
				k === "arrowup" ||
				k === "arrowdown" ||
				k === "arrowleft" ||
				k === "arrowright"
			) {
				e.preventDefault();
			}
			if (k === "escape") {
				const s = stateRef.current;
				if (s.phase === "playing") s.paused = !s.paused;
				return;
			}
			stateRef.current.keys.add(k);
		};
		const onKeyUp = (e: KeyboardEvent) => {
			stateRef.current.keys.delete(e.key.toLowerCase());
		};
		const onMouseMove = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			stateRef.current.mouse = {
				x: ((e.clientX - rect.left) / rect.width) * ARENA_W,
				y: ((e.clientY - rect.top) / rect.height) * ARENA_H,
			};
		};
		const onMouseDown = (e: MouseEvent) => {
			if (e.button === 0) stateRef.current.shooting = true;
		};
		const onMouseUp = (e: MouseEvent) => {
			if (e.button === 0) stateRef.current.shooting = false;
		};
		const onBlur = () => {
			stateRef.current.keys.clear();
			stateRef.current.shooting = false;
		};
		const onContextMenu = (e: MouseEvent) => e.preventDefault();

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		canvas.addEventListener("mousemove", onMouseMove);
		canvas.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("blur", onBlur);
		canvas.addEventListener("contextmenu", onContextMenu);

		const loop = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			const s = stateRef.current;
			update(s, dt);
			render(ctx, s);

			hudClock += dt;
			if (hudClock > 0.1) {
				hudClock = 0;
				let alive = 0;
				for (const a of s.allies) if (a.alive) alive++;
				setHud({
					hp: Math.ceil(s.player.hp),
					maxHp: s.player.maxHp,
					wave: s.wave,
					kills: s.kills,
					alliesAlive: alive,
					alliesTotal: s.allies.length,
					phase: s.phase,
					paused: s.paused,
				});
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		setTick(1);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			canvas.removeEventListener("mousemove", onMouseMove);
			canvas.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("blur", onBlur);
			canvas.removeEventListener("contextmenu", onContextMenu);
		};
	}, []);

	const startMatchRecording = () => {
		const canvas = canvasRef.current;
		if (!canvas || typeof MediaRecorder === "undefined") return;
		chunksRef.current = [];
		let stream: MediaStream;
		try {
			stream = canvas.captureStream(30);
		} catch {
			return;
		}
		let mime = "";
		for (const t of [
			"video/webm;codecs=vp9",
			"video/webm;codecs=vp8",
			"video/webm",
		]) {
			if (MediaRecorder.isTypeSupported(t)) {
				mime = t;
				break;
			}
		}
		try {
			const r = mime
				? new MediaRecorder(stream, {
						mimeType: mime,
						videoBitsPerSecond: 2_500_000,
					})
				: new MediaRecorder(stream);
			r.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};
			r.start(200);
			recorderRef.current = r;
		} catch {
			recorderRef.current = null;
		}
	};

	const startGame = () => {
		const s = createInitialState();
		s.phase = "playing";
		s.sfx = sfxRef.current;
		s.matchStartMs = performance.now();
		startWave(s, 1);
		stateRef.current = s;
		musicRef.current?.start();
		sfxRef.current?.ensureStarted();
		setMatchSummary({ eventCount: 0, snapshotCount: 0, blobUrl: null });
		setViralState({ status: "idle", moments: [] });
		setEditState({ status: "idle", plan: null });
		setVideoState({ status: "idle", progress: 0, blobUrl: null });
		startMatchRecording();
	};

	const downloadTelemetry = () => {
		const payload = {
			exportedAt: new Date().toISOString(),
			matchEndedAt: matchEndedAtRef.current
				? new Date(matchEndedAtRef.current).toISOString()
				: null,
			summary: {
				wave: hud.wave,
				kills: hud.kills,
				eventCount: matchSummary.eventCount,
				snapshotCount: matchSummary.snapshotCount,
			},
			events: eventsRef.current,
			snapshots: snapshotsRef.current,
			viralMoments: viralState.moments,
			editPlan: editState.plan,
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `brrawl-session-${matchEndedAtRef.current || Date.now()}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	const requestEdit = useCallback(async () => {
		setEditState({ status: "loading", plan: null });
		setVideoState({ status: "idle", progress: 0, blobUrl: null });
		let plan: EditPlan;
		try {
			const res = await fetch("/api/edit-plan", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ events: eventsRef.current }),
			});
			if (!res.ok) throw new Error(`edit-plan ${res.status}`);
			plan = (await res.json()) as EditPlan;
			setEditState({ status: "done", plan });
		} catch (err) {
			console.error("[game] edit-plan failed", err);
			setEditState({ status: "error", plan: null });
			return;
		}

		const matchBlobUrl = matchSummary.blobUrl;
		if (!matchBlobUrl) {
			console.warn("[game] no match recording — skipping render");
			return;
		}

		setVideoState({ status: "rendering", progress: 0, blobUrl: null });
		try {
			const { blobUrl } = await renderEdit({
				matchBlobUrl,
				events: eventsRef.current,
				plan,
				onProgress: (p) =>
					setVideoState((s) => ({ ...s, status: "rendering", progress: p })),
			});
			setVideoState({ status: "done", progress: 1, blobUrl });
		} catch (err) {
			console.error("[game] render failed", err);
			setVideoState({ status: "error", progress: 0, blobUrl: null });
		}
	}, [matchSummary.blobUrl]);

	// Auto-build the edit when the classifier returns viral moments.
	useEffect(() => {
		if (viralState.status !== "done") return;
		if (viralState.moments.length === 0) return;
		if (editState.status !== "idle") return;
		void requestEdit();
	}, [viralState.status, viralState.moments.length, editState.status, requestEdit]);

	const resume = () => {
		stateRef.current.paused = false;
		musicRef.current?.start();
		sfxRef.current?.ensureStarted();
	};

	const M = MOODS.menacing;
	// Phone goes portrait only when the rendered vertical clip is ready —
	// every other state (menu, playing, paused, detecting, no_viral, while
	// the model is still working) shows a landscape phone.
	const orientation =
		hud.phase === "gameover" &&
		videoState.status === "done" &&
		videoState.blobUrl
			? "portrait"
			: "landscape";
	const inner = (
		<div
			className="relative flex h-full w-full select-none flex-col overflow-hidden"
			style={{
				background: M.surface,
				padding: "8px 12px",
				color: M.ink,
				fontFamily: "var(--font-sans), system-ui, sans-serif",
				borderRadius: 38,
			}}
		>
			<DeviceCorners color={M.accent} />
			{/* HUD — portrait layout: top row label + mute, second row stats + HP */}
			<div className="mb-2 flex flex-col gap-1.5">
				<div
					className="flex items-center gap-2"
					style={{
						fontFamily: FONT_MONO,
						fontSize: 9,
						letterSpacing: "0.18em",
						color: M.inkDim,
					}}
				>
					<span
						style={{
							width: 6,
							height: 6,
							background: M.accent,
							borderRadius: "50%",
							boxShadow: `0 0 8px ${M.accent}`,
						}}
					/>
					<span style={{ color: M.ink }}>VIRAL.LIVE</span>
					<span className="ml-auto">
						<button
							aria-label={muted ? "Unmute music" : "Mute music"}
							className="cursor-pointer"
							onClick={() => setMuted((m) => !m)}
							style={{
								fontFamily: FONT_MONO,
								fontSize: 9,
								letterSpacing: "0.2em",
								color: muted ? M.inkDim : M.accent,
								background: "transparent",
								border: `1px solid ${M.inkDim}40`,
								padding: "2px 8px",
							}}
							type="button"
						>
							♪ {muted ? "OFF" : "ON"}
						</button>
					</span>
				</div>
				<div className="flex items-center justify-between gap-2">
					<HudStat label="WAVE" value={String(hud.wave).padStart(2, "0")} mood={M} />
					<HudStat label="KILLS" value={String(hud.kills).padStart(3, "0")} mood={M} />
					<HudStat
						label="SQUAD"
						value={`${hud.alliesAlive}/${hud.alliesTotal}`}
						mood={M}
					/>
				</div>
				<HpStrip hp={hud.hp} max={hud.maxHp} mood={M} />
			</div>

			<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
				<div
					className="relative overflow-hidden"
					style={{
						height: "100%",
						aspectRatio: `${ARENA_W} / ${ARENA_H}`,
						maxWidth: "100%",
						borderRadius: 18,
						boxShadow: `inset 0 0 0 1px ${M.inkDim}30`,
					}}
				>
					<canvas
						className="absolute inset-0 block h-full w-full"
						ref={canvasRef}
						style={{
							cursor:
								hud.phase === "playing" && !hud.paused ? "none" : "default",
							filter:
								hud.phase === "playing"
									? "saturate(0.92) contrast(1.06) brightness(0.98)"
									: "saturate(0.5) brightness(0.7)",
							borderRadius: 18,
						}}
					/>
				</div>
			</div>

			{/* Full-screen overlays — cover everything inside the phone */}
			{hud.phase === "menu" && (
					<MoodOverlay mood={M}>
						<div className="text-center">
							<div
								style={{
									fontFamily: FONT_MONO,
									fontSize: 11,
									letterSpacing: "0.3em",
									color: M.inkDim,
									marginBottom: 18,
								}}
							>
								MISSION 01 · DEFEND
							</div>
							<h1
								style={{
									fontFamily: FONT_DISPLAY,
									fontSize: "clamp(36px, 7vw, 80px)",
									lineHeight: 0.88,
									color: M.ink,
									margin: 0,
									letterSpacing: "-0.01em",
								}}
							>
								SQUAD <span style={{ color: M.accent, fontStyle: "italic" }}>VS</span> ZOMBIES
							</h1>
							<p
								className="mx-auto mt-6"
								style={{
									fontFamily: "var(--font-sans), system-ui, sans-serif",
									fontSize: 14,
									color: M.inkDim,
									maxWidth: 480,
									lineHeight: 1.55,
								}}
							>
								Hold the arena. The model is watching for clutch moments — go
								for them.
							</p>
							<div
								className="mx-auto mt-7 grid grid-cols-2 gap-x-10 gap-y-1.5"
								style={{
									fontFamily: FONT_MONO,
									fontSize: 11,
									letterSpacing: "0.18em",
									color: M.inkDim,
									maxWidth: 380,
								}}
							>
								<div>
									<span style={{ color: M.ink }}>WASD</span> — MOVE
								</div>
								<div>
									<span style={{ color: M.ink }}>MOUSE</span> — AIM
								</div>
								<div>
									<span style={{ color: M.ink }}>LMB</span> — FIRE
								</div>
								<div>
									<span style={{ color: M.ink }}>ESC</span> — PAUSE
								</div>
							</div>
							<button
								className="mt-10 cursor-pointer"
								onClick={startGame}
								style={{
									fontFamily: FONT_DISPLAY,
									fontSize: 36,
									letterSpacing: "0.04em",
									background: M.accent,
									color: "#000",
									border: "none",
									padding: "16px 56px",
									boxShadow: `0 0 40px ${M.accent}80`,
								}}
								type="button"
							>
								DEPLOY →
							</button>
						</div>
					</MoodOverlay>
				)}

				{hud.phase === "gameover" && (
					<ViralOverlay
						editState={editState}
						kills={hud.kills}
						matchSummary={matchSummary}
						onAgain={startGame}
						videoState={videoState}
						viralState={viralState}
						wave={hud.wave}
					/>
				)}

				{hud.phase === "playing" && hud.paused && (
					<MoodOverlay mood={M}>
						<div className="text-center">
							<div
								style={{
									fontFamily: FONT_MONO,
									fontSize: 11,
									letterSpacing: "0.3em",
									color: M.inkDim,
									marginBottom: 18,
								}}
							>
								STATE / PAUSED
							</div>
							<h1
								style={{
									fontFamily: FONT_DISPLAY,
									fontSize: "clamp(56px, 12vw, 120px)",
									lineHeight: 0.85,
									color: M.ink,
									margin: 0,
								}}
							>
								<span style={{ color: M.accent, fontStyle: "italic" }}>
									STAND
								</span>
								<br />
								BY.
							</h1>
						</div>
						<button
							className="mt-10 cursor-pointer"
							onClick={resume}
							style={{
								fontFamily: FONT_DISPLAY,
								fontSize: 32,
								letterSpacing: "0.04em",
								background: M.accent,
								color: "#000",
								border: "none",
								padding: "14px 48px",
								boxShadow: `0 0 40px ${M.accent}80`,
							}}
							type="button"
						>
							RESUME
						</button>
					</MoodOverlay>
				)}

			<div
				className="mt-2 flex items-center justify-between"
				style={{
					fontFamily: FONT_MONO,
					fontSize: 8,
					letterSpacing: "0.18em",
					color: M.inkDim,
				}}
			>
				<span>CLICK · ESC</span>
				<span>GEMINI · viral</span>
			</div>
		</div>
	);
	return <IPhoneFrame orientation={orientation}>{inner}</IPhoneFrame>;
}

function Overlay({ children }: { children: React.ReactNode }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-lg bg-black/75 px-4 py-6 backdrop-blur-sm">
			{children}
		</div>
	);
}

function MoodOverlay({
	mood,
	children,
}: {
	mood: (typeof MOODS)[keyof typeof MOODS];
	children: React.ReactNode;
}) {
	return (
		<div
			className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden px-6 py-8"
			style={{
				background: `radial-gradient(ellipse at 60% 40%, ${mood.bgDeep} 0%, #000 80%)`,
				borderRadius: 38,
			}}
		>
			{/* corner brackets */}
			{(["tl", "tr", "bl", "br"] as const).map((p) => {
				const flip =
					(p.includes("r") ? "scaleX(-1) " : "") +
					(p.includes("b") ? "scaleY(-1)" : "");
				const pos =
					p === "tl"
						? { top: 16, left: 16 }
						: p === "tr"
							? { top: 16, right: 16 }
							: p === "bl"
								? { bottom: 16, left: 16 }
								: { bottom: 16, right: 16 };
				return (
					<svg
						className="absolute"
						height={20}
						key={p}
						style={{ ...pos, transform: flip }}
						width={20}
					>
						<title>corner</title>
						<path
							d="M0 8 L0 0 L8 0"
							fill="none"
							stroke={mood.accent}
							strokeWidth={1.5}
						/>
					</svg>
				);
			})}
			<div
				className="pointer-events-none absolute"
				style={{
					inset: 0,
					background: `linear-gradient(180deg, transparent 0%, ${mood.surface}30 50%, transparent 100%)`,
				}}
			/>
			<div className="relative">{children}</div>
		</div>
	);
}

function DeviceCorners({ color }: { color: string }) {
	return (
		<>
			{(["tl", "tr", "bl", "br"] as const).map((p) => {
				const flip =
					(p.includes("r") ? "scaleX(-1) " : "") +
					(p.includes("b") ? "scaleY(-1)" : "");
				const pos =
					p === "tl"
						? { top: 6, left: 6 }
						: p === "tr"
							? { top: 6, right: 6 }
							: p === "bl"
								? { bottom: 6, left: 6 }
								: { bottom: 6, right: 6 };
				return (
					<svg
						className="absolute"
						height={14}
						key={p}
						style={{ ...pos, transform: flip }}
						width={14}
					>
						<title>device-corner</title>
						<path
							d="M0 6 L0 0 L6 0"
							fill="none"
							stroke={color}
							strokeWidth={1.5}
						/>
					</svg>
				);
			})}
		</>
	);
}

function HudStat({
	label,
	value,
	mood,
}: {
	label: string;
	value: string;
	mood: (typeof MOODS)[keyof typeof MOODS];
}) {
	return (
		<span className="flex items-baseline gap-2">
			<span style={{ color: mood.inkDim }}>{label}</span>
			<span style={{ color: mood.ink, fontFamily: FONT_DISPLAY, fontSize: 20, lineHeight: 1 }}>
				{value}
			</span>
		</span>
	);
}

function HpStrip({
	hp,
	max,
	mood,
}: {
	hp: number;
	max: number;
	mood: (typeof MOODS)[keyof typeof MOODS];
}) {
	const frac = Math.max(0, Math.min(1, hp / max));
	const color = frac < 0.25 ? mood.accent2 : mood.accent;
	return (
		<div
			className="flex w-full items-center gap-2"
			style={{
				fontFamily: FONT_MONO,
				fontSize: 9,
				letterSpacing: "0.18em",
				color: mood.inkDim,
			}}
		>
			<span>HP</span>
			<span
				className="relative h-1 flex-1"
				style={{ background: `${mood.inkDim}40` }}
			>
				<span
					className="absolute top-0 left-0 h-full"
					style={{
						width: `${frac * 100}%`,
						background: color,
						boxShadow: `0 0 8px ${color}`,
					}}
				/>
			</span>
			<span
				style={{
					color: mood.ink,
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{hp}/{max}
			</span>
		</div>
	);
}

function ViralOutcome({
	viralState,
	videoState,
}: {
	viralState: { status: "idle" | "detecting" | "done"; moments: ViralMoment[] };
	videoState: {
		status: "idle" | "rendering" | "done" | "error";
		progress: number;
		blobUrl: string | null;
	};
}) {
	if (viralState.status === "detecting") {
		return (
			<div className="flex items-center gap-3 text-neutral-400 text-sm">
				<span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
				scanning your match…
			</div>
		);
	}

	if (viralState.status === "done" && viralState.moments.length === 0) {
		return (
			<p className="max-w-xs text-center text-neutral-400 text-sm">
				Nothing viral this time. Go for a clutch.
			</p>
		);
	}

	const labels = viralState.moments.slice(0, 4);

	if (videoState.status === "done" && videoState.blobUrl) {
		return (
			<div className="flex w-full flex-col items-center gap-3">
				<div className="flex flex-wrap justify-center gap-1.5">
					{labels.map((m) => (
						<span
							className="rounded-full bg-amber-300 px-3 py-1 font-bold text-[11px] text-neutral-900 tracking-wider"
							key={m.eventIndex}
						>
							{m.label}
						</span>
					))}
				</div>
				{/* biome-ignore lint/a11y/useMediaCaption: gameplay clip has no caption track */}
				<video
					autoPlay
					className="block max-h-[420px] rounded-lg shadow-2xl"
					controls
					loop
					playsInline
					src={videoState.blobUrl}
				/>
			</div>
		);
	}

	if (videoState.status === "error") {
		return (
			<p className="text-red-300 text-sm">Render failed — try again?</p>
		);
	}

	// Detected viral moments, plan/render still in flight.
	const progressLabel =
		videoState.status === "rendering"
			? "cutting your clip…"
			: "directing your clip…";

	return (
		<div className="flex w-full flex-col items-center gap-3">
			<div className="flex flex-wrap justify-center gap-1.5">
				{labels.map((m) => (
					<span
						className="rounded-full border border-amber-300/30 bg-amber-300/15 px-3 py-1 font-mono text-[10px] text-amber-200 uppercase tracking-wider"
						key={m.eventIndex}
					>
						{m.label}
					</span>
				))}
			</div>
			<div className="text-neutral-300 text-sm">{progressLabel}</div>
			<div className="h-1 w-full max-w-xs overflow-hidden rounded bg-neutral-800">
				<div
					className="h-full bg-amber-300 transition-[width]"
					style={{
						width: `${
							videoState.status === "rendering"
								? Math.max(8, videoState.progress * 100)
								: 8
						}%`,
					}}
				/>
			</div>
		</div>
	);
}

function ViralVerdict({
	viralState,
	matchSummary,
	editState,
	videoState,
	onRequestEdit,
}: {
	viralState: { status: "idle" | "detecting" | "done"; moments: ViralMoment[] };
	matchSummary: { eventCount: number; snapshotCount: number; blobUrl: string | null };
	editState: { status: "idle" | "loading" | "done" | "error"; plan: EditPlan | null };
	videoState: {
		status: "idle" | "rendering" | "done" | "error";
		progress: number;
		blobUrl: string | null;
	};
	onRequestEdit: () => void;
}) {
	if (viralState.status === "detecting") {
		return (
			<div className="flex w-full items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-4">
				<div className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />
				<div className="flex-1 font-mono text-[11px]">
					<div className="text-amber-300 uppercase tracking-[.18em]">
						ml viral classifier
					</div>
					<div className="mt-1 text-neutral-400">
						scoring {matchSummary.eventCount} events against{" "}
						{matchSummary.snapshotCount} telemetry samples…
					</div>
				</div>
			</div>
		);
	}

	if (viralState.moments.length === 0) {
		return (
			<div className="flex w-full items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-4">
				<div className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
				<div className="flex-1 font-mono text-[11px]">
					<div className="text-neutral-300 uppercase tracking-[.18em]">
						no viral moments detected
					</div>
					<div className="mt-1 text-neutral-500">
						Nothing in this match scored above the viral threshold. Try again
						— go for a clutch.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
			{/* Detected viral moments */}
			<div className="overflow-hidden rounded-lg border border-emerald-700/60 bg-neutral-950">
				<div className="flex items-center justify-between border-emerald-800/50 border-b bg-emerald-950/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[.18em]">
					<span className="text-emerald-300">
						{viralState.moments.length} viral moment
						{viralState.moments.length === 1 ? "" : "s"}
					</span>
					<span className="text-neutral-400">classifier · llama-3.3-70b</span>
				</div>
				<div className="space-y-2 px-3 py-3">
					{viralState.moments.map((m) => (
						<div
							className="rounded bg-neutral-900 px-3 py-2 font-mono text-[11px]"
							key={m.eventIndex}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-bold text-amber-300">{m.label}</span>
								<span className="text-emerald-300">{m.score}/100</span>
							</div>
							<div className="mt-1 text-neutral-400">{m.reason}</div>
						</div>
					))}
					{matchSummary.blobUrl && (
						<a
							className="mt-1 block rounded bg-neutral-900 px-3 py-2 text-center text-[10px] text-neutral-300 uppercase tracking-wider transition hover:bg-neutral-800"
							download="brrawl-match.webm"
							href={matchSummary.blobUrl}
						>
							download raw match webm
						</a>
					)}
					{editState.status === "idle" && (
						<button
							className="w-full rounded bg-amber-300 px-3 py-2 font-bold text-[12px] text-neutral-900 uppercase tracking-wider transition hover:bg-amber-200"
							onClick={onRequestEdit}
							type="button"
						>
							build the edit
						</button>
					)}
					{editState.status === "loading" && (
						<div className="rounded bg-neutral-900 px-3 py-2 text-center text-[10px] text-neutral-400 uppercase tracking-wider">
							asking model for plan…
						</div>
					)}
					{editState.status === "error" && (
						<div className="rounded bg-red-950/30 px-3 py-2 text-center text-[10px] text-red-300 uppercase tracking-wider">
							edit failed — see console
						</div>
					)}
					{videoState.status === "rendering" && (
						<div className="space-y-1.5 rounded bg-neutral-900 px-3 py-2">
							<div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
								<span className="text-neutral-400">rendering edit…</span>
								<span className="text-emerald-300">
									{Math.round(videoState.progress * 100)}%
								</span>
							</div>
							<div className="h-1 overflow-hidden rounded bg-neutral-800">
								<div
									className="h-full bg-amber-300 transition-[width] duration-200"
									style={{ width: `${videoState.progress * 100}%` }}
								/>
							</div>
						</div>
					)}
					{videoState.status === "error" && (
						<div className="rounded bg-red-950/30 px-3 py-2 text-center text-[10px] text-red-300 uppercase tracking-wider">
							render failed — see console
						</div>
					)}
				</div>
			</div>

			{/* Right column: rendered edit > edit plan > raw recording */}
			<div className="overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950">
				{videoState.status === "done" && videoState.blobUrl ? (
					<>
						<div className="flex items-center justify-between border-neutral-800 border-b bg-neutral-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[.18em]">
							<span className="text-amber-300">rendered edit</span>
							<span className="text-neutral-500">9:16 · webm</span>
						</div>
						<div className="flex w-full justify-center bg-black">
							<video
								autoPlay
								className="block max-h-[520px]"
								controls
								loop
								playsInline
								src={videoState.blobUrl}
							/>
						</div>
						<a
							className="block bg-amber-300 px-3 py-2 text-center font-bold text-[11px] text-neutral-900 uppercase tracking-wider transition hover:bg-amber-200"
							download="brrawl-edit.webm"
							href={videoState.blobUrl}
						>
							download edit .webm
						</a>
					</>
				) : editState.status === "done" && editState.plan ? (
					<>
						<div className="flex items-center justify-between border-neutral-800 border-b bg-neutral-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[.18em]">
							<span className="text-emerald-300">edit plan</span>
							<span className="text-neutral-500">
								{videoState.status === "rendering" ? "rendering…" : "ready"}
							</span>
						</div>
						<EditPlanCard plan={editState.plan} />
					</>
				) : (
					<>
						<div className="flex items-center justify-between border-neutral-800 border-b bg-neutral-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[.18em]">
							<span className="text-neutral-300">match recording</span>
							<span className="text-neutral-500">
								{matchSummary.blobUrl ? "captured" : "not captured"}
							</span>
						</div>
						{matchSummary.blobUrl ? (
							<video
								autoPlay
								className="block aspect-video w-full"
								loop
								muted
								playsInline
								src={matchSummary.blobUrl}
							/>
						) : (
							<div className="flex aspect-video w-full items-center justify-center text-neutral-500 text-xs">
								no recording captured
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function EditPlanCard({ plan }: { plan: EditPlan }) {
	return (
		<div className="space-y-3 px-4 py-4 font-mono text-[11px] text-neutral-200">
			<div className="grid grid-cols-2 gap-2">
				<div className="rounded bg-neutral-900 px-2 py-1.5">
					<div className="text-[9px] text-neutral-500 uppercase tracking-wider">
						mood
					</div>
					<div className="font-bold text-amber-300">{plan.mood}</div>
				</div>
				<div className="rounded bg-neutral-900 px-2 py-1.5">
					<div className="text-[9px] text-neutral-500 uppercase tracking-wider">
						audio
					</div>
					<div className="font-bold text-cyan-300">{plan.audio}</div>
				</div>
			</div>
			<div className="rounded bg-neutral-900 px-2 py-1.5">
				<div className="text-[9px] text-neutral-500 uppercase tracking-wider">
					hook
				</div>
				<div className="font-medium text-white">"{plan.hook}"</div>
			</div>
			<div className="space-y-1">
				<div className="text-[9px] text-neutral-500 uppercase tracking-wider">
					{plan.shots.length} shot{plan.shots.length === 1 ? "" : "s"}
				</div>
				{plan.shots.map((s, i) => (
					<div
						className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1.5"
						// biome-ignore lint/suspicious/noArrayIndexKey: stable order
						key={i}
					>
						<span className="text-neutral-500">#{i + 1}</span>
						<span className="flex-1 text-white">
							{s.caption.split(/\[([^\]]+)\]/g).map((part, j) =>
								j % 2 === 1 ? (
									// biome-ignore lint/suspicious/noArrayIndexKey: stable
									<span className="text-amber-300" key={j}>
										{part}
									</span>
								) : (
									// biome-ignore lint/suspicious/noArrayIndexKey: stable
									<span key={j}>{part}</span>
								),
							)}
						</span>
						<span className="text-[9px] text-neutral-500">
							{(s.lengthMs / 1000).toFixed(1)}s · {s.transition ?? "cut"}
						</span>
					</div>
				))}
			</div>
			<div className="rounded bg-neutral-900 px-2 py-1.5">
				<div className="text-[9px] text-neutral-500 uppercase tracking-wider">
					outro
				</div>
				<div className="font-medium text-white">"{plan.outro}"</div>
			</div>
		</div>
	);
}
