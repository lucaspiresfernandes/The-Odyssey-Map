# The Odyssey Map

A living map you can zoom into forever. A shared, real-time campaign map where every region
is a doorway to a map of its own, every marker explains itself on hover, and you can see
where everyone at the table is pointing.

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
2. Use the bar under the map to upload a map image, place world markers and draw regions.
   Each region gets a name and its own map: double-click it to step inside and build that
   one too. Click a region to select it: the Region buttons in the bar then enter, hide,
   rename or delete it, and its corners reshape it. Drag a corner to move it, drag the dot in the
   middle of an edge to add a corner, double-click a corner to remove it. Deleting a region
   asks first: the map behind it goes too, with everything inside, and there is no undo.
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

### Map images

A map image can be up to 256 MB and 30000 pixels on a side. One with a side over 2048
pixels is cut into tiles when it is uploaded, so that only the part on screen is loaded,
at the size the zoom calls for. The tiles are kept in `data/tiles/`. That folder needs no
backup: whatever is missing from it is made again when the map is next opened.

The zoom stops at twice the image's own pixels, where it would only get blurrier. For a
map that should zoom further, enlarge the image with an upscaler such as
[Upscayl](https://upscayl.org) and upload the result.

### On the map

| | |
|---|---|
| Drag, wheel, pinch | Pan and zoom |
| Hover or tap a marker | Read it |
| Click a marker | Pin its card, with edit, move and delete if it's yours to change |
| Double-click a region | Step into its map |
| Click a region, as the GM | Open its menu: enter, hide or reveal, rename, delete |
| Double-click a bare spot | Start a note there |
| Breadcrumbs | Step back out |
| Arrow keys, `+` `-` `0` | Pan, zoom and fit from the keyboard |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo and redo what you did on the map you're looking at |

Everyone's mouse shows on the map as it moves, with their name, for the people looking at
the same map.

It works on a phone too: a tap is a click and a double-tap a double-click, and the tools
sit in a bar along the bottom of the screen.

## Who can do what

| | GM | Player |
|---|---|---|
| World markers | create, edit, hide, reveal, delete | read (never the hidden ones) |
| Table notes | create, edit, delete, anyone's | create, edit anyone's, delete their own |
| Maps, images, regions | create, edit, hide, reveal, delete | read (never the hidden ones) |
| Undo and redo | their own changes | their own changes to table notes |

A table note can be deleted by whoever added it and by the GM, never by another player.

Hidden world markers are filtered on the server. They are not in the page a player loads,
not in the events their browser receives, and out of reach of a player's undo.

A hidden region works the same way, and takes its map with it: players can't open the map
behind it or any map further inside, can't load its image, and hear nothing of what happens
in there. A player who is inside when the GM hides it is walked back out.

## How it's put together

```
src/lib/shared/     types and permission rules, used by both servers and the browser
src/lib/client/     the browser's side: the live connection, the map's state, undo
src/lib/server/     database, sessions, and the modules that matter most:
  schema.ts           the tables, as a Drizzle schema
  world.ts            every change: validate, check permission, write, log an event
  visibility.ts       the only path from the event log to a client, filtered by role
drizzle/            SQL migrations generated from schema.ts
src/routes/         the SvelteKit app: pages, plus HTTP endpoints for uploads and a
                    command fallback
src/lib/components/ the map canvas, marker cards, forms
ws/server.ts        the WebSocket server: a bridge between browsers and the app
scripts/            run both servers, seed a demo, end-to-end check
```

- **One server owns the database.** Only the SvelteKit app opens it. The WebSocket server
  is a bridge with no data of its own: it forwards what browsers send it to the app, and
  delivers what the app tells it to.
- **One rules module.** Every command ends in `perform()` in `world.ts`, called by the app
  with the actor it authenticated and the raw command it received. Permission checks and
  writes live there and nowhere else.
- **Every change is an event.** `perform()` appends one row per change to the `events`
  table, with full before and after snapshots. After each change the app hands the new
  events to the WebSocket server, already filtered for each role, so a change reaches the
  table the same way however it was made.
- **Undo is one more change.** The server can take an event back by performing its
  opposite, which goes through the same permission checks and is logged like anything
  else. The browser remembers the numbers of the events its own commands made:
  `Ctrl+Z` asks for the latest to be taken back, and redo is undoing the undo.
- **Deleting a region is the exception.** It removes the region, the map behind it, every
  map further inside, their markers, their image files and their events. Nothing is kept
  to undo it with, so the GM is asked to confirm first.
- **Pointers skip the app.** Where each mouse is goes from browser to browser through the
  WebSocket server alone. It isn't a change to the world, so it is never stored.
- **One login.** When a browser connects, the WebSocket server passes its session cookie
  to the app, which says who that is. Commands are forwarded with the same cookie, so the
  app checks the login on every one.
- **The map still works offline from the socket.** If the live connection drops, the
  browser sends commands over HTTP instead and refreshes when the socket returns.

### Changing the database

Queries are written with [Drizzle](https://orm.drizzle.team) on top of `bun:sqlite`. To add
or change a table or column, edit [src/lib/server/schema.ts](src/lib/server/schema.ts), then
generate the migration:

```bash
bun run db:generate
```

That writes a new SQL file into `drizzle/`. Commit it with the schema change. The app
applies any migrations it hasn't seen yet when it starts, so there is nothing else to run.

## Configuration

All optional. Copy [.env.example](.env.example) to `.env` to change a default.

| Variable | Default | |
|---|---|---|
| `DATA_DIR` | `data` | database and uploaded images |
| `PORT` | `3000` | app port in production |
| `WS_PORT` | `3001` | WebSocket server port |
| `APP_URL` | set by `bun run dev` / `start` | where the WebSocket server forwards requests to the app |
| `BRIDGE_SECRET` | set by `bun run dev` / `start` | shared by the two servers, so only the app can have events delivered |
| `PUBLIC_WS_URL` | | full WebSocket URL, when a reverse proxy puts both servers on one origin |
| `ORIGIN` | | public address of the app, when it sits behind a proxy |

## Checks

```bash
bun run test
```

Unit tests for the rules: permissions, hidden markers and regions, undo and restore, campaign
isolation.

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

- Hiding applies to world markers and regions. A map itself is hidden only through the
  region that leads to it, so the first map of a campaign is always open.
- Events are numbered in one sequence. A player who inspects their network traffic can
  see the numbers skip when the GM makes a hidden change, though never what the change was.
- A player is a browser cookie. Clearing it means joining again as a new player, who can
  no longer delete the notes the old one added. The GM still can.
- Undo remembers what you did since you opened the map. It is forgotten when you step
  into another map or reload the page.
- Replaced map images stay on disk so that undo can bring them back. They go when the
  map itself is deleted, along with the region that leads to it.
- Undoing the drawing of a region only works while the map behind it is still empty.
  After that the region has to be deleted from the bar, which asks first.
- Everyone's pointer is shown, the GM's included, also while it hovers over something
  hidden from the players.
