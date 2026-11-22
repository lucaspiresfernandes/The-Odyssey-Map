// Starts the SvelteKit app and the WebSocket server together.
//
//   bun scripts/run.ts dev           development, this machine only
//   bun scripts/run.ts dev --lan     development, reachable from your network
//   bun scripts/run.ts start         the production build (run `bun run build` first)
//   bun scripts/run.ts start --lan

const [mode = 'dev', ...flags] = process.argv.slice(2);
const host = flags.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const bun = process.execPath;

const appPort = '5173';

const env = {
	...process.env,
	WS_HOST: host,
	HOST: host,
	// The two servers talk to each other on this machine. The WebSocket
	// server forwards what browsers send it to the app at APP_URL, and the
	// app proves who it is to the WebSocket server with BRIDGE_SECRET.
	APP_URL: process.env.APP_URL || `http://127.0.0.1:${appPort}`,
	BRIDGE_SECRET: process.env.BRIDGE_SECRET || crypto.randomUUID()
};

const commands =
	mode === 'start'
		? [
				[bun, './build'],
				[bun, 'ws/server.ts']
			]
		: [
				// A fixed port, because the WebSocket server has to find the app.
				[bun, 'run', '--bun', 'vite', 'dev', '--host', host, '--port', appPort, '--strictPort'],
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
