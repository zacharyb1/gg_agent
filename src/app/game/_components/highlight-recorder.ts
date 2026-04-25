type V2 = { x: number; y: number };

export type SnapPlayer = {
	pos: V2;
	hp: number;
	maxHp: number;
	angle: number;
	cooldown: number;
	hitFlash: number;
};

export type SnapAlly = {
	pos: V2;
	hp: number;
	maxHp: number;
	angle: number;
	alive: boolean;
	hitFlash: number;
	cooldown: number;
	respawnTimer: number;
	followOffset: V2;
	armor: string;
	armorHighlight: string;
	cape: string;
	capeInner: string;
};

export type SnapZombie = {
	pos: V2;
	vel: V2;
	hp: number;
	maxHp: number;
	speed: number;
	radius: number;
	damage: number;
	type: "walker" | "runner" | "brute";
	hitFlash: number;
	wobble: number;
};

export type SnapBullet = {
	pos: V2;
	vel: V2;
	damage: number;
	ttl: number;
	team: "player" | "ally";
};

export type SnapParticle = {
	pos: V2;
	vel: V2;
	life: number;
	maxLife: number;
	color: string;
	size: number;
};

export type SnapText = {
	pos: V2;
	vel: V2;
	text: string;
	life: number;
	color: string;
};

export type SnapObstacle =
	| { kind: "crate"; x: number; y: number; w: number; h: number }
	| { kind: "sandbag"; x: number; y: number; w: number; h: number }
	| { kind: "barrel"; x: number; y: number; r: number };

export type StateSnapshot = {
	player: SnapPlayer;
	allies: SnapAlly[];
	zombies: SnapZombie[];
	bullets: SnapBullet[];
	particles: SnapParticle[];
	texts: SnapText[];
	obstacles: SnapObstacle[];
	shakeTime: number;
	shakeMag: number;
	bannerText: string;
	bannerTime: number;
	bannerMaxTime: number;
	phase: string;
	mouse: V2;
	wave: number;
	kills: number;
	playerKills: number;
	zombiesToSpawn: number;
};

export type ViralMomentKind =
	| "multikill"
	| "clutch"
	| "laststand"
	| "wavecloser";

export type ViralMoment = {
	kind: ViralMomentKind;
	priority: number;
	label: string;
};

export type HighlightClip = {
	id: string;
	moment: ViralMoment;
	frames: StateSnapshot[];
	fps: number;
	theme: unknown;
};

// ─── Constants ────────────────────────────────────────────────────

const SNAPSHOT_FPS = 30;
const RING_CAPACITY = SNAPSHOT_FPS * 5; // 5 seconds
const BEFORE_FRAMES = SNAPSHOT_FPS * 3; // 3 seconds before the moment
const AFTER_FRAMES = SNAPSHOT_FPS * 2; // 2 seconds after
const MAX_CLIPS = 3;

const MULTIKILL_WINDOW_S = 1.5;
const MULTIKILL_THRESHOLD = 3;
const CLUTCH_HP_PCT = 0.15;
const LASTSTAND_KILL_THRESHOLD = 3;
const DETECTOR_COOLDOWN_S = 4;

// ─── Ring Buffer ──────────────────────────────────────────────────

class RingBuffer<T> {
	private buf: (T | undefined)[];
	private head = 0;
	private _size = 0;

	constructor(private capacity: number) {
		this.buf = new Array(capacity);
	}

	push(item: T) {
		this.buf[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this._size < this.capacity) this._size++;
	}

	last(n: number): T[] {
		const count = Math.min(n, this._size);
		const result: T[] = [];
		let idx = (this.head - count + this.capacity) % this.capacity;
		for (let i = 0; i < count; i++) {
			result.push(this.buf[idx]!);
			idx = (idx + 1) % this.capacity;
		}
		return result;
	}

	clear() {
		this.head = 0;
		this._size = 0;
	}
}

// ─── Detector State ───────────────────────────────────────────────

type CaptureState = {
	moment: ViralMoment;
	beforeFrames: StateSnapshot[];
	afterFrames: StateSnapshot[];
	afterRemaining: number;
};

type DetectorState = {
	prevKills: number;
	prevPlayerKills: number;
	elapsed: number;
	recentKillTimes: number[];
	soloKills: number;
	lastMomentTime: number;
	pendingWaveClose: { wave: number } | null;
};

function createDetectorState(): DetectorState {
	return {
		prevKills: 0,
		prevPlayerKills: 0,
		elapsed: 0,
		recentKillTimes: [],
		soloKills: 0,
		lastMomentTime: -DETECTOR_COOLDOWN_S,
		pendingWaveClose: null,
	};
}

// ─── HighlightRecorder ───────────────────────────────────────────

let clipIdCounter = 0;

export class HighlightRecorder {
	private ring = new RingBuffer<StateSnapshot>(RING_CAPACITY);
	private clips: HighlightClip[] = [];
	private capture: CaptureState | null = null;
	private det: DetectorState = createDetectorState();
	private frameToggle = false;

	constructor(private getTheme: () => unknown = () => null) {}

	/**
	 * Called every rAF frame. Internally samples at ~30fps.
	 * Returns a detected moment (if any) for optional HUD feedback.
	 */
	push(snapshot: StateSnapshot): ViralMoment | null {
		this.frameToggle = !this.frameToggle;
		if (this.frameToggle) return null;

		this.ring.push(snapshot);
		const dt = 1 / SNAPSHOT_FPS;
		this.det.elapsed += dt;

		if (this.capture) {
			this.capture.afterFrames.push(snapshot);
			this.capture.afterRemaining--;
			if (
				this.capture.afterRemaining <= 0 ||
				snapshot.phase === "gameover"
			) {
				this.finalizeCapture();
			}
			this.updateCounters(snapshot);
			return null;
		}

		const moment = this.detect(snapshot);
		this.updateCounters(snapshot);

		if (
			moment &&
			this.det.elapsed - this.det.lastMomentTime >= DETECTOR_COOLDOWN_S
		) {
			this.det.lastMomentTime = this.det.elapsed;
			this.startCapture(moment);
			return moment;
		}

		return null;
	}

	signalWaveClosed(wave: number) {
		this.det.pendingWaveClose = { wave };
	}

	reset() {
		this.ring.clear();
		this.capture = null;
		this.det = createDetectorState();
		this.frameToggle = false;
	}

	flush() {
		if (this.capture) this.finalizeCapture();
	}

	getClips(): HighlightClip[] {
		return this.clips;
	}

	clearClips() {
		this.clips = [];
	}

	// ─── Private ──────────────────────────────────────────────────

	private detect(snap: StateSnapshot): ViralMoment | null {
		const d = this.det;
		const newKills = snap.kills - d.prevKills;
		const newPlayerKills = snap.playerKills - d.prevPlayerKills;

		for (let i = 0; i < newKills; i++) {
			d.recentKillTimes.push(d.elapsed);
		}
		const cutoff = d.elapsed - MULTIKILL_WINDOW_S;
		while (d.recentKillTimes.length > 0 && d.recentKillTimes[0]! < cutoff) {
			d.recentKillTimes.shift();
		}

		const alliesAlive = snap.allies.filter((a) => a.alive).length;
		if (alliesAlive === 0 && newPlayerKills > 0) {
			d.soloKills += newPlayerKills;
		} else if (alliesAlive > 0) {
			d.soloKills = 0;
		}

		if (d.pendingWaveClose) {
			const wave = d.pendingWaveClose.wave;
			d.pendingWaveClose = null;
			return {
				kind: "wavecloser",
				priority: 8 + wave,
				label: `WAVE ${wave} CLEARED`,
			};
		}

		if (alliesAlive === 0 && d.soloKills >= LASTSTAND_KILL_THRESHOLD) {
			const kills = d.soloKills;
			d.soloKills = 0;
			return {
				kind: "laststand",
				priority: 12 + kills,
				label: `LAST STAND — ${kills} SOLO KILLS`,
			};
		}

		if (
			snap.player.hp > 0 &&
			snap.player.hp / snap.player.maxHp < CLUTCH_HP_PCT &&
			newPlayerKills > 0
		) {
			return {
				kind: "clutch",
				priority: 10 + newPlayerKills,
				label: `CLUTCH AT ${Math.ceil(snap.player.hp)} HP`,
			};
		}

		if (d.recentKillTimes.length >= MULTIKILL_THRESHOLD) {
			const count = d.recentKillTimes.length;
			const names = ["", "", "", "TRIPLE KILL", "QUAD KILL", "PENTA KILL"];
			const label =
				count < names.length ? names[count]! : `${count}x MULTI-KILL`;
			d.recentKillTimes = [];
			return { kind: "multikill", priority: count * 2, label };
		}

		return null;
	}

	private updateCounters(snap: StateSnapshot) {
		this.det.prevKills = snap.kills;
		this.det.prevPlayerKills = snap.playerKills;
	}

	private startCapture(moment: ViralMoment) {
		const beforeFrames = this.ring.last(BEFORE_FRAMES);
		this.capture = {
			moment,
			beforeFrames,
			afterFrames: [],
			afterRemaining: AFTER_FRAMES,
		};
	}

	private finalizeCapture() {
		if (!this.capture) return;
		const { moment, beforeFrames, afterFrames } = this.capture;
		this.capture = null;

		const clip: HighlightClip = {
			id: `hl-${++clipIdCounter}`,
			moment,
			frames: [...beforeFrames, ...afterFrames],
			fps: SNAPSHOT_FPS,
			theme: this.getTheme(),
		};

		if (this.clips.length >= MAX_CLIPS) {
			let minIdx = 0;
			for (let i = 1; i < this.clips.length; i++) {
				if (
					this.clips[i]!.moment.priority <
					this.clips[minIdx]!.moment.priority
				) {
					minIdx = i;
				}
			}
			if (clip.moment.priority > this.clips[minIdx]!.moment.priority) {
				this.clips.splice(minIdx, 1);
			} else {
				return;
			}
		}
		this.clips.push(clip);
	}
}
