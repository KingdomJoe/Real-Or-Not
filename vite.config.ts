import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Rust WASM signal engine (rust-forensics/ via wasm-pack).
		// Must come before sveltekit() so .wasm imports resolve in workers too.
		// (No top-level-await plugin: Vite 8 / rolldown supports TLA natively,
		// and the worker only awaits inside async handlers.)
		wasm(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	worker: {
		format: 'es'
	},
	server: {
		fs: {
			// Allow serving the compiled wasm-pack output during dev.
			allow: ['..']
		}
	},
	optimizeDeps: {
		exclude: ['ron-forensics']
	}
});
