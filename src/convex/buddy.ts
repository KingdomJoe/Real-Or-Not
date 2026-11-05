// @ts-ignore — `./_generated/server` is created by `npx convex dev`.
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const statusValidator = v.union(
	v.literal('sleeping'),
	v.literal('checking'),
	v.literal('real'),
	v.literal('filtered'),
	v.literal('partial_ai'),
	v.literal('twisted_story'),
	v.literal('made_by_ai'),
	v.literal('too_blurry')
);

/** Floating Ronnie companion: read latest session state. */
export const getSession = query({
	args: { sessionId: v.string() },
	handler: async (ctx: any, args: any) => {
		return await ctx.db
			.query('buddySessions')
			.withIndex('by_sessionId', (q: any) => q.eq('sessionId', args.sessionId))
			.first();
	}
});

/** Floating Ronnie companion: push new status (upsert). */
export const pushStatus = mutation({
	args: {
		sessionId: v.string(),
		status: statusValidator,
		lastVerdict: v.optional(
			v.union(
				v.literal('real'),
				v.literal('filtered'),
				v.literal('partial_ai'),
				v.literal('twisted_story'),
				v.literal('made_by_ai'),
				v.literal('too_blurry')
			)
		),
		lastPlainBubble: v.optional(v.string()),
		mediaUrl: v.optional(v.string())
	},
	handler: async (ctx: any, args: any) => {
		const existing = await ctx.db
			.query('buddySessions')
			.withIndex('by_sessionId', (q: any) => q.eq('sessionId', args.sessionId))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
			return existing._id;
		}
		return await ctx.db.insert('buddySessions', { ...args, updatedAt: Date.now() });
	}
});
