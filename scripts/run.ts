// Starts the SvelteKit app and the WebSocket server together.
//
//   bun scripts/run.ts dev           development
//   bun scripts/run.ts start         the production build (run `bun run build` first)
//
// Add --lan to either to listen on every network of this machine, whatever
// HOST says.
//
// The ports and the host come from `.env`, which Bun reads before this script
// runs. Variables already set in the shell win over the file. Copy
// `.env.example` to `.env` to begin.

const [mode = 'dev', ...flags] = process.argv.slice(2);

const missing = ['HOST', 'PORT', 'WS_PORT'].filter((name) => !process.env[name]?.trim());
if (missing.length) {
	console.error(
		`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
			'Copy .env.example to .env and fill it in.'
	);
	process.exit(1);
}

const host = flags.includes('--lan') ? '0.0.0.0' : process.env.HOST!.trim();
const appPort = process.env.PORT!.trim();
const bun = process.execPath;

const env = {
	...process.env,
	HOST: host,
	WS_HOST: host,
	PORT: appPort,
	// The two servers talk to each other on this machine. The WebSocket
	// server forwards what browsers send it to the app at APP_URL, and the
	// app proves who it is to the WebSocket server with BRIDGE_SECRET. Left
	// blank, the secret is made anew on every start.
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
