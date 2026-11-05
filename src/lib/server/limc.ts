/*
 * RON (Real or Not) — LIMC (Lessons in Meme Culture) briefing helpers (server-only).
 * "No filler. Straight to the point." Shared by /api/web-context and /api/analyze.
 */

export interface LimcBriefing {
	origin: string;
	evolution: string;
	impact: string;
}

export interface LimcSource {
	title: string;
	url: string;
	snippet: string;
}

export function buildLimcPrompt(subject: string, platformHint: string): string {
	return (
		`You are LIMC (Lessons in Meme Culture) on assignment: "No filler. Straight to the point." ` +
		`A user is checking this media${platformHint}: "${subject}". ` +
		`Search the public web, then write a crisp 3-part briefing using EXACTLY these markdown headers, ` +
		`2-4 punchy sentences per part:\n` +
		`## 1. Origin & First Appearance\n` +
		`## 2. How It Evolved / Spread\n` +
		`## 3. Present Impact & Reality Check\n` +
		`Rules: name real dates, accounts, and events only from search results; ` +
		`if you cannot find earlier copies, say so inside part 1 and keep parts 2-3 to one honest sentence each. ` +
		`Never invent URLs — only cite pages the search actually returned.`
	);
}

/** Split a LIMC response into its 3 labeled parts; unparseable text lands in `impact`. */
export function parseLimcBriefing(summary: string): LimcBriefing {
	const blank: LimcBriefing = { origin: '', evolution: '', impact: '' };
	if (!summary || !summary.trim()) return blank;
	const marks = [
		/^##\s*1\.\s*origin[^\n]*/im,
		/^##\s*2\.\s*how it evolved[^\n]*/im,
		/^##\s*3\.\s*present impact[^\n]*/im
	];
	const idx = marks.map((re) => {
		const m = re.exec(summary);
		return m ? (m.index ?? -1) + m[0].length : -1;
	});
	if (idx[0] < 0 || idx[1] < 0 || idx[2] < 0) {
		return { ...blank, impact: summary.trim().slice(0, 2000) };
	}
	const endOf = (i: number): number => {
		const starts = marks.map((re, j) => {
			const m = re.exec(summary);
			const at = m?.index ?? -1;
			return j > i ? at : -1;
		});
		const next = starts.filter((v) => v >= 0).sort((a, b) => a - b)[0];
		return next !== undefined && next >= 0 ? next : summary.length;
	};
	return {
		origin: summary.slice(idx[0], endOf(0)).trim().slice(0, 1200),
		evolution: summary.slice(idx[1], endOf(1)).trim().slice(0, 1200),
		impact: summary.slice(idx[2], endOf(2)).trim().slice(0, 1200)
	};
}

/** Junk titles ("of", "untitled") fall back to the source hostname — never dropped silently. */
export function cleanTitle(title: unknown, url: string): string {
	if (typeof title === 'string' && title.trim().length >= 4 && title.toLowerCase() !== 'untitled') {
		return title;
	}
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/** Reject PDFs and non-web schemes — reference chips must be clickable live pages. */
export function isAllowedSourceUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		return !/\.pdf(\?|#|$)/i.test(parsed.pathname);
	} catch {
		return false;
	}
}
