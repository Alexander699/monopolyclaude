# Global Economic Wars - Project Documentation

## Overview
A browser-based multiplayer board game inspired by property trading games (Monopoly-style) but with unique mechanics centered around countries and global economics. Players compete as global investors to build economic empires. Supports two map variants: a Classic 11x11 board (40 spaces) and an expanded World Domination 13x13 board (48 spaces).

## Project Structure
```
Online Monopoly/
├── index.html              # Entry point, loads Socket.IO CDN and modules
├── claude.md               # This documentation file
├── css/
│   └── styles.css          # Complete styling (~1900 lines, dark diplomatic theme)
├── js/
│   ├── gameData.js         # Board configuration, cards, alliances, maps, constants
│   ├── gameEngine.js       # Core game logic, state management, rules
│   ├── ui.js               # UI rendering, event handling, animations
│   ├── soundManager.js     # Web Audio API sound effects
│   └── network.js          # Socket.IO multiplayer client
└── server/
    ├── package.json        # Node.js dependencies (express, socket.io, cors)
    └── index.js            # Socket.IO relay server (deploys to Render.com)
```

## How to Run Locally
```bash
# 1. Start the relay server
cd server && npm install && node index.js
# Server runs on http://localhost:3000

# 2. In another terminal, serve the client
python -m http.server 8080
# Then open http://localhost:8080

# 3. For multiplayer testing: open two tabs in the same browser
```

## Deployment
- **Client**: GitHub Pages at https://alexander699.github.io/monopolyclaude/
- **Server**: Render.com (free tier) at https://monopolyclaude.onrender.com
- `SERVER_URL` in `js/network.js` auto-detects: localhost:3000 (dev) vs Render URL (prod)
- Render free tier sleeps after 15min inactivity; first connection takes ~30s to wake

## Multiplayer Architecture

### Socket.IO Relay Model
The server does **zero game logic** — it's a pure message relay.
```
Client Action → Socket.IO Server → Relays to Host
Host processes in GameEngine → Broadcasts state → Server relays to all Clients
```

### Host-as-Authority
- **Host** runs the `GameEngine`, processes ALL actions, broadcasts state changes
- **Clients** send actions via `network.sendAction()` → server relays to host
- **Host** receives actions via `game-action` event → `handleRemoteAction()` dispatches to engine
- Engine emits → host callback calls `network.broadcastState()` → server relays to all clients

### Socket.IO Events
| Event | Direction | Purpose |
|-------|-----------|---------|
| `create-room` | Client→Server | Host creates a room (includes persistent `clientId`) |
| `room-created` | Server→Client | Returns room code |
| `join-room` | Client→Server | Client joins/rejoins with code+name+`clientId` |
| `joined` | Server→Client | Confirms join/rejoin with player list |
| `player-joined/left` | Server→All | Player list updates |
| `start-game` | Host→Server→Clients | Sends initial game state to each client |
| `game-action` | Client→Server→Host | Client action relayed to host |
| `state-update` | Host→Server→Clients | Host broadcasts state changes |
| `animation` | Host→Server→Clients | Host relays movement animation events so clients animate tokens |
| `global-news` | Host→Server→Clients | Global News card shown to all |
| `chat` | Any→Server→Others | Chat messages |
| `player-connection` | Server→Host | Notifies host when a client disconnects/reconnects |
| `kick-player` | Host→Server | Host removes a player by `playerId` |
| `player-kicked` | Server→Host | Confirms player kick to host |
| `kicked` | Server→Client | Notifies kicked client and terminates session |
| `error-msg` | Server→Client | Error notifications |

### Key Patterns in ui.js
- `isOnlineClient()` — returns true when playing online as non-host
- `handleRemoteAction(data)` — host dispatches client actions to engine
- All action handlers check `isOnlineClient()` → call `network.sendAction()` instead of engine directly
- Card decks stripped from network payloads (`stripCardDecks()`) to reduce message size
- Start Game button double-checks both `lobbyIsHost` and `network.isHost`

## Map System

### Map Selection
Players choose a map in the lobby before starting the game. The map selection UI appears between the game panels and the rules footer, showing clickable cards for each map variant.

- **State variable**: `selectedMapId` in ui.js (defaults to `'classic'`)
- **Map registry**: `MAPS` object in gameData.js defines all available maps
- **Host selects map**: In online mode, the host's map selection is used when `network.startGame(selectedMapId)` is called
- **Map metadata in game state**: `state.mapId`, `state.totalSpaces`, `state.corners`, `state.gridSize` are stored in the game state and used by all dynamic logic

### Map Registry (gameData.js → `MAPS`)
```javascript
MAPS = {
  classic: {
    id: 'classic', name: 'Classic',
    description: '40 spaces · 22 countries · 8 alliances',
    board: BOARD, gridSize: 11, totalSpaces: 40,
    corners: [0, 10, 20, 30]
  },
  expanded: {
    id: 'expanded', name: 'World Domination',
    description: '48 spaces · 30 countries · 10 alliances',
    board: BOARD_EXPANDED, gridSize: 13, totalSpaces: 48,
    corners: [0, 12, 24, 36]
  }
}
```

### Dynamic Board Rendering
All board logic is now driven by `state.gridSize`, `state.totalSpaces`, and `state.corners` rather than hardcoded values:
- **`getSpacePosition(id)`** — computes {row, col} dynamically based on `gridSize` (works for any NxN board)
- **`renderBoard()`** — loops over `state.board.length`, uses `state.corners` for corner detection and side assignment
- **CSS** — `.board` class renders 11x11 (classic), `.board.board-13` class overrides to 13x13 (expanded)
- **Movement wrapping** — `% state.totalSpaces` instead of `% 40`
- **Sanctions position** — `state.corners[1]` instead of hardcoded `10`

### Classic Board Layout (40 spaces, 11x11 grid)
```
Bottom (0-10):  GO → Moldova → DiploCable → Armenia → Tariff → Maritime → Ukraine → GlobalNews → Nigeria → Kenya → Sanctions
Left (11-20):   Egypt → Internet → SouthAfrica → India → Rail → Bangladesh → DiploCable → SriLanka → Nepal → FreeTrade
Top (21-30):    France → GlobalNews → Germany → UK → AirRoutes → Japan → SouthKorea → Shipping → China → Incident
Right (31-39):  Brazil → Singapore → DiploCable → SaudiArabia → Digital → Canada → UAE → LuxuryTax → USA
```

### Expanded Board Layout (48 spaces, 13x13 grid)
```
Bottom (0-12):  GO → Moldova → DiploCable → Armenia → Tariff → Maritime → Ukraine → GlobalNews → Nigeria → Kenya → Mexico → Fiji → Sanctions
Left (13-24):   Egypt → Internet → SouthAfrica → India → Rail → Bangladesh → DiploCable → SriLanka → Nepal → Norway → Sweden → FreeTrade
Top (25-36):    France → GlobalNews → Germany → UK → AirRoutes → Japan → SouthKorea → Shipping → China → Indonesia → PapuaNewGuinea → Incident
Right (37-47):  Brazil → Singapore → DiploCable → SaudiArabia → Digital → Canada → UAE → Finland → NewZealand → LuxuryTax → USA
```

New countries in expanded: Mexico (AMERICAS), Fiji (PACIFIC_ISLANDS), Norway (NORDIC), Sweden (NORDIC), Indonesia (SOUTH_ASIAN), Papua New Guinea (PACIFIC_ISLANDS), Finland (NORDIC), New Zealand (PACIFIC_ISLANDS)

## Game Mechanics

### Victory Conditions
1. **Influence Victory**: First to reach 1000 Influence Points
2. **Last Standing**: Be the last solvent player

### Alliances & Their Bonuses
Own ALL countries in an alliance to unlock the bonus (like Monopoly color sets).
Must complete an alliance before developing (building) on any of its countries.

| Alliance | Countries | Completion Bonus |
|----------|-----------|------------------|
| EASTERN | Moldova, Armenia, Ukraine | +50 influence/turn |
| AFRICAN_RISING | Nigeria, Kenya, Egypt | $250 tourism income/turn |
| SOUTH_ASIAN | India, Bangladesh, Sri Lanka, Nepal (+Indonesia on expanded) | +$200 on all rent collected |
| BRICS | South Africa, China, Brazil | +100 influence per rent payment |
| EU | France, Germany, UK | Double rent on developed properties |
| ASIAN_TIGERS | Japan, South Korea, Singapore | Tech Hub costs -50% |
| OIL_NATIONS | Saudi Arabia, UAE | $300 oil royalties/turn |
| AMERICAS | Canada, USA (+Mexico on expanded) | Free development upgrade/round |
| PACIFIC_ISLANDS | Fiji, Papua New Guinea, New Zealand | $200 tourism boost/turn |
| NORDIC | Norway, Sweden, Finland | +75 influence/turn |

**Note:** PACIFIC_ISLANDS and NORDIC alliances only appear on the expanded "World Domination" map. AMERICAS and SOUTH_ASIAN gain extra members on the expanded map.

### Development Tiers (replaces houses/hotels)
1. **Local Markets** (🏪) - Cost: 50% of price, 2x rent
2. **Factories** (🏭) - Cost: 75% of price, 3x rent
3. **Tech Hubs** (🏙️) - Cost: 100% of price, 5x rent
4. **Economic Capital** (🏛️) - Cost: 150% of price, 8x rent (max 1 per alliance)

### Resources
Countries produce: oil, tech, agriculture, tourism
- Owning diverse resources grants +5% rent per unique type

### Special Mechanics
- **Influence Actions**: Spend influence for Trade Embargo (200), Summit Meeting (150), Dev Grant (100)
- **Card Decks**: Global News (shown to ALL players) and Diplomatic Cables (personal, shown only to drawer)
- **Trade Sanctions**: Like jail - roll doubles, pay $500, or use Diplomatic Immunity card
- **Trade System**: Propose trades to other players; recipients see glowing notification badge

### Key Constants (in gameData.js)
- Starting Money: $15,000
- GO Salary: $2,000 + bonuses
- Sanctions Bail: $500
- Influence to Win: 1,000

## UI Features

### Center Board Controls
The main action buttons are displayed in the center of the board, below the dice display, making them the focal point of gameplay:
- **Roll Dice / Roll for Doubles** button — appears during `pre-roll` phase
- **Buy / Decline** buttons — appear during `action` phase when landing on an unowned property
- **End Turn** button — appears during `end-turn` phase
- **Waiting message** — shown to non-active players ("Waiting for [name]...")
- **Recent Activity** — scrollable mini-log (up to 20 entries) shown below the action buttons
- Bail and Immunity buttons remain in the right-side action panel
- Keyboard shortcuts (Space/Enter) still trigger roll/end-turn handlers

### Space Info Modal
Clicking any board cell opens an info modal displaying detailed information:
- **Countries**: price, alliance, resource, full rent schedule (all 5 development tiers), current development level, owner, mortgage status, and alliance completion bonus
- **Transports**: price, rent by number owned (1-4), owner
- **Infrastructure**: price, rent formula (4x/10x dice roll), owner
- **Tax spaces**: tax amount
- **Card spaces**: description of what the card deck does
- **Corner/special spaces**: description (GO salary, jail rules, etc.)
- Modal has a colored header matching the alliance color, with flag/icon and space name
- Closes by clicking X button, clicking outside the modal, or pressing the overlay

### CSS Classes for Space Info Modal
- `.space-info-modal` — modal container with dark theme
- `.sinfo-header` — colored header with flag, name, close button
- `.sinfo-body` — content area
- `.sinfo-row` — key-value row (label + value)
- `.sinfo-divider` — horizontal separator
- `.sinfo-label` — section label (uppercase, muted)
- `.sinfo-bonus` — alliance bonus text (gold, italic)
- `.sinfo-desc` — description text for non-country spaces

## Customizing Player Avatars
Player avatars are defined in `js/gameData.js` in the `PLAYER_AVATARS` array. Each entry is:
```javascript
{ emoji: '🧳', img: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=player1' }
```

**To use custom icons:**
1. Place your image files in an `assets/avatars/` directory (or any path)
2. Edit `PLAYER_AVATARS` in `gameData.js`
3. Replace the `img` URL with your file path, e.g.: `img: 'assets/avatars/my-icon.png'`
4. Images should be square (64x64 or 128x128 recommended). Formats: png, jpg, svg, webp
5. The `emoji` field is used as fallback if the image fails to load

## Recent Changes (Latest First)

### v1.6 - UI Layout Overhaul, Board Center Expansion & Trade Cancel (Current)
- **Side panels widened:** desktop panel vars increased (`--panel-left-w: 280px`, `--panel-right-w: 320px`; 1200px breakpoint: 230px/260px) so panels nearly touch the board, eliminating wasted space and fixing text overflow issues.
- **Buy/Decline buttons moved to board center:** `renderCenterActionButton()` now handles the `action` phase, rendering Buy and Decline buttons centrally below the dice (same location as Roll Dice / End Turn). Removed from right-side action panel; space detail card remains in the panel.
- **City flags enlarged:** `.space-flag` font-size bumped to `clamp(22px, 0.5*cell, 36px)` and `.country-flag-img` width to `clamp(28px, 0.62*cell, 48px)` for better visibility.
- **Recent Activity moved to board center:** mini-log removed from right-side action panel and rendered in the board center area below the action buttons, with a "Recent Activity" header.
- **Recent Activity scrollable history:** center mini-log now shows up to 20 entries in a scrollable container (`max-height: 120px`) with thin custom scrollbar, and messages word-wrap instead of truncating with ellipsis.
- **Board center glow effect:** `.board-center` now has a subtle blue radial glow via `::before` pseudo-element and multi-layer `box-shadow` for a polished ambient light effect.
- **Wealth indicator removed:** removed the "Wealth" stat from player cards (was redundant). Only Cash, Properties, and Influence remain.
- **Player card stats enlarged:** `.stat-value` font-size `12px` → `15px`, `.stat-label` `9px` → `10px`, influence bar `4px` → `5px` height, stat change popup `10px` → `12px` to match.
- **Trade cancel/withdraw:** players can now withdraw their own pending trade offers. New `cancelTrade(tradeId, playerId)` method in `GameEngine`. Trade panel shows "↩️ Withdraw Offer" button for outgoing pending trades. Fully synced for online play via `cancel-trade` action type.

### v1.5.3 - Player Panel Polish, Token Contours & Ownership Indicators
- **Player avatar colored contour:** board tokens now have a 2.5px colored border matching the player's color (via `currentColor`) with a dark inset shadow for contrast, replacing the old plain white border.
- **Player panel streamlined:** removed the property flags mini-section (`player-properties-mini` / `prop-dot`) from player cards — property ownership is already visible on the board via ownership indicators.
- **Stat change animations:** when a player gains or loses money, influence, or properties, a floating popup (green `+$X` / red `-$X`) appears next to the stat value and fades out. Uses `prevPlayerSnapshots` to diff before/after each render.
- **Ownership indicator redesign:** changed from pill-shaped (`border-radius: 999px`, inset 2px) to flush rectangular bars that fill the full edge of the tile (`border-radius: 0`, `top/bottom/left/right: 0`). Thinner profile (`clamp(4px, 0.07*cell, 6px)`) for a cleaner look.
- **Player token positioning fix:** removed the offset transforms that pushed tokens 30-32% outside tile boundaries; tokens now stay fully within their tile. Token container uses `overflow: hidden` to prevent spillover.
- **Player card `data-player-id` attribute:** each `.player-card` now has `data-player-id="${player.id}"` for targeted DOM queries (used by stat change animations).

### v1.5.2 - Board Visual Cohesion, Sizing, and Text Consistency
- **Connected board ring:** board tile gap is now `0` and edge tiles render as a continuous frame instead of separated cards.
- **Corner-aware rounding:** `renderBoard()` now assigns directional corner classes (`corner-br`, `corner-bl`, `corner-tl`, `corner-tr`) so only true outer corners are rounded.
- **Center turn copy update:** center status text now reads "`[player] is playing...`" for a cleaner board-center presentation.
- **Board footprint enlarged:** gameplay layout padding/gaps were reduced and board sizing was expanded (`--board-s: var(--board-size)`, desktop `--avail-h: calc(100vh - 8px)`), reducing unused left/right/top/bottom space.
- **Panel width rebalance for board space:** desktop side panel vars were tightened (`--panel-left-w: 212px`, `--panel-right-w: 242px`) to free horizontal room for the square board.
- **Uniform tile typography:** corner labels, city/tile names, and tile prices now use the same font family (`var(--font-main)`) and the same scale basis (`clamp(7px, calc(var(--cell) * 0.15), 11px)`).
- **Removed side-only text size overrides:** left/right edge tiles no longer use smaller text than top/bottom tiles, fixing inconsistent cell typography.
- **Flag overlap fix near center:** lowered center board stacking priority so inner-edge flag badges are no longer clipped under the central board area.
- **Board tile readability polish:** maintained single-line vs multi-line naming classes while improving consistent truncation/wrapping behavior for long labels.

### v1.5.1 - Board UI Layout and Label Readability
- **Top bar removed from gameplay UI:** the old header row ("Global Economic Wars", round/turn, current player, utility icons) was removed to free vertical space and simplify the layout.
- **Utility controls moved to left panel footer:** sound, music, log, and save buttons now render at the bottom of the left player panel.
- **Turn indicator moved to board center:** the active player badge now appears in the board center (near dice), including sanctions status when applicable.
- **City-name readability fix (no awkward word splits):** single-word names stay on one line (`space-name-single`) and multi-word names can wrap up to 2 lines (`space-name-multi`).
- **Name truncation behavior improved:** removed forced ellipsis-style clipping that produced labels like `San...`; text sizing and wrapping were retuned for cleaner city labels.
- **Player token overlap pass:** token placement was shifted toward tile edges and token size was increased again to improve visibility while reducing overlap with city names.
- **Board height recalibrated after top-bar removal:** desktop board available height now uses `--avail-h: calc(100vh - 8px)` (instead of a top-bar-dependent value).
- **Left panel structure updated:** player list is now a scrollable body (`.player-panel-list`) with a fixed footer (`.player-panel-footer`) for round/turn text and utility controls.

### v1.5 - Multiplayer Session Recovery, Moderation & Sync
- **Trade initiator fix (host local send path):** `handleSendTrade()` now uses `localPlayerId` in online mode. This fixes incorrect trade headers like "Player 2 → Player 2" when another player initiates trade out-of-turn.
- **Chat scoped per room:** chat history storage moved from a global key to room-specific keys (`gew_chatHistory_<ROOMCODE>`), preventing old-lobby chat bleed into unrelated games.
- **Session cleanup hardening:** creating/joining/new-game now calls network cleanup before opening a new session path, avoiding stale socket listeners across matches.
- **Persistent client identity:** `NetworkManager` now stores a stable `clientId` in localStorage and sends it on create/join.
- **Rejoin after refresh (non-host):** server now tracks room members by `clientId` seat instead of `socket.id`, stores latest stripped state + player assignments, and lets the same browser/device rejoin an active game.
- **Host moderation controls:** host UI now shows `Kick Player` for any non-host player (or `Kick Inactive` when disconnected).
- **Kick flow:** server handles `kick-player`; kicked clients receive `kicked` and are disconnected. Host receives `player-kicked` and force-bankrupts the removed player to keep game progression valid.
- **Connection state awareness:** host receives `player-connection` events (disconnect/reconnect) and player cards show an `OFFLINE` indicator.
- **Movement animation sync fix:** added `animation` relay event; host broadcasts move animation payloads so clients animate token movement instead of teleporting.

### v1.4 - Map System, Center Controls & Space Info
- **Two map variants**: Classic (11x11, 40 spaces) and World Domination (13x13, 48 spaces) selectable in lobby
- **Map selection UI**: Clickable cards in lobby showing map name, description, and grid size; highlighted selection with blue glow
- **Map registry** (`MAPS` in gameData.js): Defines board data, grid size, total spaces, and corner positions per map
- **Expanded board**: 48 spaces with 30 countries across 10 alliances including 8 new countries (Mexico, Fiji, Norway, Sweden, Indonesia, Papua New Guinea, Finland, New Zealand) and 2 new alliances (Pacific Islands, Nordic Council)
- **Flag image reliability fix (all maps)**: Added automatic flag emoji to ISO code conversion (`flagEmojiToCode`) inside `getFlagHtml()`, so newly added countries render as flag images instead of letter fallbacks (e.g., Fiji `FJ`)
- **Horizontal layout rebalance (height unchanged)**: Side panels widened on desktop via CSS vars (`--panel-left-w: 260px`, `--panel-right-w: 340px`) to use previously empty left/right space; board height formula remains `--avail-h: calc(100vh - 48px)`
- **Shared board sizing path**: Width calculation now uses panel width vars (`--avail-w: calc(100vw - var(--panel-left-w) - var(--panel-right-w) - var(--layout-side-padding))`), so the same spacing fix applies to both Classic and Expanded boards
- **New alliance bonuses**: Pacific Islands ($200 tourism boost/turn), Nordic Council (+75 influence/turn)
- **Dynamic board engine**: All `% 40` replaced with `% state.totalSpaces`, sanctions position uses `state.corners[1]`, `getSpacePosition()` computes layout from `state.gridSize`
- **CSS `.board-13` class**: Overrides grid to 13x13 with `repeat(11, var(--cell))` inner cells and board-center spanning `2/13`
- **`createGameState(playerNames, mapId)`**: Now accepts optional `mapId` parameter (defaults to `'classic'`); stores map metadata in state
- **`network.startGame(mapId)`**: Passes map selection from host to game creation
- **Card dc17 fix**: "Advance to India" now uses `spaceName: 'India'` instead of hardcoded `spaceId: 14`, so it works on both maps
- **Save/load backwards compatibility**: Old saves without map metadata get classic map defaults injected on load
- **Roll Dice / End Turn moved to board center**: Main action buttons now render below the dice in the board center area via `renderCenterActionButton()`, with pulsing blue glow animation
- **Side panel cleaned up**: Roll/End Turn buttons removed from right-side action panel; bail/immunity buttons remain
- **Space info modal**: Clicking any board cell opens a modal with full space details (price, alliance, resource, rent schedule, owner, development level, alliance bonus)
- **Space info styling**: Dark-themed modal (`.space-info-modal`) with colored alliance header, animated entrance

### v1.3 - Chat, Trade & Multiplayer Fixes
- **Chat focus fix**: Chat input now retains focus across re-renders — if you were typing when a game event triggers a render, the cursor stays in the chat input instead of losing focus.
- **Chat clearing fix**: Sent messages now properly clear from the input box. Fixed race condition where `network.sendChat()` triggered a synchronous callback→render() before `input.value = ''` could run.
- **Trade identity fix**: Online trade proposals now include `fromPlayerId` from the sender. Previously, `handleRemoteAction` used `engine.getCurrentPlayer().id` for all actions, causing trades from non-active players to appear as "Player2 → Player2" when it was Player2's turn. Now uses `senderId` for trade, property management, and influence actions.
- **`sendAction` includes sender ID**: `network.sendAction()` now always attaches `fromPlayerId` so the host can identify who sent any action.
- **Board scaling/readability update** (css/styles.css):
  - Board footprint formula (desktop): --avail-h: calc(100vh - 48px), --avail-w: calc(100vw - 464px), --board-s: min(--avail-h, --avail-w) * 0.99, with .board-container padding reduced to 2px.
  - Content now scales with board cell size via clamp(...) driven by --cell / --corner (space names, prices, flags, icons, color bars, owner triangles, dev indicators, and player tokens), so board readability increases as the board grows.

### v1.2 - Board Maximization & UI Cleanup
- **Board fills available space**: Panels narrowed (220→200px left, 300→260px right), top bar 50→44px, container padding 6→4px, scale 0.98→0.99. Board now uses nearly all available space.
- **Removed duplicate buttons**: "Propose Trade" and "View Properties" outline buttons removed from quick-actions section (duplicated the colored Management buttons above them).
- **Panel widths**: `--avail-w` now `calc(100vw - 468px)` to match the narrower `200px + 260px + 8px` layout.

### v1.1 - Game Logic Fixes & Board Sizing
- **Board sizing**: Increased from 0.96 to 0.98 scale, reduced corner multiplier from 1.2→1.15 so cells get more space
- **Diplomatic Immunity fix**: `payBail()` no longer silently consumes the immunity card — split into separate `payBail()` (money only) and `useImmunityCard()` methods. Card now properly returned to discard pile after use.
- **Card movement fix**: Cards that move the player (`advance_to`, `advance_tourism`, `advance_unowned`) no longer overwrite the landing phase to `end-turn`. Players can now buy unowned properties reached via cards.
- **Free upgrade system**: `pendingFreeUpgrade` now fully functional — shows banner in action panel + glowing "🎁 Free Upgrade" button on eligible properties in the property panel. Works for dc8 card, Americas alliance bonus, and development_grant influence action.
- **Online cheat fix**: `use-immunity` remote action handler no longer forces `hasGetOutFree = true` — uses validated `engine.useImmunityCard()` instead.

### v1.0 - Board Proportion & Icon Scaling
- **Board is now a proper square**: Uses `min(available-height, available-width) * 0.99` so the board always fits as a square with a small breathing margin. Accounts for side panel widths (`200px + 260px`) and top bar (`44px`).
- **Increased board content**: Flags 22→26px (+flag images 24→30px), space names 8→9px, space icons 18→22px, corner icons 24→32px, corner names 8→10px, color bars 10→12px, dice 52→58px, center logo 36→44px, player tokens 32→36px, owner triangles 20→24px, dev indicators 8→10px
- **Responsive recalculations**: `--avail-w` overridden at each breakpoint to match actual panel layout

### v0.9 - Animation & Sizing Fixes
- **Board sizing fix**: Board now uses `calc(100vh - 62px)` to properly fill the full viewport height (removed old `min()` caps that constrained the board to ~850px max)
- **Smooth movement fix**: `render()` now defers (returns early) while `movementAnimationInProgress` is true, preventing the DOM wipe that was destroying the floating token mid-animation. Tokens now visually slide cell-to-cell as intended.

### v0.8 - UI Polish & Animations
- **Board sizing**: Board uses vh-based sizing (initial attempt, later fixed in v0.9)
- **Smooth player movement**: Floating token animation infrastructure added (fixed in v0.9)
- **Ownership triangle pop-in**: Animated corner banner when a property is purchased
- **Chat improvements**: Auto-scrolls to latest message, preserves typed text across re-renders, saves history to localStorage (persists across refreshes)
- **Trade notifications**: Glowing Trade button + red badge when you have pending trade offers
- **Player avatars**: Switched from emojis to image-based avatars (DiceBear API by default, customizable to any image). Tokens on board increased to 32px
- **Diplomatic Cable fix**: Personal cards now only shown to the player who drew them (not all players)
- **Local panel hidden**: Local Game panel auto-hides once you create/join an online room (removes duplicate Start button)

### v0.7 - Socket.IO Multiplayer
- **Replaced PeerJS with Socket.IO** for 100% reliable multiplayer
- **New relay server** (`server/index.js`): Express + Socket.IO, deploys to Render.com
- **Full client action sync**: All 15+ action handlers now send to host via `network.sendAction()`
- **Host processes all actions**: `handleRemoteAction()` dispatches remote client actions to engine
- **Start Game button**: Double-checks `lobbyIsHost` AND `network.isHost` — impossible for non-host to see
- **Property panel fix**: Shows local player's properties (not current turn player's)
- **Global News broadcast**: Uses dedicated `broadcastGlobalNews()` method via server relay

### v0.6 - Multiplayer Debugging
- Added detailed console logging ([HOST], [CLIENT], [UI-HOST], [UI-CLIENT] prefixes)

### v0.5 - UI Overhaul & Multiplayer Fixes
- Chat always visible in bottom-right, dice centered in board, movement animation

### v0.4 - Multiplayer Fixes
- Connection retry logic, `canPerformAction()` check, dice animation fix

### v0.3 - Bug Fixes
- Flag emoji display fix (uses flagcdn.com images), token/flag size increases

### v0.2 - Debug Tools
- `window.enableDebug()`, comprehensive debug commands

### v0.1 - Initial Release
- Complete game implementation with all mechanics, local hot-seat multiplayer

## Known Issues & TODO
- [ ] Host reconnection recovery (if host refreshes, room still closes; host remains authority process)
- [x] Non-host reconnect after refresh (same browser/device via persistent `clientId`)
- [ ] Turn timer option
- [ ] Spectator mode
- [ ] Mobile responsive improvements
- [ ] Auction system when player declines to buy
- [ ] AI opponents
- [ ] More map variants (e.g., 15x15 mega board)

## File Details

### gameData.js
- `ALLIANCES` - 10 alliance definitions with colors and bonuses (8 base + PACIFIC_ISLANDS, NORDIC)
- `RESOURCES` - Resource types and their effects
- `DEVELOPMENT_TIERS` - Building upgrade levels
- `BOARD` - Array of 40 space objects (classic 11x11 map)
- `BOARD_EXPANDED` - Array of 48 space objects (expanded 13x13 map)
- `MAPS` - Map registry: `{ classic, expanded }` each with `board`, `gridSize`, `totalSpaces`, `corners`
- `GLOBAL_NEWS_CARDS` - 18 world event cards
- `DIPLOMATIC_CABLE_CARDS` - 18 personal event cards
- `PLAYER_AVATARS` - Array of `{emoji, img}` objects (customizable)
- `PLAYER_COLORS` - 8 player colors
- Constants: STARTING_MONEY, GO_SALARY, SANCTIONS_BAIL, INFLUENCE_TO_WIN

### gameEngine.js
- `createGameState(playerNames, mapId)` - Factory to create initial state; `mapId` defaults to `'classic'`, stores map metadata in state (`mapId`, `totalSpaces`, `corners`, `gridSize`)
- `GameEngine` class:
  - State management and event emission
  - `rollDiceAction()` - Handle dice roll
  - `movePlayer()` / `movePlayerTo()` - Movement logic (wraps via `% state.totalSpaces`)
  - `sendToSanctions()` - Sends player to `state.corners[1]` (dynamic sanctions position)
  - `handleLanding()` - Process landing on spaces
  - `calculateRent()` - Rent with all bonuses
  - `buyProperty()` / `developProperty()` / `freeUpgradeProperty()` - Property management
  - `useImmunityCard()` - Separate method for Diplomatic Immunity (validates card ownership)
  - `proposeTrade()` / `acceptTrade()` / `cancelTrade()` - Trading system (cancel lets sender withdraw pending offers)
  - `useInfluenceAction()` - Influence powers
  - `checkWinCondition()` - Victory detection
  - `getPlayerById()` - Lookup player by ID
  - Alliance bonuses: OIL_NATIONS, EASTERN, AFRICAN_RISING, AMERICAS, PACIFIC_ISLANDS, NORDIC

### ui.js (~2100 lines)
- `getAvatarHtml(avatar, size)` - Renders player avatar as image with emoji fallback
- `addChatMessage(msg)` - Adds chat message and persists to room-scoped localStorage key
- `isOnlineClient()` - Returns true when playing online as non-host
- `handleRemoteAction(data)` - Host dispatches remote client actions to engine
- `initApp()` - Entry point, initializes state
- `render()` - Main render dispatcher (preserves chat input, auto-scrolls chat, defers while animation in progress)
- `renderLobby()` / `renderGame()` - Screen renderers; lobby includes map selection
- `renderBoard()` - Dynamic NxN CSS grid board; applies `.board-13` class for expanded map
- `renderCenterActionButton()` - Renders Roll Dice / Buy / Decline / End Turn buttons in the board center below dice
- `renderSpaceInfoModal()` - Renders detailed space info popup when a board cell is clicked
- `renderPlayerCard()` - Player info panels (cash, properties count, influence bar; no wealth or property flag icons)
- `snapshotPlayerStats()` / `showPlayerChangeAnimations()` - Diff-based floating popup system for stat changes
- `renderActionPanel()` - Context-sensitive actions with trade notification badge (bail/immunity only; roll/end turn/buy/decline moved to center)
- `renderPropertyPanel()` - Uses local player (not current turn player) in online mode
- `renderTradePanel()` - Uses local player in online mode
- `getSpacePosition(id)` - Dynamic grid position calculation based on `state.gridSize`
- `flagEmojiToCode(flagEmoji)` - Converts regional-indicator flag emoji to ISO country code (example: `🇫🇯` -> `FJ`)
- `attachGameEvents()` - Event listener setup (includes center button handlers, space click → info modal)
- `handleRollDice()` - Dice animation + engine call (or sendAction for clients)
- `animatePlayerMovement()` - Smooth floating token sliding between cells (wraps via `% state.totalSpaces`)
- `getFlagHtml()` - Converts flag emoji to image for cross-platform display; now also falls back to `flagEmojiToCode()` for new countries not present in the static map
- `hostOnlineGame()` / `joinOnlineGame()` - Network setup with callbacks
- `handleHostPlayerConnection()` - Host-side disconnect/reconnect state handling
- `handleKickPlayer()` / `handleHostPlayerKicked()` - Host moderation actions and post-kick game-state handling
- `handleLoadGame()` - Loads saved game with backwards compatibility for pre-map saves
- **State variables**: `selectedMapId` (lobby map choice), `selectedSpaceInfo` (space info modal), `prevPlayerSnapshots` (previous money/influence/property counts for change animations)
- Debug tools at bottom (window.enableDebug(), window.debug.*)

### network.js (Socket.IO Client)
- `NetworkManager` class with Socket.IO internals
- `SERVER_URL` auto-detects localhost vs production
- Persistent `clientId` in localStorage (`gew_client_id`) for session rejoin
- `host(name, callback)` - Creates room via server
- `join(name, code, callback)` - Joins/rejoins room via server
- `startGame(mapId)` - Host creates state with selected map and sends per-player assignments including `clientId`
- `broadcastState(state)` - Host sends state to all clients (strips card decks)
- `broadcastGlobalNews(card)` - Host sends Global News card to all clients
- `broadcastAnimation(type, data)` - Host relays movement animations to clients
- `sendAction(action)` - Client sends action to host via server
- `sendChat(msg)` - Send chat message
- `kickPlayer(playerId)` - Host moderation request to remove player
- `stripCardDecks(state)` - Removes card deck arrays to reduce payload size
- `destroy()` - Disconnect and cleanup

### server/index.js (Socket.IO Relay Server)
- Express + Socket.IO, listens on PORT env var or 3000
- CORS: allows alexander699.github.io + localhost
- Room management: create/join with 5-char codes, max 8 players
- Session seats keyed by persistent `clientId` (not socket ID) for non-host rejoin support
- Stores latest stripped game state + `playerAssignments` so reconnecting clients can be re-synced
- Message relay: game-action → host, state-update/global-news/animation → clients
- Moderation relay: `kick-player`, `player-kicked`, `kicked`, `player-connection`
- Disconnect handling: host leaves = room closes, client disconnect in active game = marked offline (rejoinable unless kicked)
- Room cleanup: deletes rooms older than 2 hours every 5 minutes
- Health check: `GET /` returns `{ status: 'ok', rooms: count }`

### soundManager.js
- `SoundManager` class using Web Audio API
- Generates tones procedurally (no audio files needed)
- Methods: playDiceRoll, playPurchase, playRentPaid, playVictory, playMove, etc.

## Architecture Notes

### State Flow (Local / Host)
```
User Action → UI Handler → GameEngine method → State Update → emit() → render()
                                                            → broadcastState() (if host)
```

### State Flow (Online Client)
```
User Action → UI Handler → network.sendAction() → Server → Host
Host: handleRemoteAction() → GameEngine → emit() → render() + broadcastState()
Server relays state-update → Client: Object.assign(engine.state, ...) → render()
```

### Board Coordinate System
- Dynamic NxN CSS Grid (11x11 or 13x13), always square: `--board-s = min(avail-height, avail-width) * 0.99`
- `getSpacePosition(id)` converts space ID to {row, col} based on `state.gridSize`
- For an NxN grid (N = `gridSize`, corners at positions 0, N-1, 2*(N-1), 3*(N-1)):
  - Bottom row: IDs 0 to N-1 → row=N-1, col=N-1-id (right to left)
  - Left column: IDs N to 2*(N-1)-1 → row=N-1-(id-N+1), col=0 (bottom to top)
  - Top-left corner: ID 2*(N-1) → row=0, col=0
  - Top row: IDs 2*(N-1)+1 to 3*(N-1) → row=0, col=id-2*(N-1) (left to right)
  - Right column: IDs 3*(N-1)+1 to 4*(N-1)-1 → row=id-3*(N-1), col=N-1 (top to bottom)
- Classic: Bottom (0-10) → Left (11-20) → Top (21-30) → Right (31-39)
- Expanded: Bottom (0-12) → Left (13-24) → Top (25-36) → Right (37-47)

### CSS Grid Classes
- `.board` — default 11x11 grid: `--corner: calc(--board-s / 11 * 1.15)`, `--cell: calc((--board-s - 2*--corner) / 9)`, `repeat(9, var(--cell))`
- `.board.board-13` — overrides to 13x13: `--corner: calc(--board-s / 13 * 1.12)`, `--cell: calc((--board-s - 2*--corner) / 11)`, `repeat(11, var(--cell))`
- `.board-center` — grid-row/col `2/11` (classic) or `2/13` (expanded)
- Board footprint now uses dynamic panel widths: `--avail-h: calc(100vh - 48px)` and `--avail-w: calc(100vw - var(--panel-left-w) - var(--panel-right-w) - var(--layout-side-padding))`; desktop defaults are 280px (left) and 320px (right)
- All space content (icons, text, flags, tokens) uses `clamp()` with `var(--cell)` so it scales automatically

### Rendering
- Full re-render on state change (simple but works)
- Template literals for HTML generation
- Event listeners re-attached after each render
- Chat input text preserved across re-renders via `chatInputDraft`
- Chat auto-scrolls to bottom after each render

### Adding New Maps
To add a third map variant:
1. Define a new board array in `gameData.js` (e.g., `BOARD_MEGA` with 56 spaces for 15x15)
2. Add an entry to the `MAPS` object with `id`, `name`, `description`, `board`, `gridSize`, `totalSpaces`, `corners`
3. Add a CSS class `.board.board-15` in styles.css with the appropriate grid overrides
4. Add the class condition in `renderBoard()` (line: `const boardClass = ...`)
5. Everything else (position calculation, movement, alliances, rendering) is fully dynamic

## Testing & Debug Mode

### Testing Multiplayer Locally
1. Start server: `cd server && node index.js`
2. Start client: `python -m http.server 8080`
3. Open two tabs at `http://localhost:8080` (same browser works with Socket.IO)
4. Host in one tab, join in the other with the room code

### Debug Console Commands
```javascript
window.enableDebug()

window.debug.giveMoney(5000)
window.debug.giveProperty(14)              // India (classic map ID)
window.debug.giveInfluence(500)
window.debug.moveTo(10)                    // Trade Sanctions (classic)
window.debug.completeAlliance('EASTERN')
window.debug.drawCard('globalNews')
window.debug.bankruptPlayer(1)
window.debug.simulateTurn()
window.debug.forceEndTurn()
window.debug.skipToPlayer(2)
window.debug.getState()
window.debug.listSpaces()
window.debug.listAlliances()
```

### Key Space IDs (Classic Map)
- 0: Global Summit (GO), 10: Trade Sanctions (Jail), 20: Free Trade Zone, 30: International Incident
- 3: Armenia, 14: India, 39: USA (most expensive)

### Key Space IDs (Expanded Map)
- 0: Global Summit (GO), 12: Trade Sanctions (Jail), 24: Free Trade Zone, 36: International Incident
- 3: Armenia, 16: India, 47: USA (most expensive)
- New: 10: Mexico, 11: Fiji, 22: Norway, 23: Sweden, 34: Indonesia, 35: Papua New Guinea, 44: Finland, 45: New Zealand

## Quick Reference

### Starting a Local Game
1. Open http://localhost:8080
2. Set number of players (2-8), enter names
3. Choose a map (Classic or World Domination)
4. Click "Start Game"

### Starting an Online Game
1. **Host**: Enter name, click "Create Room", share the 5-letter code
2. **Host**: Choose a map (Classic or World Domination)
3. **Client**: Enter name + room code, click "Join Room"
4. **Host**: Click "Start Game (Host)" when all players have joined

### Game Controls
- **Space/Enter**: Roll dice or End Turn
- **Click board spaces**: View space details (info modal)
- **Roll Dice / End Turn**: Centered below dice on the board
- **Save button**: Saves to localStorage (includes map metadata)
- **Load button**: Appears if save exists (backwards compatible with pre-map saves)
