import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The origin check lives in src/hooks.server.ts, where it also works over plain http.
			csrf: { trustedOrigins: ['*'] },
			// Map images are uploaded through the app, so raise the default 512 KB body limit.
			adapter: adapter({ serverOptions: { maxRequestBodySize: 32 * 1024 * 1024 } })
		})
	]
});
