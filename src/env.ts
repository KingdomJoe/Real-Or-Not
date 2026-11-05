import { defineEnvVars } from '@sveltejs/kit/env';

/*
 * RON (Real or Not) — environment variable definitions (SvelteKit 3).
 * Consumed via `import { PUBLIC_CONVEX_URL } from '$app/env/public'`.
 * All client vars are optional: the app runs fully offline on 5 pre-loaded
 * forensic cases when they are unset.
 */
export const variables = defineEnvVars({
	PUBLIC_CONVEX_URL: {
		public: true,
		description: 'Convex deployment URL for real-time scan sync (optional in Phase 1).',
		schema: (value) => value ?? ''
	},
	PUBLIC_MODAL_ENDPOINT: {
		public: true,
		description: 'Modal GPU backend endpoint (AudioSeal + SigLIP-2) for live PiP checks.',
		schema: (value) => value ?? ''
	},
	PUBLIC_MODAL_WEBHOOK_SECRET: {
		public: true,
		description:
			'Webhook gate for the Modal endpoint, sent by browser-direct PiP calls (scanner deterrence, not true auth).',
		schema: (value) => value ?? ''
	},
	// ── Server-only (import from '$app/env/private' in +server.ts routes) ──
	META_API_KEY: {
		description: 'Meta Model API key (dev.meta.ai) for Check B web grounding + voice transcribe.',
		schema: (value) => value ?? ''
	},
	OPENROUTER_OR_MODAL_SPARK_OPEN_KEY: {
		description: 'Bearer token for the hosted Muse Spark Open chat endpoint.',
		schema: (value) => value ?? ''
	},
	SPARK_OPEN_BASE_URL: {
		description: 'Base URL (…/v1) of the hosted Muse Spark Open OpenAI-compatible server.',
		schema: (value) => value ?? ''
	},
	MODAL_ENDPOINT_URL: {
		description: 'Modal forensics backend (AudioSeal + SigLIP-2) invoked server-side by /api/analyze.',
		schema: (value) => value ?? ''
	},
	MODAL_WEBHOOK_SECRET: {
		description: 'Webhook gate for the Modal endpoint (server-side only).',
		schema: (value) => value ?? ''
	}
});
