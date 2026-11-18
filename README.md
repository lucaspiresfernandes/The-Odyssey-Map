# The Odyssey Map

A living map you can zoom into forever. A shared, real-time campaign map where every region
is a doorway to a map of its own and every marker explains itself on hover.

Built with SvelteKit, Bun and TypeScript. No map library, no paid platform, one SQLite file.

## Quick start

```bash
bun install
```

```bash
bun run seed
```

```bash
bun run dev
```

Open http://localhost:5173. `bun run seed` is optional: it creates a demo campaign with
five nested maps, and prints the demo GM login and a player invite link (the login is also
at the top of [scripts/seed.ts](scripts/seed.ts)). Skip it to start empty and create your
own GM account.

`bun run dev` starts two servers: the SvelteKit app on port 5173 and the WebSocket server
on port 3001.

## Running a session

1. Create a GM account and a campaign.
2. Turn on **Edit world** to upload a map image, place world markers and draw regions.
   Each region gets its own map: double-click it to step inside and build that one too.
3. Click **Invite** and send the link to your players. They pick a name and they're in.
   Players need no account.

To let other devices on your network reach it:

```bash
bun run dev:lan
```

Then share `http://<your-ip>:5173`. Your firewall has to allow ports 5173 and 3001.

For a real session, run the production build instead of the dev server:

```bash
bun run build
```

```bash
bun run start:lan
```

That serves the app on port 3000 (set `PORT` to change it). Everything is stored in
`data/`: the database and the uploaded map images. Back up that folder.

### On the map

| | |
|---|---|
| Drag, wheel, pinch | Pan and zoom |
| Hover or tap a marker | Read it |
| Click a marker | Pin its card, with edit, move and delete if it's yours to change |
| Double-click a region | Step into its map |
| Breadcrumbs | Step back out |
| Arrow keys, `+` `-` `0` | Pan, zoom and fit from the keyboard |
| **History** | Every change, who made it, what it was before, with undo and restore |

## Who can do what

| | GM | Player |
|---|---|---|
| World markers | create, edit, hide, reveal, delete | read (never the hidden ones) |
| Table notes | create, edit, delete | create, edit, delete, any player's |
| Maps, images, regions | create, edit, delete | read |
| History | everything | the table's notes |

Hidden world markers are filtered on the server. They are not in the page a player loads,
not in the events their browser receives, and not in the history they can read.

## How it's put together

```
src/lib/shared/     types and permission rules, used by both servers and the browser
src/lib/server/     database, sessions, and the two modules that matter most:
  world.ts            every change: validate, check permission, write, log an event
  visibility.ts       the only path from the event log to a client, filtered by role
src/routes/         the SvelteKit app: pages, plus HTTP endpoints for uploads,
                    history and a command fallback
src/lib/components/ the map canvas, marker cards, forms, history panel
ws/server.ts        the WebSocket server
scripts/            run both servers, seed a demo, end-to-end check
```

- **One rules module.** Both servers call `perform()` in `world.ts` with the actor they
  authenticated and the raw command they received. Permission checks and writes live
  there and nowhere else.
- **Every change is an event.** `perform()` appends one row per change to the `events`
  table, with full before and after snapshots. The history reads that table. The
  WebSocket server tails it, so a change reaches the table the same way whichever server
  wrote it.
- **One login.** The WebSocket server reads the same session cookie as the app and looks
  it up in the same database.
- **The map still works offline from the socket.** If the live connection drops, the
  browser sends commands over HTTP instead and refreshes when the socket returns.

## Configuration

All optional. Copy [.env.example](.env.example) to `.env` to change a default.

| Variable | Default | |
|---|---|---|
| `DATA_DIR` | `data` | database and uploaded images |
| `PORT` | `3000` | app port in production |
| `WS_PORT` | `3001` | WebSocket server port |
| `PUBLIC_WS_URL` | | full WebSocket URL, when a reverse proxy puts both servers on one origin |
| `ORIGIN` | | public address of the app, when it sits behind a proxy |

## Checks

```bash
bun run test
```

Unit tests for the rules: permissions, hidden markers, undo and restore, campaign isolation.

```bash
bun run test:e2e
```

Builds the app, starts both servers on spare ports with a throwaway database, and acts as
a GM and a player over HTTP and WebSockets.

```bash
bun run check
```

Type-checks everything.

## Known limits

- Hiding applies to world markers. Regions and the maps behind them are visible to every
  member of the campaign.
- Events are numbered in one sequence. A player who inspects their network traffic can
  see the numbers skip when the GM makes a hidden change, though never what the change was.
- A player is a browser cookie. Clearing it means joining again as a new player.
- Replaced map images stay on disk so that history can restore them.
