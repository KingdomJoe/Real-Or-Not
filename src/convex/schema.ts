import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/*
 * RON (Real or Not) — Convex real-time schema.
 * 3 tables: scans, threatHashes (Truecaller-style ledger), buddySessions (floating Ronnie sync).
 */

const verdictValidator = v.union(
	v.literal('real'),
	v.literal('filtered'),
	v.literal('partial_ai'),
	v.literal('twisted_story'),
	v.literal('made_by_ai'),
	v.literal('too_blurry')
);

const platformValidator = v.union(
	v.literal('tiktok'),
	v.literal('x'),
	v.literal('instagram'),
	v.literal('youtube'),
	v.literal('reddit'),
	v.literal('zoom_meet'),
	v.literal('phone_call'),
	v.literal('upload')
);

const highlightedSpotValidator = v.object({
	x: v.number(),
	y: v.number(),
	w: v.number(),
	h: v.number(),
	plainLabel: v.string(),
	isFake: v.boolean()
});

const storyStepValidator = v.object({
	date: v.string(),
	platform: v.string(),
	whatHappened: v.string()
});

const audioSliceValidator = v.object({
	startSec: v.number(),
	endSec: v.number(),
	speakerLabel: v.string(),
	status: v.union(v.literal('real'), v.literal('ai_clone'), v.literal('scam_script')),
	plainNote: v.string(),
	transcriptSnippet: v.string()
});

const samMaskValidator = v.object({
	maskId: v.string(),
	label: v.string(),
	iouScore: v.number(),
	elaDeltaSigma: v.number(),
	fftPeakRatio: v.number(),
	noiseprintKl: v.number()
});

const traceEntryValidator = v.object({
	model: v.string(),
	stage: v.string(),
	durationMs: v.number(),
	output: v.string()
});

const proofBundleValidator = v.object({
	samMasks: v.array(samMaskValidator),
	metaModelsTrace: v.array(traceEntryValidator),
	jevCalibration: v.object({
		distribution: v.object({
			real: v.number(),
			filtered: v.number(),
			partial_ai: v.number(),
			twisted_story: v.number(),
			made_by_ai: v.number()
		}),
		epistemicBand: v.number(),
		inferenceMs: v.number()
	}),
	alienSpace: v.object({
		coherenceZ: v.number(),
		unavailabilityZ: v.number(),
		fBetaScore: v.number(),
		fBeta: v.number(),
		blindSpotAtoms: v.array(v.string())
	}),
	xrayPlateUrl: v.optional(v.string())
});

export default defineSchema({
	// Active + historical media checks.
	scans: defineTable({
		mediaUrl: v.string(),
		platform: platformValidator,
		verdictType: verdictValidator,
		plainSummary: v.string(),
		plainHeadline: v.string(),
		whatsReal: v.string(),
		whatsChanged: v.string(),
		highlightedRegions: v.array(highlightedSpotValidator),
		audioSlices: v.array(audioSliceValidator),
		storyTimeline: v.array(storyStepValidator),
		nextScamWarning: v.string(),
		proofDetails: proofBundleValidator,
		confidencePercent: v.number(),
		scannedAt: v.number()
	})
		.index('by_platform', ['platform'])
		.index('by_verdict', ['verdictType'])
		.index('by_scannedAt', ['scannedAt']),

	// Truecaller-style community ledger of perceptual hashes of known fakes.
	// Repeat viral clips are flagged in <40ms without re-running models.
	threatHashes: defineTable({
		pHash: v.string(),
		audioFingerprint: v.optional(v.string()),
		verdictType: verdictValidator,
		firstSeenAt: v.number(),
		reportCount: v.number(),
		plainNote: v.string()
	})
		.index('by_pHash', ['pHash'])
		.index('by_verdict', ['verdictType']),

	// Real-time bridge syncing the floating RON companion / extension with the main tab.
	buddySessions: defineTable({
		sessionId: v.string(),
		status: v.union(
			v.literal('sleeping'),
			v.literal('checking'),
			v.literal('real'),
			v.literal('filtered'),
			v.literal('partial_ai'),
			v.literal('twisted_story'),
			v.literal('made_by_ai'),
			v.literal('too_blurry')
		),
		lastVerdict: v.optional(verdictValidator),
		lastPlainBubble: v.optional(v.string()),
		mediaUrl: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_sessionId', ['sessionId'])
});
