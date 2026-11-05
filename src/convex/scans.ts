// @ts-ignore — `./_generated/server` is created by `npx convex dev`. Run it after setting PUBLIC_CONVEX_URL.
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/** List recent scans, newest first. */
export const list = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx: any, args: any) => {
		const limit = args.limit ?? 20;
		return await ctx.db.query('scans').order('desc').take(limit);
	}
});

/** Get one scan by id. */
export const get = query({
	args: { id: v.id('scans') },
	handler: async (ctx: any, args: any) => {
		return await ctx.db.get(args.id);
	}
});

/** Save (or re-save) a scan result from the client. */
export const save = mutation({
	args: {
		mediaUrl: v.string(),
		platform: v.union(
			v.literal('tiktok'),
			v.literal('x'),
			v.literal('instagram'),
			v.literal('youtube'),
			v.literal('reddit'),
			v.literal('zoom_meet'),
			v.literal('phone_call'),
			v.literal('upload')
		),
		verdictType: v.union(
			v.literal('real'),
			v.literal('filtered'),
			v.literal('partial_ai'),
			v.literal('twisted_story'),
			v.literal('made_by_ai'),
			v.literal('too_blurry')
		),
		plainSummary: v.string(),
		plainHeadline: v.string(),
		whatsReal: v.string(),
		whatsChanged: v.string(),
		highlightedRegions: v.array(
			v.object({
				x: v.number(),
				y: v.number(),
				w: v.number(),
				h: v.number(),
				plainLabel: v.string(),
				isFake: v.boolean()
			})
		),
		audioSlices: v.array(
			v.object({
				startSec: v.number(),
				endSec: v.number(),
				speakerLabel: v.string(),
				status: v.union(v.literal('real'), v.literal('ai_clone'), v.literal('scam_script')),
				plainNote: v.string(),
				transcriptSnippet: v.string()
			})
		),
		storyTimeline: v.array(
			v.object({ date: v.string(), platform: v.string(), whatHappened: v.string() })
		),
		nextScamWarning: v.string(),
		proofDetails: v.any(),
		confidencePercent: v.number()
	},
	handler: async (ctx: any, args: any) => {
		return await ctx.db.insert('scans', { ...args, scannedAt: Date.now() });
	}
});
