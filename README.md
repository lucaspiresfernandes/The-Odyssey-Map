# The Odyssey Map

A living map you can zoom into forever. A shared, real-time campaign map where every region
is a doorway to a map of its own, every marker explains itself on hover, and you can see
where everyone at the table is pointing. At the end of the way down, a region can open
onto a battle map: a grid, tokens the players move themselves, and a ruler.

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
five nested maps, the innermost a battle map with a fight set up on it, and prints the demo GM login and a player invite link (the login is also
at the top of [scripts/seed.ts](scripts/seed.ts)). Skip it to start empty and create your
own GM account.

`bun run dev` starts two servers: the SvelteKit app on port 5173 and the WebSocket server
on port 3001.

## Running a session

1. Create a GM account and a campaign.
2. Use the bar under the map to choose a map image from the gallery, place world markers
   and draw regions. See [The gallery](#the-gallery).
   Each region gets a name and its own map: double-click it to step inside and build that
   one too. Click a region to select it: the Region buttons in the bar then enter, hide,
   rename or delete it, and its corners reshape it. Drag a corner to move it, drag the dot in the
   middle of an edge to add a corner, double-click a corner to remove it. Deleting a region
   asks first: the map behind it goes too, with everything inside, and there is no undo.
3. For a fight, make a battle map: pick **Battle map** when you name a new region. That
   choice is made once, and a map stays the kind it was made as. Step in, and set
   the size of a cell to match the squares of your image, then put tokens on it from the
   dock underneath and hand each player's to them. See [Battle maps](#battle-maps).
4. Click **Invite** and send the link to your players. They pick a name and they're in.
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
`data/`: the database and the pictures in the gallery. Back up that folder.

### The gallery

Every campaign has a gallery: the pictures it keeps, to use as often as you like. It has
two shelves, map images and token pictures.

**Gallery**, at the top of any map, opens both for the GM. That is the place to stock up
before a session: add, rename, reveal and take out pictures, with no map or token
waiting for one. Each shelf also opens from where it is used, to pick from.

- **Map images.** The image button in the bar under a map opens them. Add images with the
  first tile, or drop files on the dialog, then click one to lay it under the map. The
  same image can lie under any number of maps, and `Ctrl+Z` takes it back off.
- **Token pictures.** **Choose from the gallery** in a token's form opens them. A token
  yet to be named takes the name of the picture you pick, so a goblin's picture makes a
  Goblin. A token with a picture has no colour of its own to pick.

A picture is named after the file it came in. Click the name to change it. The **×** on a
picture takes it out of the gallery: the maps and tokens that already show it keep it,
and it is removed from disk once the last of them has let go of it. What happens in the
gallery is not part of the map's history, so there is no undo for it.

The gallery is the GM's. Every picture starts hidden from the players, so adding one
never spoils a surprise. On the token shelf each picture has an eye in its corner: click
it to reveal that picture to the table, and again to hide it. A revealed picture keeps a
gold eye.

A player opens the gallery from the form of a token. They are shown the token
pictures you have revealed and nothing else, and pick from those. They can't add,
rename, reveal or take out anything.

A hidden picture is, to a player, not in the gallery. They can load it only where you
have put it in front of them: as the image of a map they can open, or on a token they
can see. Hiding a picture again leaves it on the tokens that already wear it.

### Map images

A map image can be up to 256 MB and 30000 pixels on a side. One with a side over 2048
pixels is cut into tiles when it is added, so that only the part on screen is loaded, at
the size the zoom calls for. The tiles are kept in `data/tiles/` and the gallery's
thumbnails in `data/thumbs/`. Neither folder needs a backup: whatever is missing is made
again when it is next asked for.

A token picture is made to fit in 512 pixels when it is added, however big it came.

The zoom stops at twice the image's own pixels, where it would only get blurrier. For a
map that should zoom further, enlarge the image with an upscaler such as
[Upscayl](https://upscayl.org) and upload the result.

### Battle maps

A map is a world map or a battle map. A world map is for finding your way: markers,
notes, and regions that lead further in. A battle map is a table to play on, and the end
of the way down. It holds no markers, no notes and no regions, and none of the tools for
them. It has two palettes of its own, and each folds away with the arrow at its end:

- **The dock of tokens**, along the bottom. It shows every token that can be put on the
  map: a plain disc first, then the token pictures in the gallery (for a player, the ones
  the GM has revealed). Click one and it goes down in the free cell nearest the middle of
  the view. Drag one and it goes down where you let go. The GM's **+** adds pictures to
  the gallery straight from here.
- **The tools**, in the upper right corner: select and move, select several, measure,
  draw, write text. Each has a key: `Q`, `W`, `E`, `R` and `T`, in that order. The GM's
  also has the map image, the name and the grid. A tool stays in hand until you click it
  again, take another or press `Esc`.

What is on a battle map:

- **A grid.** **Set up the grid** takes the size of one cell in pixels of the map image,
  and how far to shift the grid right and down to line it up. The dialog says how many
  cells that makes, to compare with the squares you count on the image. For an image that
  has its own grid drawn on, turn the lines off: tokens still snap to the cells. The same
  dialog says how many feet one cell stands for: 8 to begin with, and each map has its own.
- **Tokens.** A disc in its colour, or its picture, half a cell to six cells across, with
  its label written underneath. Anyone at the table drags any token that isn't locked.
  Everyone sees it move while it is being dragged, and it snaps to the grid when it is
  let go. Hold `Alt` to put it down exactly where you let go.
- **Outlines.** Any token, with a picture or without, can wear a ring in a colour of its
  own: to tell apart tokens that look the same, or to mark which belong together. A new
  token has none.
- **The handles on a selected token.** Click a token that isn't locked and it gets three.
  The one above it turns it: drag it around the token, and the token turns with it, 15
  degrees at a time. Let go, and the handle is back on top. The dot on each side resizes
  it: drag one out or in, and the token grows or shrinks half a cell at a time. While you
  drag a handle, the angle or the size it has come to, in feet, is written over the token. With
  several tokens selected there are no handles.
- **The buttons on a selected token.** They float just under it, below its name. Anyone at the table labels
  it, locks it, duplicates it and opens its picture, colour and outline: a locked token
  can't be moved, resized or turned until someone unlocks it. Only the GM hides it,
  reveals it and deletes it.
- **Drawings.** With **Draw** in hand, drag across the map to draw a line in the colour
  you pick beside the tools. Lines sit on the map under the tokens, and grow and shrink
  with it.
- **Text.** With **Write text** in hand, click the map and type, then press `Enter`.
  Double-click a text of yours to reword it.
- **Selecting several.** With **Select several** in hand, drag a box: every token,
  drawing and text it touches is selected. `Shift`-click adds one or takes one out.
  Drag any of them and the rest come along, and the buttons act on all of them at once.
  `Delete` takes off the map what is yours to take off, and one `Ctrl+Z` brings it all back.
- **A ruler.** Dragging a token shows how many feet it has moved. **Measure a distance**
  measures between any two spots, and the table sees your ruler while you do. Distances
  are in feet, at the scale the map was set up with, and a diagonal step counts as one
  cell.

Anyone at the table draws and writes. A drawing or a text is moved, changed and rubbed
out by whoever made it, and by the GM.

The way from the world to a battle map is a region, like the way to any other map:
double-click it and you are at the table.

Which of the two a map is gets decided when its region is drawn, and doesn't change
afterwards. For the other kind, draw another region. The first map of a campaign is
always a world map.

### On the map

| | |
|---|---|
| Drag, wheel, pinch | Pan and zoom |
| Hover or tap a marker | Read it |
| Click a marker | Pin its card, with edit, move and delete if it's yours to change |
| The funnel in the bar under a world map | Choose which types of marker you see. It changes your view only |
| Double-click a region | Step into its map |
| Click a region, as the GM | Open its menu: enter, hide or reveal, rename, delete |
| Double-click a bare spot | Start a note there, on a world map |
| Drag a token | Move it, if it isn't locked. It snaps to the grid, unless `Alt` is held |
| Drag a handle of a selected token | Turn it, 15 degrees at a time, or resize it, half a cell at a time |
| `Q` `W` `E` `R` `T` | On a battle map: select and move, select several, measure, draw, write text |
| Click a token, a drawing or a text | Select it: its buttons float under it. `Shift`-click selects several |
| Double-click a text | Reword it, if it's yours |
| `Delete` | Take what is selected off a battle map, if it's yours to take off |
| A token with the focus | Arrow keys walk it one cell at a time |
| Breadcrumbs | Step back out |
| Arrow keys, `+` `-` `0` | Pan, zoom and fit from the keyboard |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo and redo what you did on the map you're looking at |

Everyone's mouse shows on the map as it moves, with their name, for the people looking at
the same map.

It works on a phone too: a tap is a click and a double-tap a double-click, and the tools
sit in a bar along the bottom of the screen. On a battle map that bar is the dock of
tokens, and the tools are in the corner.

## Who can do what

| | GM | Player |
|---|---|---|
| World markers, on world maps | create, edit, hide, reveal, delete | read (never the hidden ones) |
| Table notes, on world maps | create, edit, delete, anyone's | create, edit anyone's, delete their own |
| Maps, regions | create, edit, hide, reveal, delete | read (never the hidden ones) |
| The gallery | add, rename, reveal, hide, take out, lay an image under a map | look through what the GM has revealed, pick one of those for a token |
| Battle maps and grids | make one behind a new region, set up the grid | read |
| Tokens | create, give any picture, hide, reveal, delete | create, give a revealed picture |
| Any token they can see | move, resize, turn, recolour, outline, label, lock, unlock, duplicate | move, resize, turn, recolour, outline, label, lock, unlock, duplicate |
| Drawings and text, on battle maps | create, move, change, rub out, anyone's | create, and move, change, rub out their own |
| Undo and redo | their own changes | their own changes to table notes, tokens and drawings |

A table note can be deleted by whoever added it and by the GM, never by another player.

A token is deleted by the GM only. The one way round that is undo: a player who has just
put a token on the map, or duplicated one, can take that back with `Ctrl+Z`.

Hidden world markers are filtered on the server. They are not in the page a player loads,
not in the events their browser receives, and out of reach of a player's undo. Hidden
tokens are filtered the same way, and the GM's browser doesn't show one being dragged.

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
  gallery.ts          the campaign's pictures, and who may load which
  visibility.ts       the only path from the event log to a client, filtered by role
drizzle/            SQL migrations generated from schema.ts
src/routes/         the SvelteKit app: pages, plus HTTP endpoints for the gallery, its
                    pictures and a command fallback
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
  map further inside, their markers, their tokens and their events. Nothing is kept to
  undo it with, so the GM is asked to confirm first. Their images stay in the gallery.
- **Pointers skip the app.** Where each mouse is goes from browser to browser through the
  WebSocket server alone. It isn't a change to the world, so it is never stored.
- **So does a token in someone's hand.** While a token is dragged, where it is rides
  along with the pointer, and so does a ruler. Only letting go is a change: one
  `token.update` command, checked, stored and undoable like any other. A browser shows a
  token in someone's hand only if that person could really move it. When a whole
  selection is dragged, the table sees the token under the pointer move, and the rest
  arrive when it is put down.
- **A selection is one command.** What is done to several things at once goes to the
  server as a `batch`: every change in it happens in one transaction, or if one is
  refused, none does. Undo sends the batch back the same way.
- **A drawn line is thinned before it is sent.** The browser keeps the points that give
  the line its shape, to within a pixel on screen, and the server stores at most 800 of
  them. A line appears for the table when it is finished, not while it is being drawn.
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

Unit tests for the rules: permissions, hidden markers and regions, battle maps, tokens
and drawings, the grid's arithmetic, undo and restore, campaign isolation.

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
- Undo can't put back a map image, or a token's picture, that has since been taken out
  of the gallery and removed from disk.
- A player can't add a picture of their own to the gallery. They send it to the GM,
  who adds it and reveals it.
- Pictures are revealed one at a time, and to the whole table: not to one player only.
- A picture in the gallery is a picture and a name. It doesn't remember a token's size
  or colour.
- Undoing the drawing of a region only works while the map behind it is still empty.
  After that the region has to be deleted from the bar, which asks first.
- Everyone's pointer is shown, the GM's included, also while it hovers over something
  hidden from the players.
- A battle map has no fog of war and no initiative order.
- The pen draws freehand lines in one thickness, and text is one size: no shapes, no
  eraser that rubs out part of a line. A drawing can't be hidden from the players.
- A token's label is its name: it can be changed by anyone, but not left empty.
- A token is half a cell to six cells across, and turns in steps of 15 degrees.
- A player sees a newly revealed token picture in the dock the next time they reach for
  it, not the moment the GM reveals it.
- The grid is square, and is lined up by typing numbers, not by dragging it over the image.
- The ruler counts a diagonal step as one cell, and tells distances in feet: there are no
  metres.
- The way into a battle map is a region. A marker can't lead to one.
- A battle map holds no markers, notes or regions.
- A map stays the kind it was made as. A world map can't be turned into a battle map, or
  a battle map into a world map: draw a new region for the other kind.
