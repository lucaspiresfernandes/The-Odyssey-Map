# The Odyssey Map

A living map you can zoom into forever. A shared, real-time campaign map where every region
is a doorway to a map of its own, every marker explains itself on hover, and anyone can
point a spot out to the table with a ping. At the end of the way down, a region can open
onto a battle map: a grid, tokens the players move themselves, a turn order, shapes
for the area of a spell and a ruler.

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
   one too. Until you give that map an image, it shows a closer look at the part of this
   one that the region covers, so one big image can carry several maps. See
   [Maps without an image](#maps-without-an-image). Click a region to select it: the Region buttons in the bar then enter, hide,
   rename or delete it, and its corners reshape it. Drag a corner to move it, drag the dot in the
   middle of an edge to add a corner, double-click a corner to remove it. Deleting a region
   asks first: the map behind it goes too, with everything inside, and there is no undo.
3. For a fight, make a battle map: pick **Battle map** when you name a new region. That
   choice is made once, and a map stays the kind it was made as. Step in, and set
   the size of a cell to match the squares of your image, then put tokens on it from the
   dock underneath and hand each player's to them. See [Battle maps](#battle-maps).
4. Click **Invite** and send the link to your players. They pick a name and they're in.
   Players need no account.
5. Around a real table, click **Display** and put the window that opens on the screen
   everyone can see. See [At the table](#at-the-table).

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
`data/`: the database and the pictures in the gallery. Before a session, copy what can't
be made again into a folder of its own:

```bash
bun run backup
```

That writes `backups/<date and time>/` with the database as one whole file and the
pictures as they were uploaded. It is safe to run while the app is running. Give it a
path to put the backups somewhere else: `bun run backup D:\maps`. To go back to one,
stop the app and put its `odyssey.db` and `uploads/` in `data/` in place of the ones
there, and delete `odyssey.db-wal` and `odyssey.db-shm` if they are there.

### At the table

These are for running the session, not for building the world. The ping and the finder
are everyone's. The rest are the GM's.

- **A ping.** Hold `Alt` and click a spot of any map, or on a touch screen rest a finger
  on it for a moment: rings spread from it in your colour, with your name under it, for
  everyone looking at that map, and it is gone again a couple of seconds later. That is
  all anyone is shown of where you are pointing. Nobody's mouse is on anyone else's
  screen: not the players', and not the GM's while it wanders over what is hidden.
- **The finder.** `Ctrl+K`, or the magnifier at the top, and type a few letters of a
  place or a marker. It searches every map of the campaign and every marker and note on
  them, and `Enter` takes you there, with a marker's card open. Nothing of it is on
  screen until it is asked for. A player is offered nothing hidden, nor anything behind
  a hidden region.

- **The party.** The banner button in the bar under a world map, then a click on the map,
  plants the party's banner there. From then on, drag the banner to move it: everyone
  sees it glide to where it went. A campaign has one party, on one map. Every map on the
  way down to that one shows the banner beside the name of the region to go through, so
  "where are we?" has an answer from anywhere. The party stands where the players are:
  it can't be put on a map behind a hidden region, and a region can't be hidden while
  the party is inside. On a battle map, tokens stand for it. Click the banner and a delete
  button comes out over it, which takes the party off the maps for everyone. `Delete`
  does the same, and `Ctrl+Z` plants it back where it stood.
- **The road behind it.** Every map the party has crossed keeps the road it took: a
  dotted line from stop to stop, in the GM's gold, for everyone who can open that map.
  Nothing has to be done for it, and nothing is stored: it is read from the moves the
  party has made. Undo a move and its stop comes off the road. Leaving the map ends a
  stretch, and coming back starts another. Each person can take it out of their own
  view with the last pill of the marker filter.
- **A scale, and a ruler.** The ruler in the bar under a world map measures between two
  spots, in miles, and the table sees your ruler while you do. It needs to know how far
  across the map is: the first time, the GM is asked. Say it once, on the biggest map.
  Every map further in works its own out from the region that leads to it: a region a
  third of the way across a map 600 miles wide opens onto a map 200 miles wide. A map
  whose own image is to another scale can be given one of its own, from the **Scale**
  button that is out while the GM holds the ruler. Players get the ruler on any map
  that has a scale to go by.
- **Bring everyone here.** The button with four arrows, in the bar under a world map and
  among the tools of a battle map. Every other browser in the campaign steps to the map
  you are on and is shown the part of it you are looking at, zoomed so all of what you
  see fits on their screen. Players are not brought onto a map behind a hidden region:
  you are told so, and only your own other windows follow. Someone who joins later, or
  a display that is switched on late, is brought to where the table was last called.
  Reloading a page is no reason to be brought back: each browser answers a call once.
- **A picture for the table.** In the **Gallery**, each picture has a small screen at
  its top edge. Click it and that picture fills every player's screen and the table
  display, with its name under it: the portrait of the villain, the handout, the view
  from the pass. Your own screen stays on the map, with **Showing …** at the top: click
  that to put the picture away again, for everyone. A player can close it on their own
  screen. It works for any picture, hidden or not: holding one up does not reveal it in
  the gallery, and players can load it only for as long as it is up.
- **The table display.** **Display**, at the top, opens the map you are on in a window
  of its own, to drag onto a TV or a second screen and make full screen (`F11`). It is
  the players' view and nothing around it: no bars, no tools, and nothing a player
  would not be sent, even though it is your login that opened it. It can be panned and
  zoomed, and regions stepped into, but nothing on it can be changed. The way back out
  is in its top corner: the name of the map it is on, with the maps on the way there
  lettered before it, fainter. Click one to step back out to it, or press `Backspace`
  to go back one map. Names are
  lettered larger on it, to be read from across the room, and on a battle map it shows
  the turn order down its side. It follows **Bring everyone here**, which is how you
  turn the page for the table, and it shows the picture you are holding up. It asks the
  screen to stay awake, which browsers allow on the machine the app runs on and over
  https. Any map's address with `?display` on the end is a display, so a player's tablet
  in the middle of the table can be one too.

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
  Goblin. A token with a picture has no colour of its own to pick. A picture can
  remember how its tokens start out: set one ogre up on the map, two cells across with
  a red ring, open its form and click **Start new tokens with this picture like this
  one**. Every ogre out of the dock after that is as big, with the same ring.

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

### Maps without an image

A world map with no image of its own borrows one. It shows the part of its parent's
image that lies under the region leading to it: the box around the region's corners, at
whatever size fills the screen. Draw a region around a kingdom on the map of the
continent, step in, and there is the kingdom, ready for markers, notes and regions of
its own.

It goes as deep as you like. A map inside a borrowing map shows a part of that part, and
so on down, all cut from the nearest map on the way up that has an image. How deep it
stays worth looking at depends on that image: a region 500 pixels across on it is 500
pixels of picture, however big it is shown. A big image goes a long way, which is what
the tiles are for.

Nothing is stored for it, and nothing needs doing. Reshape the region and the map
behind it shows the new part, also for whoever is in there at the time. Give the map
an image of its own and it shows that instead; `Ctrl+Z` brings the borrowed one back.
What is on a borrowing map is placed in fractions of the map, not of the picture. So
shape the region first and fill the map behind it afterwards: a reshape that changes
the box around the region slides the picture under the markers, notes and regions
already there.

A map with nothing to borrow from is plain paper: the first map of a campaign, and any
map with no image anywhere on the way up. So is a battle map, which is a table of its
own and keeps its plain grid until you give it an image.

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
  draw. Each has a key: `Q`, `W`, `E` and `R`, in that order. The pen draws lines,
  shapes and text: which of them is picked beside it. The GM's also has the map image, the name, the grid, the fog
  of war and **Bring everyone here**. A tool stays in hand until you click it again,
  take another or press `Esc`.
- **The turn order**, down the left side, once a token has been put in it: see below.

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
  it, locks it, marks it, duplicates it, opens its picture, colour and outline, and deletes it: a
  locked token can't be moved, resized or turned until someone unlocks it. Only the GM
  hides it and reveals it, and puts it in the turn order.
- **Marks.** The marks button brings them out. **Down** greys the token and crosses it
  out. The rest are pips on the token's rim: six plain colours, and fourteen small
  icons, each in a colour of its own on a dark pip: a skull, a flame, a bolt, a drop, a
  snowflake, a shield, a heart, a star, an eye, a moon, an arrow down, an arrow up, a
  target and a net. What each means is the table's to say: red for bloodied, the drop
  for poisoned, the eye for whoever is concentrating, the arrow down for prone. Click
  one to put it on, again to take it off. A token wears as many as it is given, and
  with several tokens selected a mark goes on all of them.
- **The turn order.** With tokens selected, the GM's hourglass button puts them in the
  turn order, and a strip appears down the left side of the map for everyone: each
  token in the order it acts, the one whose turn it is ringed in gold, there and on the
  map. **Next turn**, or `N`, moves on, and coming round to the top again starts the
  next round. The GM sorts the order by dragging a token up or down the strip, and the
  others make room as it goes. With the focus on one, `Alt` and the up or down arrow
  key does the same. A click on a token in the strip selects it on the map. **End the
  fight** empties the order,
  and `Ctrl+Z` takes back any of it. A token taken off the map is passed over and keeps
  its place, in case it comes back. Players see only the tokens they can see: a hidden
  one is not in their strip, and its turn is nobody's.
- **Shapes.** For the area of a spell, a breath, a wall. They come out of the same pen
  as the lines: with **Draw** in hand, pick a circle, a cone or a box
  in place of the line, and a colour, and drag: out from the middle of a circle, from
  the tip of a cone the way it points, from one corner of a box to the other. A cone is
  as wide at its far end as it is long. Its size is written on it in feet while you
  drag: a shape starts on the grid and is a whole number of cells long. Once it is
  drawn the hand is back, to move it or get on with the fight, and the pen remembers
  the shape for the next time. It lies on the map under the tokens, tinted so they show
  through. Catch
  it by its edge to select it, which shows its size again, and to drag it elsewhere: it
  keeps to the grid as it moves, a box from corner to corner of the cells, a circle and
  a cone from a corner, the middle of a cell or the middle of one of its sides. `Alt`
  leaves the grid, while drawing and while moving. A shape is moved and rubbed out like
  any drawing: by whoever drew it, and the GM.
- **Drawings.** With **Draw** in hand, and the line picked beside the
  tools, drag across the map to draw a line freehand in the colour you pick there. The
  pen stays in hand for the next line. Lines sit on the map under the tokens, and grow
  and shrink with it.
- **Text.** Out of the same pen again: with **Draw** in hand and **Draw text** picked
  beside the tools, click the map and type, then press `Enter`. The hand is back once
  it is written. Double-click a text of yours to reword it, whatever is in hand.
- **Selecting several.** With **Select several** in hand, drag a box: every token,
  drawing and text it touches is selected. `Shift`-click adds one or takes one out.
  Drag any of them and the rest come along, and the buttons act on all of them at once.
  `Delete` takes off the map what is yours to take off, and one `Ctrl+Z` brings it all back.
- **Fog of war.** The cloud among the GM's tools brings out three more beside it. The
  cloud there covers the whole map, or once there is fog, lifts all of it. With the eye
  in hand, drag a box over what the players may see; with the crossed-out eye, drag one
  over what to cover again. A box grows to the grid cells it touches, and a click is one
  cell. Hold `Alt` for the box exactly as dragged. The GM sees through the fog, dimly.
  To the players it is solid, and what stands under it is not sent to them at all: see
  [Who can do what](#who-can-do-what). `Ctrl+Z` takes back each change to the fog.
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
| Drag the party's banner, as the GM | Move the party across the map it is on |
| Click the party's banner, as the GM | Select it, with a button over it to take it off the maps |
| Drag a token | Move it, if it isn't locked. It snaps to the grid, unless `Alt` is held |
| Drag a handle of a selected token | Turn it, 15 degrees at a time, or resize it, half a cell at a time |
| `Alt`-click, or a finger held on a spot | Ping: point the spot out to everyone looking at that map |
| `Ctrl+K` | Find a map or a marker by name, and go there |
| `Q` `W` `E` `R` | On a battle map: select and move, select several, measure, draw lines, shapes and text |
| `N`, as the GM | On a battle map: on to the next turn |
| Click a token, a drawing or a text | Select it: its buttons float under it. `Shift`-click selects several |
| Double-click a text | Reword it, if it's yours |
| `Delete` | Take what is selected off a battle map, if it's yours to take off |
| A token with the focus | Arrow keys walk it one cell at a time |
| Breadcrumbs | Step back out |
| The names in the corner of a table display, or `Backspace` there | Step back out |
| Arrow keys, `+` `-` `0` | Pan, zoom and fit from the keyboard |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo and redo what you did on the map you're looking at |

Nobody's mouse shows on anyone else's map. What the table sees of the others is what
they have in hand, a token being dragged or a ruler, and the spots they ping.

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
| The party | put on a world map, move, take off the maps | see where it is, and the road it took |
| The scale of a world map | say how many miles across it is | measure, once a map on the way has one |
| A ping, and the finder | point a spot out, go to anything | point a spot out, go to anything not hidden |
| A picture for the table | hold any picture up, put it away | look, and close it on their own screen |
| The turn order, on battle maps | add tokens, sort by dragging, next turn, end the fight | see whose turn it is, among the tokens they can see |
| Fog of war, on battle maps | cover, clear, lift, see through | see what has been cleared |
| Bring everyone here | call everyone to a map and a view of it | follow |
| Tokens | create anywhere, give any picture, hide, reveal | create where there is no fog, give a revealed picture |
| Any token they can see | move, resize, turn, recolour, outline, label, mark, lock, unlock, duplicate, delete | move, resize, turn, recolour, outline, label, mark, lock, unlock, duplicate, delete |
| Drawings, text and shapes, on battle maps | create, move, change, rub out, anyone's | create, and move, change, rub out their own |
| Undo and redo | their own changes | their own changes to table notes, tokens and drawings |

A table note can be deleted by whoever added it and by the GM, never by another player.

A token is deleted by anyone who can see it, locked or not: a player never deletes one
that is hidden or under the fog, because to them it isn't there. Whoever deleted it
brings it back with `Ctrl+Z`. Beyond that, restoring a deleted token is the GM's.

Hidden world markers are filtered on the server. They are not in the page a player loads,
not in the events their browser receives, and out of reach of a player's undo. Hidden
tokens are filtered the same way, and the GM's browser doesn't show one being dragged.

A token under the fog of war is filtered the same way again. To a player it is not on
the map: not in the page, not in the events, and not there to act on by its id. Moving
out of the fog looks to them like a token being added, and going under like one being
taken away. When the fog itself moves, they are sent the tokens they may see now. A
player can't put a token down under the fog, or move one there: it would be lost to
them. A table display is sent what a player is, whoever opened it.

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
  db.ts, drivers/     where the database is kept: one driver per kind of place
  storage.ts          where the pictures are kept, behind one small interface
drizzle/            SQL migrations generated from schema.ts
src/routes/         the SvelteKit app: pages, plus HTTP endpoints for the gallery, its
                    pictures and a command fallback
src/lib/components/ the map canvas, marker cards, forms
ws/server.ts        the WebSocket server: a bridge between browsers and the app
scripts/            run both servers, seed a demo, back up, end-to-end check
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
- **A borrowed picture is worked out, not stored.** When a map is loaded, the app walks
  up from it through the regions on the way, to the first map with an image, and sends
  along which part of that image to show: `backdropOf` in `queries.ts`, with the
  arithmetic in `shared/backdrop.ts`. The browser draws that part with the same preview
  and tiles as the whole image, and loads only the tiles the part touches. It asks for
  the map again when a region or a map on the way up changes.
- **Pings skip the app.** A ping goes from browser to browser through the WebSocket
  server alone. It isn't a change to the world, so it is never stored. Where a mouse is
  otherwise is not sent to anyone.
- **So does a token in someone's hand.** While a token is dragged, where it is goes the
  same way, and so does a ruler. Nothing is sent while a hand is empty. Only letting go
  is a change: one `token.update` command, checked, stored and undoable like any other. A browser shows a
  token in someone's hand only if that person could really move it. When a whole
  selection is dragged, the table sees the token under the pointer move, and the rest
  arrive when it is put down.
- **A selection is one command.** What is done to several things at once goes to the
  server as a `batch`: every change in it happens in one transaction, or if one is
  refused, none does. Undo sends the batch back the same way.
- **A drawn line is thinned before it is sent.** The browser keeps the points that give
  the line its shape, to within a pixel on screen, and the server stores at most 800 of
  them. A line appears for the table when it is finished, not while it is being drawn.
- **Bringing everyone here goes through the app.** It changes nothing in the world, so
  nothing is stored. But who may follow depends on what is hidden, and only the app
  knows that: it tells the WebSocket server which roles to pass the call on to. The
  WebSocket server keeps the last call each role was let follow, for as long as it
  runs, and sends it to whoever connects later. A browser remembers the calls it has
  answered, so a reload doesn't answer one twice.
- **A picture for the table is the campaign's.** Which picture is up is one column on
  the campaign. It is not an event, so it has no undo, but it is kept: the app tells
  the WebSocket server whenever it changes and whenever a browser connects, and lets a
  player load that one picture for as long as it is up.
- **The turn order is part of its map.** Who takes turns, whose turn it is and the round
  are one value on the battle map, changed with `map.update` like its fog, so every
  step of a fight is an event and can be undone. It names tokens, so it goes through
  `visibility.ts` like everything else: a player's copy holds only the tokens they
  can see, and when one of those comes into sight or leaves it, the order they are
  shown comes along with that news.
- **A shape is a drawing.** A circle, a cone and a box are three more kinds of
  drawing, each kept as two points. Everything a drawing can do, they can: who may move
  one, undo, the limit per map. The outlines themselves are worked out from the two
  points in `shared/drawing.ts`. The code calls them templates, to tell them from
  the handles that reshape a token.
- **A mark is an id in a list.** A token keeps the ids of the marks it wears. How each
  looks, a colour or an icon, is one table: `TOKEN_MARKS` in `shared/types.ts`. A
  new mark is one more line there, and nothing in the database changes.
- **A map's scale is worked out like its borrowed picture.** A world map with no scale
  of its own takes it from the nearest map further out that has one, by how much of
  that map's width the regions on the way cover: `milesOf` in `queries.ts`. The
  browser asks for the map again when a scale on the way changes.
- **A display is a role, not a login.** A window opened with `?display` loads its pages
  as a player would, and its socket is put with the players', so nothing hidden is ever
  on its way to that screen. It is left out of who is at the table, and has no pointer.
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

### Keeping the data somewhere else

Out of the box everything is in `data/`: one SQLite file and three folders of pictures.
Both are behind a seam, so that either can move without the rest of the app knowing.

**The pictures.** Everything that reads or writes one goes through the `Storage`
interface in [src/lib/server/storage.ts](src/lib/server/storage.ts): `put`, `get`, `has`
and `remove`, by keys such as `uploads/abc-def.png` and `tiles/abc-def/preview.webp`.
`STORAGE_URL` picks the storage by its scheme. `file:` is a folder on this machine, and
what you get without setting anything. `memory:` keeps nothing past a restart, and is
there for tests. To add another, such as an S3 bucket, write the four methods and add
it to `KINDS` at the bottom of that file. A storage that is not on this machine's disk
leaves out `pathOf`, and the tiles of a big map are then cut in a scratch folder and
sent over piece by piece. The tests run the whole of that path against `memory:`.

**The database.** [src/lib/server/db.ts](src/lib/server/db.ts) opens it through a driver,
picked by the scheme of `DATABASE_URL`. The one driver there is,
[drivers/bun-sqlite.ts](src/lib/server/drivers/bun-sqlite.ts), answers to `file:` and is a
SQLite file opened with `bun:sqlite`. A driver is an object with the schemes it answers to
and an `open` that returns a Drizzle database with the migrations applied: add it to
`DRIVERS` in `db.ts`.

One thing a new driver has to match: every query in the app is synchronous, and a
transaction is a plain function. That fits any SQLite that Drizzle drives the same way,
on this machine or embedded in a host. A database reached over the network, such as
Turso or D1, answers with promises. Moving to one of those means first putting `await`
in front of the queries in `world.ts`, `queries.ts`, `gallery.ts`, `campaigns.ts` and
`auth.ts`, and making their callers wait. The seam is where that driver would plug in. It
does not do that work.

## Configuration

All optional. Copy [.env.example](.env.example) to `.env` to change a default.

| Variable | Default | |
|---|---|---|
| `DATA_DIR` | `data` | database and uploaded images |
| `DATABASE_URL` | `file:` the database in `DATA_DIR` | where the database is, for another file or another driver |
| `STORAGE_URL` | `file:` and `DATA_DIR` | where the pictures are kept, for another folder or another storage |
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
and drawings, the party, the fog of war and what it keeps from players, maps that
borrow their picture, the grid's arithmetic, undo and restore, campaign isolation, and the storage, on disk and off.
And for what a session is run with: marks, the turn order and what a player sees of it,
shapes, the scale of a world map, the party's road, the finder, a picture held
up for the table, and what a token picture starts its tokens out as.

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
- A borrowed picture is the box around the region, not the region's own outline: what
  lies beside an odd-shaped region shows too. It is only as sharp as the image it is cut
  from, and it can't be turned off for one map: to have plain paper there, lay a plain
  image under it.
- What is on a borrowing map doesn't follow the picture when its region is moved or
  resized.
- A battle map never borrows. To fight on a part of a bigger map, lay that map's image
  under the battle map itself.
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
- A token picture remembers a size and an outline for its tokens, and nothing else: not
  a colour, a name of its own for them, or marks.
- One picture is held up for the table at a time, and for everyone: not for one player
  only. It is shown whole, and can't be zoomed into.
- Undoing the drawing of a region only works while the map behind it is still empty.
  After that the region has to be deleted from the bar, which asks first.
- A ping shows where it lands on the map. Someone looking at another part of that map
  is not turned towards it, and someone on another map is not told.
- A ping, a ruler and a token in someone's hand are passed to every browser in the
  campaign, each of which shows only what is on the map it is on. A player who inspects
  their network traffic can see that the GM pinged or measured on a map they can't
  open, though nothing of what is there.
- The turn order is the GM's to run: a player can't end their own turn. It keeps no
  initiative rolls, so the order is sorted by hand. It tracks no hit points.
- A mark is a colour or an icon from a fixed set. It has no name of its own, no number
  on it, and no timer that takes it off again. Icons are small: on a token that is
  small on screen they are told apart by their colours until the map is zoomed in.
- A shape marks an area out. It doesn't say which tokens are in it, and it can't be
  resized or turned once drawn: draw another. There is no straight line among the
  shapes: a thin box does for one along the grid.
- A world map is measured in miles, as the crow flies. It knows nothing of roads, or of
  how long a day's travel is.
- The party's road is where the banner was planted, joined up with straight lines. It
  can't be edited: a stop that was a slip of the hand stays, unless the move is undone.
- The finder searches names: not the descriptions of markers, and not tokens.
- The fog of war is cleared and covered by hand, in boxes. It doesn't follow the tokens,
  and knows nothing of walls or of what a token could see.
- The fog keeps tokens from the players, not the picture of the map: their browser
  still loads the whole image, and draws the fog over it. Drawings and text under the
  fog are sent to players as well, and covered the same way.
- A token is under the fog or not by its middle. A big one at the edge of the clear
  shows with part of it covered.
- There is one party per campaign, and it is the GM's to move and to take off the maps.
- **Bring everyone here** is a call, not a leash: once there, everyone is free to pan
  away or step elsewhere. The last call is kept by the WebSocket server, so restarting
  the servers forgets it, and a call older than six hours is no longer sent to anyone.
- A table display letters names larger, and that is all it does for a far-away screen:
  tokens and pins are the size they are for everyone.
- The pen draws freehand lines in one thickness, and text is one size: no eraser that
  rubs out part of a line. A drawing can't be hidden from the players, and neither can
  a shape.
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
