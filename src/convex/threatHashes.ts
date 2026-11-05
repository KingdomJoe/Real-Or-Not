// @ts-ignore — `./_generated/server` is created by `npx convex dev`.
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/** Truecaller-style instant lookup: is this perceptual hash a known fake? */
export const lookup = query({
	args: { pHash: v.string() },
	handler: async (ctx: any, args: any) => {
		return await ctx.db
			.query('threatHashes')
			.withIndex('by_pHash', (q: any) => q.eq('pHash', args.pHash))
			.first();
	}
});

/** Report a new forged hash (or bump reportCount if already known). */
export const report = mutation({
	args: {
		pHash: v.string(),
		audioFingerprint: v.optional(v.string()),
		verdictType: v.union(
			v.literal('real'),
			v.literal('filtered'),
			v.literal('partial_ai'),
			v.literal('twisted_story'),
			v.literal('made_by_ai'),
			v.literal('too_blurry')
		),
		plainNote: v.string()
	},
	handler: async (ctx: any, args: any) => {
		const existing = await ctx.db
			.query('threatHashes')
			.withIndex('by_pHash', (q: any) => q.eq('pHash', args.pHash))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, { reportCount: existing.reportCount + 1 });
			return existing._id;
		}
		return await ctx.db.insert('threatHashes', {
			...args,
			firstSeenAt: Date.now(),
			reportCount: 1
		});
	}
});
