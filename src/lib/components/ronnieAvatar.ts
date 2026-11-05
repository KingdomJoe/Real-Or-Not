/*
 * RON (Real or Not) — Ronnie living-avatar controller (framework-free).
 *
 * Mounts into ANY document (main tab or Document PiP window — elements are
 * created via the container's ownerDocument). Styling lives in app.css
 * (.ronnie-*), which the PiP window inherits via copyAppStyles.
 */

export type RonnieState =
	| 'idle'
	| 'scanning'
	| 'real'
	| 'filtered'
	| 'partial_ai'
	| 'twisted_story'
	| 'made_by_ai';

export interface RonnieAvatarHandle {
	readonly root: HTMLElement;
	setState: (state: RonnieState) => void;
	/** Live mic/tab volume 0..1 drives the waveform mouth. */
	setVolume: (level: number) => void;
	destroy: () => void;
}

function h(doc: Document, tag: string, className: string): HTMLElement {
	const node = doc.createElement(tag);
	node.className = className;
	return node;
}

export function mountRonnieAvatar(container: HTMLElement): RonnieAvatarHandle {
	const doc = container.ownerDocument;
	const root = h(doc, 'div', 'ronnie');
	root.setAttribute('data-state', 'idle');
	root.setAttribute('role', 'img');
	root.setAttribute('aria-label', 'Ronnie, the RON buddy avatar');

	const aura = h(doc, 'div', 'ronnie-aura');
	const radar = h(doc, 'div', 'ronnie-radar');
	const orb = h(doc, 'div', 'ronnie-orb');

	const brows = h(doc, 'div', 'ronnie-brows');
	brows.append(h(doc, 'i', ''), h(doc, 'i', ''));

	const eyes = h(doc, 'div', 'ronnie-eyes');
	const pupils: HTMLElement[] = [];
	for (let i = 0; i < 2; i++) {
		const eye = h(doc, 'span', 'ronnie-eye');
		const pupil = h(doc, 'i', '');
		eye.append(pupil);
		pupils.push(pupil);
		eyes.append(eye);
	}

	const mouth = h(doc, 'div', 'ronnie-mouth');
	const bars: HTMLElement[] = [];
	for (let i = 0; i < 5; i++) {
		const bar = h(doc, 'i', '');
		bars.push(bar);
		mouth.append(bar);
	}

	orb.append(brows, eyes, mouth);
	root.append(aura, radar, orb);
	container.append(root);

	let destroyed = false;
	let volume = 0;
	let targetVolume = 0;

	// Eyes wander while scanning, settle otherwise.
	const glances: Array<[number, number]> = [
		[0, 0],
		[-3, -1],
		[3, 0],
		[0, 2],
		[-2, 1],
		[2, -2]
	];
	let glanceIdx = 0;
	const glanceTimer = window.setInterval(() => {
		if (destroyed) return;
		const scanning = root.getAttribute('data-state') === 'scanning';
		glanceIdx = (glanceIdx + (scanning ? 1 : 0)) % glances.length;
		const [gx, gy] = scanning ? glances[glanceIdx] : glances[0];
		for (const p of pupils) p.style.transform = `translate(${gx}px, ${gy}px)`;
	}, 900);

	// Smooth mouth physics toward the live level.
	let raf = 0;
	const tick = () => {
		if (destroyed) return;
		volume += (targetVolume - volume) * 0.35;
		const t = performance.now() / 1000;
		for (let i = 0; i < bars.length; i++) {
			const idle = 5 + Math.sin(t * 2.2 + i * 1.3) * 1.6;
			const voice = volume * (10 + Math.sin(t * 17 + i * 2.4) * 6);
			bars[i].style.height = `${Math.min(18, Math.max(3, idle + voice))}px`;
		}
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);

	return {
		root,
		setState: (state: RonnieState) => {
			if (!destroyed) root.setAttribute('data-state', state);
		},
		setVolume: (level: number) => {
			targetVolume = Math.min(1, Math.max(0, level));
		},
		destroy: () => {
			destroyed = true;
			window.clearInterval(glanceTimer);
			cancelAnimationFrame(raf);
			root.remove();
		}
	};
}
