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
2. Open the menu at the left end of the bar over the map, the button with three stripes,
   and choose **Map Settings**: the name of the map you are on, its image out of the
   gallery and its scale, in one dialog. Nothing changes until you save it, and then it
   is one step for `Ctrl+Z`. On a world map the scale is how many miles across it is and
   how far a day's travel goes, and on a battle map how many feet one cell is. Then use
   the bar under the map to place world markers and draw regions. See
   [The gallery](#the-gallery).
   Each region gets a name and its own map: double-click it to step inside and build that
   one too. Until you give that map an image, it shows a closer look at the part of this
   one that the region covers, so one big image can carry several maps. See
   [Maps without an image](#maps-without-an-image). Click a region to select it: buttons float over it to enter, close,
   hide, share, rename or delete it, and its corners reshape it. See [Secrets](#secrets) for
   what closing, hiding and sharing do. Drag a corner to move it, drag the dot in the
   middle of an edge to add a corner, double-click a corner to remove it. Deleting a region
   asks first: the map behind it goes too, with everything inside, and there is no undo.
3. For a fight, make a battle map: pick **Battle map** when you name a new region. That
   choice is made once, and a map stays the kind it was made as. Step in, and set
   the size of a cell to match the squares of your image, then put tokens on it from the
   dock underneath and hand each player's to them. See [Battle maps](#battle-maps).
4. Make a seat for each player: **Seats**, in the menu at the left end of the bar over the
   map. Then click **Invite**: it shows a code to scan with a phone, and the same link
   to copy and send. Players pick their name among the seats, you let them in, and they
   need no account. See [Getting to the table](#getting-to-the-table).
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
`data/`: the database and the pictures in the gallery.

One campaign can be taken out as a single file, and put back in: **Export** beside a
campaign of yours on the first page downloads it, and **Import a campaign from a file**
under them makes a new campaign out of such a file. See [A campaign in one file](#a-campaign-in-one-file).

The app makes no backups of its own: that is left to the machine it runs on. What can't
be made again is the database, `data/odyssey.db`, and the pictures as they were uploaded,
`data/uploads/`.

### Getting to the table

- **Seats first.** Players don't name themselves: they pick their name among the seats
  you made. So **Invite** has a link to share only while some seat has nobody in it.
  With none, it says so and leads to **Seats**, and the table display is shown no code.
- **A code to scan.** **Invite** shows the invite link as a QR code. When your own browser
  is on the machine the app runs on, the code is made out to that machine's address on
  your network, not to `localhost`, which a phone could not open. A machine with several
  addresses lets you pick the one your players are on. Started without `--lan`, the app
  answers nobody else, and the dialog says so.
- **The code on the table display.** **Show the code** in that dialog puts it in a corner
  of the display window, with the address under it, for everyone to scan from where they
  sit. **Take it off** removes it, and so does stepping the display to another map.
- **You let everyone in.** The invite link gets someone to the door and no further.
  It lists the seats by name. They pick their own, you are asked on your map, and **Let
  them in** sits that browser down as that player. Until then they are nobody at the
  table, and **Not now** leaves them outside. An asking that goes unanswered lapses
  after ten minutes. A browser that is logged in already, with a GM account or as a
  player of another campaign, picks a name the same way and becomes that player.
- **A seat to come back to.** A player is known by the browser they sat down with. When
  that browser has forgotten them, or they come on another device, they open the invite
  link they have and pick their name again, which is marked **taken**. You are asked
  the same way, told that it is a seat asked back, and **Let them in** logs that browser
  in as the player they were: with their notes, their tokens and every secret they were
  let in on.
- **One browser to a seat.** While a player is at the table, their name on the invite
  link is marked **at the table** and can't be picked, and nobody is let into their
  seat. A browser let into a seat takes it over: the one that sat there before is
  logged out. So a player who changes device asks for their seat again each time.
- **The seats are yours to look after.** **Seats**, in the menu at the left end of the bar
  over the map, or `Shift+P`, lists every player of the campaign. A seat is a name and
  nothing else: no login, no password. Make one for each player ahead of the session,
  and they are there to be handed a token or let in on a secret before anyone has
  arrived. Whoever is to sit in one opens the invite link and picks their name. Click a
  name to change it: it changes on their tokens, notes and drawings too. The **×** takes
  a seat away, and asks first: their tokens become nobody's, they are in on no secret
  any more, and a browser that sat in the seat is shown back to the first page. What
  they made stays on the maps. **Invite players** at the bottom goes on to the invite,
  once a seat is free.

### At the table

These are for running the session, not for building the world. The ping and the finder
are everyone's. The rest are the GM's.

- **A ping.** Hold `Alt` and click a spot of any map, or on a touch screen rest a finger
  on it for a moment: rings spread from it in your colour, with your name under it, for
  everyone looking at that map, and it is gone again a couple of seconds later.
- **Pointing.** The rings among the tools in the upper right corner of a map, where
  the key is `T`. With that tool in hand the cursor is a dot in a ring, and
  for as long as you hold the button down, everyone looking at that map sees a dot in
  your colour where your pointer is, with your name under it, following it as it moves:
  the road to take, the wall to climb, "this one, not that one". Let go and it is gone.
  A press let go at once leaves a ping. On a touch screen, press and move a finger. The
  tool stays in hand until you put it away with `Esc` or its button, and while it is,
  dragging points and doesn't move the map: the wheel and a pinch still do.

  That, and a ping, are all anyone is shown of where you are pointing. Nobody's mouse
  is on anyone else's screen otherwise: not the players', and not the GM's while it
  wanders over what is hidden.
- **The finder.** `Ctrl+K`, or the magnifier at the top, and type a few letters of a
  place or a marker. It searches every map of the campaign and every marker and note on
  them, by name first and then by what a marker's card says: a marker found by its
  words shows the words that matched. `Enter` takes you there, with a marker's card open. Nothing of it is on
  screen until it is asked for. A player is offered nothing hidden, nor anything behind
  a hidden region.

- **Fog that lifts where you clear it.** The cloud in the upper right corner of a world
  map takes up the fog, and its tools come out beside it: the same ones a battle map
  has, in the same place. With
  the eye, paint over the map to clear the fog from it: the valley seen from the pass,
  the road the players took. With the crossed eye, paint over what to cover again. What
  you paint with is beside those two. The circle is a round brush, which is what you
  start out with: a ring under the pointer shows what it reaches, and the slider sizes
  it, as do `[` and `]`, and the wheel with `Shift` held. The square is a brush with
  corners, sized the same way: for the streets of a town. The cloud there covers the whole map, or once there
  is fog, lifts all of it. A second click on the cloud in the corner, or `Esc`, puts
  them away. Each world map has its own, so
  the continent can be under fog while the city is not. Under it, players see the map
  only where you have cleared it. World markers and regions under the fog are not sent
  to players at all, and a region they can't see is one they can't step into. The
  table's own notes are never lost to it. You see through it, dimly. `Ctrl+Z` takes back
  each change to the fog.
- **What is new glints.** A world marker you reveal, or that comes out of the fog, and a
  region that does, glints in gold on each player's map until they have looked at it: its
  card open for a moment, or the pointer resting on the region. It works across sessions:
  what was revealed since a player last had that map open glints when they come back. On
  a table display it glints for twenty seconds. A map someone opens for the first time is
  new all over, and nothing on it glints.
- **A picture on a marker.** A world marker can carry a picture out of the gallery, off
  either shelf: its card shows it above the words, for whoever can see the marker, hidden
  in the gallery or not. Choose it in the marker's form. On a pinned card, the screen
  button holds that picture up for the whole table.
- **The date in the world.** The GM writes what day it is in the field floating in the upper
  left corner of any map, over who is at the table, in whatever words the setting's calendar has for it: "15th of Mirtul, 1492 DR".
  It saves on `Enter` or when the field is left, and `Esc` leaves it as it was. Everyone
  sees it there at once, and a table display letters it in its corner. Cleared, it is
  gone from every screen. It is no change to a map, so `Ctrl+Z` doesn't take it back:
  write the old date in again.
- **Several markers at once.** With **Select multiple** in hand, the dotted box in the
  upper right corner of a world map or the key `W`, drag a box around markers: the ones
  that are yours to change are selected together, which is all of them for the GM and
  the table's notes for a player. `Shift` and a click adds one, or takes one out. Drag
  any of them and the rest come along. Under them are their buttons: the GM hides the
  world markers among them from the players or shows them again, and the bin, like
  `Delete`, takes off the map the ones that are yours to delete. Each of those is one
  step for `Ctrl+Z`. A click on the map lets go of them.
- **A scale, and a ruler.** The ruler in the upper right corner of a world map, beside
  the pointing tool and the GM's fog, or the key `E`, measures between two spots, in miles, and the table sees your ruler while you do. It needs to know how far
  across the map is: the first time, the GM is asked, in **Map Settings**. Say it once, on the biggest map.
  Every map further in works its own out from the region that leads to it: a region a
  third of the way across a map 600 miles wide opens onto a map 200 miles wide. A map
  whose own image is to another scale can be given one of its own, in **Map Settings**. Players get the ruler on any map
  that has a scale to go by.
- **Feet and miles, or metres and kilometres.** **Map Settings** has **Distances are
  told in**. Say it once, on the first map of the campaign: every map inside goes by
  it, until one says otherwise for itself and the maps inside it. The ruler, the size
  of a shape and of a token, and every scale you type are then in metres and
  kilometres. They are worked out by the round numbers tabletop games use: five feet
  is 1.5 m, and a mile 1.5 km.
- **How long the way takes.** The ruler of a world map says it beside the miles: "84 mi ·
  about 3½ days". It goes by how far a day's travel goes, which is 24 miles until you say
  otherwise in **Map Settings**. Like the scale, it is said once, on the biggest
  map, and again only on a map where the going is different: the marsh, the mountain
  road. Short of a day it is told in hours, of which a day on the road has eight.
- **A ruler that follows the road.** Drag, and the ruler is straight, and gone when you
  let go. Click instead, and each click is a bend: the ruler runs through every one, and
  tells the whole way. Double-click ends it, and it stays on the map to be read, for the
  table too, until you start another or put the ruler away. `Backspace` takes the last
  bend back. It works the same on a battle map, where each stretch is counted in cells.
- **A picture for the table.** In the **Gallery**, each picture has a small screen at
  its top edge. Click it and that picture fills every player's screen and the table
  display, with its name under it: the portrait of the villain, the handout, the view
  from the pass. Your own screen stays on the map, with **Showing …** at the top: click
  that to put the picture away again, for everyone. A player can close it on their own
  screen. It works for any picture, hidden or not: holding one up does not reveal it in
  the gallery, and players can load it only for as long as it is up. Pick players from
  the row at the top of the gallery first, and the picture goes up for them alone: the
  letter only one of them reads. The others, and the table display, are shown nothing.
- **The table display.** **Display**, at the top, opens the map you are on in a window
  of its own, to drag onto a TV or a second screen and make full screen (`F11`). It is
  the players' view and nothing around it: no bars, no tools, and nothing a player
  would not be sent, even though it is your login that opened it. It can be panned and
  zoomed, and regions stepped into, but nothing on it can be changed. The way back out
  is in its top corner: the name of the map it is on, with the maps on the way there
  lettered before it, fainter. Click one to step back out to it, or press `Backspace`
  to go back one map. Names are
  lettered larger on it, to be read from across the room, and on a battle map it shows
  the turn order down its side, each token by name. It shows the picture you are holding up. It asks the
  screen to stay awake, which browsers allow on the machine the app runs on and over
  https. Any map's address with `?display` on the end is a display, so a player's tablet
  in the middle of the table can be one too.

### Secrets

Three things keep part of the world from the players, and they stack. All three are the
GM's, and each is taken back with `Ctrl+Z`.

- **Hidden.** A world marker, a region or a token that is hidden is, to the players,
  not there. A hidden region takes its map with it, and every map further inside.
- **A secret with some players.** The **Visibility** button, with the eye: on a pinned
  marker's card, over a selected region, under a selected token, and under world markers
  selected together. It opens a dialog that says who sees the thing, everyone or only
  some players. `H` hides it from everyone or reveals it without opening the dialog. Pick
  players and the thing is hidden from the table and shown to them: the cache only the
  rogue spotted, the passage one of them was told of, the familiar its master alone can
  see. A player who is let in sees it marked as a secret, and is not told who else is.
  A region shared this way opens its map to them too. Reveal it to all players and it
  is a secret with nobody.
- **Closed.** The lock among the buttons over a selected region. A closed region stays on the players'
  map, with a lock before its name, and none of them can step into it: the keep on the
  horizon, the door they have no key for. Nothing that happens inside reaches them
  until you open it. Tick **Closed to players** when naming a new region to draw it
  that way.

Who a player is, is their browser: see [Known limits](#known-limits).

### A campaign in one file

**Export**, beside a campaign you run on the first page, downloads all of it as one
file: every map, region, marker, note, token, drawing and encounter, the turn orders and the fog,
the date in the world, and the pictures in the gallery as they were uploaded. It is a `.tar` archive that any
archive tool opens: `campaign.json`, and an `uploads` folder.

**Import a campaign from a file** makes a new campaign out of one, with you as its GM.
It never changes a campaign that is there, so the same file can be imported twice, and
a file from another table is as good as your own. Use it to keep a copy before a
session, to move a campaign to another machine, or to hand a prepared world to another
GM.

What stays behind is what belonged to the table and not to the world: who plays in it,
which of them was let in on which secret, the picture being held up, and the history
that undo works from. Hidden and closed things arrive hidden and closed.

### The gallery

Every campaign has a gallery: the pictures it keeps, to use as often as you like. It has
two shelves of pictures, map images and token pictures, and for the GM a third that is
made out of the second: encounters.

**Gallery**, at the top of any map, opens all of it for the GM. That is the place to stock up
before a session: add, rename, reveal and take out pictures, with no map or token
waiting for one, and put encounters together. Each shelf of pictures also opens from
where it is used, to pick from.

- **Map images.** The image button in **Map Settings** opens them. Add images with the
  first tile, or drop files on the dialog, then click one: it is laid under the map when
  the settings are saved. The same image can lie under any number of maps, and `Ctrl+Z`
  takes it back off.
- **Token pictures.** **Choose from the gallery** in a token's form opens them. A token
  yet to be named takes the name of the picture you pick, so a goblin's picture makes a
  Goblin. A token with a picture has no colour of its own to pick. A picture can
  remember how its tokens start out: set one ogre up on the map, two cells across with
  a red ring, open its form and click **Start new tokens with this picture like this
  one**. Every ogre out of the dock after that is as big, with the same ring.
- **Encounters.** An encounter is tokens made ahead of time, to put down on a battle map
  in one go: the ambush on the road, the dragon and its cultists. **New encounter** makes
  one and opens it, with its name ready to be typed over. Under the name are the tokens
  in it, and under those everything a token can be made of: a plain disc, every token
  picture in the gallery, and a **+** for a picture that isn't there yet, which goes on
  the token shelf as well. Click one and the encounter has one more of it: three clicks
  on the goblin for three goblins. Each token is named after its picture and starts out
  as that picture says, as big and with the same ring. Click a token's name to change
  it, and its **×** to take it out. Every change is kept as you make it. An encounter is
  put down from [the dock of a battle map](#battle-maps), and only the GM ever sees it.

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
them. It has three palettes of its own, and each folds away:

- **The dock**, along the bottom, in two levels. At the bottom are its buttons, one for
  each kind of thing that goes on the map: **Tokens**, and for the GM **Encounters**.
  Click one and its tray slides open on top of it. Click it again and the tray is put
  away, and the map has its room back. The dock is as you left it the next time.
  - The tray of tokens shows every token that can be put on the map: a plain disc first,
    then the token pictures in the gallery (for a player, the ones the GM has revealed).
    Click one and it goes down in the free cell nearest the middle of the view. Drag one
    and it goes down where you let go. The GM's **+** adds pictures to the gallery
    straight from here.
  - The tray of encounters shows the ones made in [the gallery](#the-gallery), each with
    the first few of its tokens, its name and how many it holds. Click or drag one like
    a token and all its tokens go down together, side by side on the grid, selected, and
    hidden from the players until you reveal them. `Ctrl+Z` takes the whole encounter
    back off. The pencil at the end of the tray opens the gallery on its encounters.
- **The tools**, in the upper right corner: select and move, select several, measure,
  draw, point. They fold away with the arrow at their end. Each has a key: `Q`, `W`, `E`, `R` and `T`, in that order. The pen draws lines,
  shapes and text: which of them is picked beside it. The GM's also has the map image, the name, the grid and the fog
  of war. A tool stays in hand until you click it again,
  take another or press `Esc`.
- **The table's dock**, in the upper left corner, under the date: one box with two
  tabs, a button each at its top. The hourglass is the **turn order**, and is the one
  that is open: see below. The heads are **who is at the table** now, each by name,
  with the GM marked. Click the tab that is lit and the box is put away, down to its two
  buttons. On a world map, which has no turn order, who is at the table stays a row of
  initials.

What is on a battle map:

- **A grid.** **Set up the grid** takes the size of one cell in pixels of the map image,
  and how far to shift the grid right and down to line it up. The dialog says how many
  cells that makes, to compare with the squares you count on the image. For an image that
  has its own grid drawn on, turn the lines off: tokens still snap to the cells. The same
  dialog says how many feet one cell stands for: 8 to begin with, and each map has its own.
  Quicker, for such an image: **Line it up on the map** in that dialog, then drag a box
  over a few of the image's squares, from corner to corner. Say how many squares the box
  is across and the grid that makes is drawn over the map to look at, tokens and all,
  before **Use this grid** keeps it. More squares in the box make a truer grid.
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
  it, locks it, marks it, gives it a number, duplicates it, opens its picture, colour and outline, and deletes it: a
  locked token can't be moved, resized or turned until someone unlocks it. Only the GM
  says who sees it, with the **Visibility** button: the whole table, or only the players
  picked in its dialog, which with nobody picked is the GM alone. `H` hides it from
  everyone or reveals it without opening the dialog.
- **Whose token it is.** A token a player puts down is their own. One of the GM's is
  nobody's, until the GM hands it to a player: **Whose token it is**, in the token's
  picture, colour and outline. Anyone still moves any token. Whose it is decides whose turn it is:
  when its turn comes, that player's screen says so, a phone that allows it shakes, the turn
  order reads **Your turn**, and the turn is theirs and the GM's to end. A player with a
  token on the map has one more tool in the corner, and the key `G`: it brings their token
  to the middle of the screen, selected.
- **A number.** The `#` button gives a token a number to carry, on its rim at the upper
  left: hit points, charges, rounds left. Type a number to set it, `+3` or `-5` to
  change it by that much, or nothing to take it off. With several tokens selected it
  goes on all of them, so `-8` is the fireball. Everyone at the table sees it and
  anyone changes it, unless you keep it.
- **A number only you see.** Beside the field the number is typed in, the GM has an eye:
  press it and the number is kept from the table, for a monster's hit points. It shows
  to you in gold in a broken ring. The players are sent the token without it, hear
  nothing when it changes, and can't set a number on that token themselves. A copy of
  the token keeps it kept.
- **Marks.** The marks button brings them out. **Down** greys the token and crosses it
  out. The rest are pips on the token's rim: six plain colours, and fourteen small
  icons, each in a colour of its own on a dark pip: a skull, a flame, a bolt, a drop, a
  snowflake, a shield, a heart, a star, an eye, a moon, an arrow down, an arrow up, a
  target and a net. What each means is the table's to say: red for bloodied, the drop
  for poisoned, the eye for whoever is concentrating, the arrow down for prone. Click
  one to put it on, again to take it off. A token wears as many as it is given, and
  with several tokens selected a mark goes on all of them.
- **The turn order.** It is run from its own tab of the dock in the upper left corner
  of the map, and from nowhere else. Until a fight starts the tab says so, and the GM has
  a **+** there: with tokens selected on the map, it puts them in the turn order, and so
  does `I`. A strip then runs down the tab for everyone: each
  token with its name, in the order it acts, the one whose turn it is ringed in gold, there and on the
  map. **Next turn**, or `N`, moves on, and coming round to the top again starts the
  next round. Ending a turn is the table's: a player has the same button and the same
  key, for the turn of their own token, which is how they say they are done, and for the
  turn of a token that is nobody's, if they can see it.
  Starting the fight is the GM's, and so is going back: **Back a turn**, or `Shift+N`,
  is for a turn ended by mistake, a second press of the button most of all. It goes
  back the way the fight came, over the top of the order into the round before, and
  from the first turn of all to the fight not yet started. The GM sorts the order by dragging a token up or down
  the strip, and the others make room as it goes. With the focus on one, `Alt` and the
  up or down arrow key does the same. Or by what they rolled: the die opens a box
  beside each token, `Enter` goes from one to the next, and **Sort** puts the highest
  first. Tokens that rolled the same keep the order they were in. A click on a token in
  the strip selects it on the map. The **+** at the top of the strip adds the tokens
  selected on the map to the end of the order, and when they are all in it already it is
  a **−** that takes them out: so a click on a token in the strip and then that button,
  or `I`, takes it out. **End the fight** empties the order,
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
- **A shape picks its targets.** While you drag a shape out, and while one is selected,
  the tokens whose middle is inside it wear a pale ring, on your screen only. A shape
  you have just drawn is selected, and its buttons have one more: **Select the tokens
  inside**. So a fireball is drag the circle, select what is inside, `#`, `-8`. Slide
  the shape and the rings follow.
- **Drawings.** With **Draw** in hand, and the line picked beside the
  tools, drag across the map to draw a line freehand in the colour you pick there. The
  pen stays in hand for the next line. Lines sit on the map under the tokens, and grow
  and shrink with it.
- **Drawn ahead of time, out of sight.** The GM hides a drawing, a shape or a text from
  the players like a token: select it and press `H`, or use its **Visibility** button
  to show it to some players only. A hidden one is faint on your map and not on theirs
  at all: the trap, the ambush, the wall of fire to come. Reveal it when it is sprung.
- **Text.** Out of the same pen again: with **Draw** in hand and **Draw text** picked
  beside the tools, click the map and type, then press `Enter`. The hand is back once
  it is written. Double-click a text of yours to reword it, whatever is in hand.
- **Selecting several.** With **Select several** in hand, drag a box: every token,
  drawing and text it touches is selected. `Shift`-click adds one or takes one out.
  Drag any of them and the rest come along, and the buttons act on all of them at once.
  `Delete` takes off the map what is yours to take off, and one `Ctrl+Z` brings it all back.
- **Fog of war.** The cloud among the GM's tools brings out more beside it. The cloud
  there covers the whole map, or once there is fog, lifts all of it. With the eye in
  hand, paint over what the players may see; with the crossed-out eye, over what to
  cover again. Under those two is what to paint with. The circle is a round brush, and
  the one you start out with: a ring under the pointer shows what it reaches, a press
  alone leaves a dab, and the slider sizes it, as do `[` and `]`, and the wheel with
  `Shift` held. The square is a brush with corners, sized the same way, for a room or
  a corridor: its sides stay level with the map's. Neither goes by the grid: the fog is
  where you put it. The GM sees through the fog, dimly.
  To the players it is solid, and what stands under it is not sent to them at all: see
  [Who can do what](#who-can-do-what). `Ctrl+Z` takes back each change to the fog.
- **Fog that follows the tokens.** Tick **The fog follows the tokens** in **Map
  Settings**, and say how far a token sees. The whole map is then under the fog to the
  players, but for a round patch around each token that is a player's: all of them
  together, so the party shares what it sees, and so does the table display. Move a
  token and the patch goes with it: where it was is under the fog again. A token of
  the GM's gives no sight until it is handed to a player. Tokens out of sight are not
  sent to the players at all. It knows nothing of walls: for the room behind a door,
  paint the fog over it by hand, which covers what it covers whatever the tokens see.
  You see through it all, dimly.
- **A ruler.** Dragging a token shows how many feet it has moved. **Measure a distance**
  measures between any two spots, and the table sees your ruler while you do. Distances
  are in feet or in metres, at the scale the map was set up with. A diagonal step
  counts as one cell, unless **Map Settings** says otherwise: every second one as two
  cells, or the true distance as the crow flies. Like the units, that is said once on
  the first map of a campaign, and again only on a map where it is different. Click
  instead of dragging and the ruler bends at each click, around the corner
  and down the corridor: see [At the table](#at-the-table).

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
| Drag with the middle button of a mouse | Move the map, whatever tool is in hand |
| Hover or tap a marker | Read it |
| Click a marker | Pin its card, with edit, move and delete if it's yours to change |
| The funnel in the bar under a world map | Choose which types of marker you see. It changes your view only |
| Double-click a region | Step into its map |
| Click a region, as the GM | Select it: the buttons that float over it enter, close or open, hide or reveal, share, rename and delete it |
| Double-click a bare spot | Start a note there, on a world map |
| Drag with a fog tool in hand, as the GM | Paint the fog away with the brush, round or square, or back again, on either kind of map |
| `Shift` and the wheel, with the fog's brush in hand | Make the brush smaller or bigger |
| Drag a token | Move it, if it isn't locked. It snaps to the grid, unless `Alt` is held |
| Drag a handle of a selected token | Turn it, 15 degrees at a time, or resize it, half a cell at a time |
| `Alt`-click, or a finger held on a spot | Ping: point the spot out to everyone looking at that map |
| The button held down, with the rings in hand | Point: everyone looking at that map sees where your pointer is until you let go |
| Drag a box with **Select multiple** in hand, on a world map | Select the markers in it together: drag one to move them all, and their buttons hide or delete them |
| A click with the ruler in hand | Start a ruler that bends at every click. Double-click ends it, `Backspace` takes a bend back |
| Click a token, a drawing or a text | Select it: its buttons float under it. `Shift`-click selects several |
| Double-click a text | Reword it, if it's yours |
| Breadcrumbs | Step back out |
| The names in the corner of a table display, or `Backspace` there | Step back out |

### On the keyboard

Every button has a key, and says which in its tooltip. `?` opens a sheet of them all,
and so does the keyboard at the top. In a text field, a letter is a letter. The keys are
kept in one table, `src/lib/client/keys.ts`, which the tooltips and the sheet read too:
change one there and it changes everywhere.

Anywhere on a map:

| | |
|---|---|
| `?` | The sheet of shortcuts |
| `Ctrl+K`, `/` | Find a map or a marker by name, and go there |
| `Ctrl+Z` | Undo what you did on the map you're looking at |
| `Ctrl+Shift+Z`, `Ctrl+Y` | Redo |
| `Esc` | Put the tool away, then let go of what is selected |
| `Delete`, `Backspace` | Take off the map what is selected, if it's yours to take off. A region asks first |
| `Ctrl+A` | Select everything: the tokens and drawings of a battle map, the markers of a world map |
| Arrow keys | Move the map. With tokens selected, walk them one cell |
| `+` `-` `0` | Zoom in, zoom out, fit the whole map |
| `Alt+↑` | Step back out to the map this one is on |
| `Shift+Q` | Exit the campaign, back to the list of yours. It asks first. **Exit** in the menu does the same |

On a battle map:

| | |
|---|---|
| `Q` `W` `E` `R` `T` | Select and move, select several, measure, draw, point |
| `1` to `5`, with the pen in hand | Draw a line, a circle, a cone, a box, text |
| `C`, `Shift+C`, with the pen in hand | The next colour, the one before |
| `A` | Put down a plain token |
| `G` | Go to your own token, if one of the tokens there is yours |
| `N` | End the turn and go on to the next. The GM always can, a player for their own token, and for one that is nobody's |
| `Shift+N` | Go back to the turn before, as the GM |
| `\` | Fold every palette away, or bring them back |
| `#` | Set up the grid, as the GM |
| `Shift+R`, `Shift+E` | Sort the turn order by what they rolled, end the fight, as the GM |

With tokens or drawings selected there:

| | |
|---|---|
| `L`, `F2` | Label the token, or reword the text |
| `C` | Its number: type `12`, `+3` or `-5` |
| `M` | Its marks |
| `K` | Lock it in place, or unlock it |
| `Ctrl+D` | Duplicate |
| `P` | Its picture, colour and outline |
| `Shift+W` | Select the tokens inside the shape |
| `I` | Put it in the turn order, or take it out, as the GM |
| `H`, `Shift+H` | Hide the token or drawing from the players or reveal it, open its visibility, as the GM |

On a world map:

| | |
|---|---|
| `W` `E` `T` | Select several markers, measure, point. `Q` or `Esc` puts the tool away |
| `N` | Add a note |
| `V` | Filter markers and regions |
| `M`, `R` | Add a world marker, draw a region, as the GM |
| `L`, `F2` | Edit the pinned marker, or rename the selected region |
| `G` | Move the pinned marker |
| `Enter` | Enter the selected region, as the GM |
| `K` | Close the selected region to players, or open it, as the GM |
| `H`, `Shift+H` | Hide the marker or region from the players or reveal it, open its visibility, as the GM |

The GM's, on either kind of map:

| | |
|---|---|
| `F` | Take up the fog |
| `X`, with the fog in hand | Swap between clearing and covering |
| `S`, with the fog in hand | Swap the round brush and the square one |
| `[` and `]`, with the fog in hand | Make the brush smaller or bigger |
| `Shift+F`, with the fog in hand | Cover the whole map, or lift all the fog |
| `Shift+S` `Shift+G` `Shift+I` `Shift+P` `Shift+D` | Map settings, the gallery, the invite, the seats, the table display |

Nobody's mouse shows on anyone else's map as it wanders. What the table sees of the
others is what they have in hand, a token being dragged or a ruler, the spots they
ping, and where they point while they hold the button down with the pointing tool.

It works on a phone too: a tap is a click and a double-tap a double-click, and the tools
sit in a bar along the bottom of the screen. On a battle map that bar is the dock,
and the tools are in the corner.

## Who can do what

| | GM | Player |
|---|---|---|
| World markers, on world maps | create, edit, give a picture, hide, reveal, show to some players, delete | read, picture and all (never the hidden ones they are not let in on, nor the ones under the fog) |
| Table notes, on world maps | create, edit, delete, anyone's | create, edit anyone's, delete their own |
| Maps, regions | create, edit, hide, reveal, show to some players, close, open, delete | read (never the hidden ones they are not let in on), step into the ones that are open |
| The gallery | add, rename, reveal, hide, take out, lay an image under a map | look through what the GM has revealed, pick one of those for a token |
| Encounters | make, fill, rename, throw away, put down on a battle map | nothing: they see the tokens once the GM reveals them |
| Battle maps and grids | make one behind a new region, set up the grid | read |
| The scale of a world map | say how many miles across it is | measure, once a map on the way has one |
| Units, and how a diagonal is counted | say, for a map and the maps inside it | read distances that way |
| A ping, and the finder | point a spot out, go to anything | point a spot out, go to anything not hidden |
| A picture for the table | hold any picture up, for everyone or for some players, put it away | look, if it is held up for them, and close it on their own screen |
| The date in the world | write it, change it, clear it | read |
| The turn order, on battle maps | add tokens, sort by dragging or by rolls, start the fight, next turn, back a turn, end the fight | see whose turn it is, among the tokens they can see, and end the turn of their own token, or of one that is nobody's |
| Fog of war, on battle maps | cover, clear, lift, see through, make it follow the tokens | see what has been cleared, and where it follows the tokens, what the players' tokens see |
| Fog on a world map | cover the map or a part of it, clear a part, lift it, see through | see what has been cleared |
| A seat at the table | make one, rename its player, take it away, let in whoever asks for one, or not | ask for one of the seats on the invite link, by picking their name |
| The invite | while a seat is free: show it as a code to scan, on their screen or on the table display, and copy the link | |
| A campaign in one file | export the ones they run, import one as a new campaign | |
| Tokens | create anywhere, give any picture, hide, reveal, show to some players, hand to a player | create where there is no fog, give a revealed picture: what they put down is their own |
| Any token they can see | move, resize, turn, recolour, outline, label, mark, number, lock, unlock, duplicate, delete | move, resize, turn, recolour, outline, label, mark, number, lock, unlock, duplicate, delete |
| A token's number, kept | keep it from the table, see it, change it, show it again | nothing: they are sent the token without it |
| Drawings, text and shapes, on battle maps | create, move, change, rub out, anyone's, hide, reveal, show to some players | create, and move, change, rub out their own (never a hidden one they are not let in on) |
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
in there. A player who is inside when the GM hides it is walked back out. A closed region
keeps its map from them the same way, and so does a region that the fog of a world map
still covers. Only the region itself, and its name, stay in sight.

What is hidden from the table and shown to some players is filtered per person, not per
role: the page a player loads, the events their browser receives and what they can act
on by its id are all worked out for that one player. A table display is nobody in
particular, and is sent only what every player may see.

## How it's put together

```
src/lib/shared/     types and permission rules, used by both servers and the browser
src/lib/client/     the browser's side: the live connection, the map's state, undo
  stage.svelte.ts     how a map lies on the screen, and how it is panned and zoomed
  tools/              one module for each tool of the map, with what it is in the middle of
src/lib/server/     database, sessions, and the modules that matter most:
  schema.ts           the tables, as a Drizzle schema
  world.ts            every change: validate, check permission, write, log an event
  gallery.ts          the campaign's pictures, and who may load which
  encounters.ts       tokens made ahead of time, to put down together
  visibility.ts       the only path from the event log to a client, filtered by who it is
  archive.ts, tar.ts  a campaign out to one file and back in, as a stream
  db.ts, drivers/     where the database is kept: one driver per kind of place
  storage.ts          where the pictures are kept, behind one small interface
drizzle/            SQL migrations generated from schema.ts
src/routes/         the SvelteKit app: pages, plus HTTP endpoints for the gallery, its
                    pictures and a command fallback
src/lib/components/ the map canvas and the pieces it is made of, marker cards, forms
ws/server.ts        the WebSocket server: a bridge between browsers and the app
scripts/            run both servers, seed a demo, end-to-end check
```

- **One server owns the database.** Only the SvelteKit app opens it. The WebSocket server
  is a bridge with no data of its own: it forwards what browsers send it to the app, and
  delivers what the app tells it to.
- **One rules module.** Every command ends in `world.ts`: the app calls `performReceived()`
  with the actor it authenticated and the raw command it received. Permission checks and
  writes live there and nowhere else. `perform()` is the same for a command written in the
  code itself, by a test or the seed script: it takes a `Command`, so the compiler checks it.
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
- **What someone is sent hangs on who they are.** Everything on the read side takes a
  viewer: a role, and for a player, their user id. A bare `'player'` is nobody in
  particular, which is what a table display is. After a change the app works out what
  the GM is owed, what the table is, and for each player of the campaign what they
  are. Only where a player's differs from the table's is it handed over by name, and
  the WebSocket server then sends each of that campaign's sockets its own. So a secret
  shared with one player reaches their socket and no other, and a secret taken back
  reaches them as a deletion.
- **Fog is one thing on either kind of map.** It is one value on the map, changed with
  `map.update`: on or off, and the marks made on it by hand, in the order they were
  made. A mark is where a brush swept, round or square: the spots it went through and
  how far it reaches. Each one clears or covers, and a spot is under the fog or not by
  the last mark that holds it: `shared/fog.ts` has the arithmetic. The browser draws
  the same list through a mask, black where a mark cleared and white where one covered,
  a round sweep as a line as wide as the brush, a square one as the outline of what it
  went over, filled. Fog from before there was a brush is a list of cleared boxes, which
  is still what the marks are made over, and a mark from when the square dragged a box
  is a box still. The same tools and the
  same buttons work it on a battle map and on a world map. What differs is what the fog
  keeps from players: tokens on a battle map, world markers and regions on a world map.
- **Ending a turn is a command of its own.** Changing a map is the GM's, and the turn
  order is part of its map. `turn.next` is the one thing about it that a player may
  ask for: the server works out whose turn comes next, and the command names the turn
  it ends, so two people pressing at once move on once. `turn.back` is its other way
  round, and the GM's alone.
- **A campaign in one file is read as it arrives.** Export and import are streams: a
  tar archive is written a picture at a time and read the same way, so a campaign with
  big map images never has to fit in memory whole. An imported file is not trusted:
  every value in it is checked like a command's would be, every picture is read as a
  picture, and a file that fails leaves nothing behind. Only the import endpoint takes
  a body bigger than a map image: see `src/hooks.server.ts`.
- **A seat is asked for, and given by the GM.** Whoever asks for a seat on the invite
  link, one nobody has sat in or one that is taken, makes a row in `seat_claims`, and
  is handed a cookie whose hash is kept with it. The row holds the user whose seat is
  asked for: nobody makes a user by asking. The app tells the WebSocket server who is
  asking, and that goes to the GM's sockets and no others. The GM's answer is written
  on the row. The browser that asked looks for it every two seconds, and it is a yes
  read there that logs it in as the player. That uses the row up: `seats.ts`. Nothing
  about it is an event, and there is no undo.
- **The app asks who is at the table.** Who is connected is known to the WebSocket
  server alone, and it is the one thing the app asks it: `/online`, behind the same
  secret as `/publish`, read by `onlineAt` in `bridge.ts`. A seat whose player is
  among them is not offered, not asked for and not given: `knock` and `answerKnock`
  in `seats.ts` are handed the answer. If the WebSocket server can't be reached,
  nobody is at the table through it, and the answer is nobody. The yes that seats a
  browser deletes the seat's other logins, and has any socket still on one shown out.
- **A seat is free while no browser is logged in as its player.** That is read off the
  `sessions` table, never stored: `freeSeats` in `seats.ts`. The invite dialog counts
  the free seats each time it opens, and a table display asked for the invite is handed
  one only while there is a free seat. The link itself goes on working, for whoever
  sat here before and has to get back in.
- **What is new is the browser's to know.** Which markers and regions someone has looked
  at is kept in that browser, per campaign and per person, a list of ids for each map:
  `client/discoveries.svelte.ts`. What is on a map and not in the list glints. The server
  keeps nothing about it, and is asked nothing.
- **A day's travel is worked out like the scale.** A world map with no pace of its own
  goes by the nearest map further out that has one, and with none on the way by 24 miles
  a day: `dayMilesOf` in `queries.ts`. It is set with `map.update`, so it has undo.
- **Whose token it is, is on the token.** The id of a player and what they are called,
  sent to everyone who can see the token. The one rule that reads it is `canEndTurn` in
  `shared/rules.ts`. Moving a token asks nothing of it.
- **The invite is made out to where phones can reach.** The app tells the GM's browser
  which addresses the machine has on its networks: `server/network.ts`. A browser on
  `localhost` makes the link and the code out to one of those: `client/invite.ts`.
- **Pings skip the app.** A ping goes from browser to browser through the WebSocket
  server alone. It isn't a change to the world, so it is never stored. Where a mouse is
  otherwise is not sent to anyone.
- **So does a token in someone's hand.** While a token is dragged, where it is goes the
  same way, and so does a ruler, and so does the spot someone is pointing at with the
  pointing tool, for as long as their button is down: about twenty times a second, and
  not at all once it is let go. Nothing is sent while a hand is empty. Only letting go
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
  the handles that reshape a token. Which tokens one catches is worked out in the
  browser, from the tokens it has: `templateHolds` asks whether a token's middle is
  inside. Nothing about it is sent or stored.
- **A kept number never leaves the app for a player.** A token has `countHidden`, the
  GM's to set. Every token on its way to a player goes through `tokenForEyes` in
  `shared/rules.ts`, which takes the number off and says nothing is kept. An event
  that changes only what a player isn't sent is not sent to them at all:
  `visibility.ts`. A player's `count` on such a token is refused whatever it is, so a
  right guess can't be told from a wrong one.
- **An encounter is rows of its own.** The table is still called `token_groups`, from
  when encounters were groups saved off a map: the rows are the same, so nothing was
  migrated. It keeps, for each encounter, what each token starts out as and where it
  stands from the middle of the encounter, in cells: `server/encounters.ts`, behind
  `/c/<campaign>/encounters`. Where each token stands is worked out on the server
  whenever the encounter's tokens change, by `arrangeInCells` in `shared/grid.ts`:
  rows of whole cells, so that once the first token sits squarely on a grid they all
  do. Putting one down is a batch of `token.create` from the browser, like any other
  change to a map. Like the gallery it is no part of the event log. A picture taken out
  of the gallery is kept for as long as an encounter has a token that wears it.
  Encounters go into a campaign's file and come back out of it, and a file from before
  them brings its saved groups in as encounters. The server can still make an encounter
  of tokens that stand on a map, keeping their places (`encounterFromMap`, `from` in a
  `POST`): the browser has no button for it.
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
- **A browser that was asleep asks whether it is still connected.** A phone that was
  locked may hold a socket that died without a word. When its page is looked at again
  after more than a few seconds away, it asks the WebSocket server to say it is there.
  An answer means the connection is good and nothing was missed. With none in a couple
  of seconds the socket is made anew, and the server's hello says whether the map has
  to be loaded again. A connection that was waiting to try again tries at once.
- **The map canvas is a dispatcher.** `MapCanvas.svelte` looks at each press, drag and
  release and hands it to the tool whose it is: `Carry` for what is picked up, the
  ruler, the pen, the handles of a token, the fog's brush, the outline of a region,
  the pointing tool. Each is a class under `src/lib/client/tools` that keeps what it is
  in the middle of. They are all given the same `Board`: the map as it stands now, what
  is selected, and the way to ask the server for a change. What is drawn is in
  components of its own: the picture and its tiles, the tokens, the pins, the fog, the
  ink, and in `MapOverlays.svelte`, what floats over the map.
- **What is in hand is the page's to keep.** Which tool is out, on either kind of map,
  is a `Toolbelt`: `src/lib/client/toolbelt.svelte.ts`. Taking one up puts the last one
  away, and the map canvas is told the one tool it is to act as.
- **Fog that follows the tokens is worked out, not kept.** A battle map has `sight`: how
  many feet a player's token sees, or nothing. What the players may see is then worked
  out from where their tokens stand, each time it is asked: `sightOf` in
  `shared/fog.ts`, and `canSeeToken` takes it beside the fog laid by hand. So moving a
  token is all it takes to move the fog. When one of the players' tokens moves, comes
  or goes, or changes hands, the event that says so carries every token the players
  can see now, in place of what they had: `visibility.ts`. The browser cuts the same
  round patches out of a dark sheet, around the tokens as they are drawn, in a hand or
  standing.
- **Feet and miles are what is kept.** A map says what distances are told in and how a
  diagonal step is counted, or says nothing and goes by the maps further out. The
  server sends each map what the maps outside it say, and the map's own word is on the
  map: `unitsOf` and `diagonalOf` in `queries.ts`. Metres and kilometres are a way of
  telling the feet and miles that are stored: `shared/grid.ts` goes between them, and
  counts the cells of a diagonal.
- **A hidden drawing is filtered like a hidden token.** `canSeeDrawing` in
  `shared/rules.ts`: the page a player loads, the events they are sent and what they
  can act on by its id all leave it out, but for the players it is a secret with.
- **A seat is a user with no password.** The GM's **Seats** dialog makes one, renames
  it and takes it away: `seats.ts`, behind `/c/<campaign>/seats`. None of it is an
  event. Taking a seat away hands its tokens back to nobody first, which is one, so
  that the table hears of it. The app then tells the WebSocket server, which shows
  that player's browsers out.

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

Type-checks everything, then runs the unit tests. Bun runs a test without checking its
types, so the check comes first: a test that names a marker type that is no more, or
misspells a field of a command, stops here instead of failing later for a reason that is
hard to read. A test that sends a wrong command on purpose says so, with
`performReceived()`. `bun test src` runs the tests alone.

Unit tests for the rules: permissions, hidden markers and regions, battle maps, tokens
and drawings, the fog of war and what it keeps from players, maps that
borrow their picture, the grid's arithmetic, undo and restore, campaign isolation, and the storage, on disk and off.
And for what a session is run with: marks, the turn order and what a player sees of it,
shapes, the scale of a world map, the finder, a picture held
up for the table, and what a token picture starts its tokens out as.
And for what is kept from some and not from others: closed regions, secrets shared with
some players and what each of them is sent, and the fog of a world map. And the number on a token, one the GM keeps, shapes that pick their targets,
encounters and how their tokens are stood side by side, initiative rolls, ending a turn, lining up a grid,
and a campaign going out to a file and coming back.
And for what a real session leans on: a seat asked for and given, free or asked back, whose token is
whose and whose turn that makes it, a picture on a marker and who may load it, how long
the way takes, a ruler with bends in it, the fog of a world map cleared and covered by
hand, and the address an invite is made out to.
And for what came after the first sessions were planned: fog that follows the tokens and
what it sends the players as they move, drawings the GM keeps out of sight, metres and
the ways of counting a diagonal, the finder reading what a marker says, and the seats
the GM makes, renames and takes away.

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
- Nobody sits down while the GM is away: every seat, free or asked back, is the GM's to
  give, from a map they have open. See [Getting to the table](#getting-to-the-table). At
  most eight people wait at once, and one per seat: a second asking for the same name
  takes the place of the first.
- A player is a browser cookie. A browser that has lost it gets the seat back by asking
  for it on the invite link. A browser holds one login, and a seat one browser: someone
  who plays in two campaigns from the same browser, or in one campaign from two
  devices, asks for their seat again each time they change.
- A player counts as at the table while a map is open in their browser and connected.
  A phone that has gone to sleep is not, and its seat can be asked for: it is still the
  GM who says yes.
- A seat counts as taken for as long as a browser is logged in as its player, which is
  up to 180 days after they last sat down, whether or not they are at the table. With
  every seat taken **Invite** has nothing to share. Someone coming back uses the link
  they were sent before.
- Taking a seat away can't be undone. A change from before it that named that player,
  a secret shared with them or a token handed to them, can no longer be taken back with
  `Ctrl+Z`. A new name for a player shows on other screens the next time they load a map.
- The seats offered on the invite link are every player with no account, by name: anyone
  with the link can read who plays, and which seats are taken. A seat is only given by
  the GM, who has nothing but the name to go by: it is for a table where the GM can see
  who is asking.
- The code for the table display is put there through the browser: **Show the code**
  turns the page of a display window opened from the same browser. A display on another
  device shows it with `&invite` on the end of its address.
- What someone has looked at is kept in their browser. On another device, or with its
  storage cleared, every map starts over: nothing glints there until something new
  comes. A table note someone else adds doesn't glint, and nothing glints for the GM.
- The card of a marker shows its picture small. It can't be opened larger from there by
  a player: the GM holds it up for the table. A table note carries no picture.
- A secret is shared with players one thing at a time: there are no groups of players,
  and no list of everything one player has been let in on.
- A closed region shows its name. For one the players should not be able to name yet,
  call it something else until it opens.
- The fog of a world map is cleared and covered by hand, with a brush, like
  a battle map's. It doesn't lift by itself as the story moves on. Turning the fog off
  forgets what was cleared, though undo brings that back.
- A map keeps at most 400 marks on its fog, one for each sweep of the brush. Covering
  or lifting the whole map forgets them all: when a map gets there, the next mark is
  refused until the whole map is covered again.
- The brush is sized against the map and not the screen: zoomed in, its outline is
  bigger. The square brush can't be turned: its sides are level with the map's.
- On a world map the fog keeps markers and regions from the players, not the picture of
  the map, which their browser still loads and draws the fog over. A region is under
  the fog or not by its middle.
- A token carries one number. It is the whole table's or the GM's alone: there are not
  two, one of each. A player who tries to set a number on a token whose number is kept
  is told the GM keeps it, which says that there is one.
- A campaign's file leaves out who plays in it, their secrets and the history that undo
  works from. Importing always makes a new campaign: it can't be merged into one that
  is there.
- Undo remembers what you did since you opened the map. It is forgotten when you step
  into another map or reload the page.
- Undo can't put back a map image, or a token's picture, that has since been taken out
  of the gallery and removed from disk.
- A player can't add a picture of their own to the gallery. They send it to the GM,
  who adds it and reveals it.
- Pictures are revealed in the gallery one at a time, and to the whole table: not to one player only.
- A token picture remembers a size and an outline for its tokens, and nothing else: not
  a colour, a name of its own for them, or marks.
- One picture is held up at a time. It is shown whole, and can't be zoomed into.
- Undoing the drawing of a region only works while the map behind it is still empty.
  After that the region has to be deleted with its own button, which asks first.
- A ping shows where it lands on the map. Someone looking at another part of that map
  is not turned towards it, and someone on another map is not told.
- A ping, a ruler and a token in someone's hand are passed to every browser in the
  campaign, each of which shows only what is on the map it is on. A player who inspects
  their network traffic can see that the GM pinged or measured on a map they can't
  open, though nothing of what is there.
- A token has one owner or none. The turn of one that is nobody's, which is most of the
  GM's, can be ended by any player who sees it. Whose a token is doesn't decide who may
  move it or change it: anyone still can. Rolls are typed in by the GM, and only the GM
  sees them.
- A mark is a colour or an icon from a fixed set. It has no name of its own, no number
  on it, and no timer that takes it off again. Icons are small: on a token that is
  small on screen they are told apart by their colours until the map is zoomed in.
- A shape catches a token by its middle, however big the token is. Only the person
  with the shape selected sees which tokens it catches. It can't be
  resized or turned once drawn: draw another. There is no straight line among the
  shapes: a thin box does for one along the grid.
- A world map is measured in miles. It knows nothing of roads: the ruler follows one
  only as far as you click along it. How long the way takes is the miles over one pace,
  the same over hills and by sea. A ruler laid by clicks is not kept: it is gone when
  the tool is put away, or the page reloaded.
- The finder searches the names of maps and markers, and what a marker's card says: not
  tokens, and not what is written on a battle map.
- The fog a GM paints on a battle map is cleared and covered by hand, with a brush. The
  fog that follows the tokens knows nothing of walls: a token sees the same distance
  every way, through anything. Every token of a player sees as far as every other, and
  the players all see what any of them does: there is no sight for one player alone.
  It remembers nothing: there is no map of where the party has been.
- Where the fog follows the tokens, a player's token can be put down or moved
  anywhere, and sees around itself where it lands. A token that is nobody's and is
  moved out of sight by a player is gone from their map until the party sees it again.
- The fog keeps tokens from the players, not the picture of the map: their browser
  still loads the whole image, and draws the fog over it. Drawings and text under the
  fog are sent to players as well, and covered the same way.
- A token is under the fog or not by its middle. A big one at the edge of the clear
  shows with part of it covered.
- A table display letters names larger, and that is all it does for a far-away screen:
  tokens and pins are the size they are for everyone.
- The pen draws freehand lines in one thickness, and text is one size: no eraser that
  rubs out part of a line. Only the GM hides a drawing: a player's are in plain sight.
- A token's label is its name: it can be changed by anyone, but not left empty.
- A token is half a cell to six cells across, and turns in steps of 15 degrees.
- A player sees a newly revealed token picture in the dock the next time they reach for
  it, not the moment the GM reveals it.
- The grid is square. Lining it up by a box is as true as the box: over one small
  square it can be a pixel or two out, which adds up across a big map.
- Where every second diagonal step counts as two, the ruler starts the count over at
  each bend. A shape is sized as the crow flies, whatever a diagonal counts as.
- Metres and kilometres are worked out from feet and miles by round numbers, 1.5 m to
  five feet and 1.5 km to the mile: a map that is really to a metric scale is a little
  out if its scale is read off in miles.
- A player on a battle map when the units or the diagonal are changed on a map further
  out reads the new ones the next time they load the map.
- The way into a battle map is a region. A marker can't lead to one.
- A battle map holds no markers, notes or regions.
- A map stays the kind it was made as. A world map can't be turned into a battle map, or
  a battle map into a world map: draw a new region for the other kind.
