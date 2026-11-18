// Starts the SvelteKit app and the WebSocket server together.
//
//   bun scripts/run.ts dev           development, this machine only
//   bun scripts/run.ts dev --lan     development, reachable from your network
//   bun scripts/run.ts start         the production build (run `bun run build` first)
//   bun scripts/run.ts start --lan

const [mode = 'dev', ...flags] = process.argv.slice(2);
const host = flags.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const bun = process.execPath;

const env = { ...process.env, WS_HOST: host, HOST: host };

const commands =
	mode === 'start'
		? [
				[bun, './build'],
				[bun, 'ws/server.ts']
			]
		: [
				[bun, 'run', '--bun', 'vite', 'dev', '--host', host],
				[bun, '--watch', 'ws/server.ts']
			];

const children = commands.map((cmd) =>
	Bun.spawn(cmd, { env, stdio: ['inherit', 'inherit', 'inherit'] })
);

let stopping = false;
function stop(code: number) {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill();
	process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// If either server dies, take the other down with it rather than leaving
// half an app running.
for (const child of children) child.exited.then((code) => stop(code ?? 1));
