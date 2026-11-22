import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The origin check lives in src/hooks.server.ts, where it also works over plain http.
			csrf: { trustedOrigins: ['*'] },
			// Map images are uploaded through the app, and so is a whole campaign
			// when one is imported, pictures and all. So the default 512 KB body
			// limit is raised to what a campaign may weigh: src/hooks.server.ts
			// holds everything else to a little over LIMITS.imageBytes. A big
			// image takes a while to cut into tiles, and the upload sits silent
			// meanwhile, so give a quiet connection minutes rather than the
			// default 10 seconds.
			adapter: adapter({
				// A deploy builds into a folder of its own, beside the build that
				// is in service: see deploy/deploy.sh.
				out: process.env.BUILD_DIR || 'build',
				serverOptions: { maxRequestBodySize: 8 * 1024 * 1024 * 1024, idleTimeout: 240 }
			})
		})
	]
});
