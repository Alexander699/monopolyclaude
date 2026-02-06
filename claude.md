# Global Economic Wars - Project Documentation

## Overview
A browser-based multiplayer board game inspired by property trading games (Monopoly-style) but with unique mechanics centered around countries and global economics. Players compete as global investors to build economic empires.

## Project Structure
```
Online Monopoly/
├── index.html              # Entry point, loads Socket.IO CDN and modules
├── claude.md               # This documentation file
├── css/
│   └── styles.css          # Complete styling (~1700 lines, dark diplomatic theme)
├── js/
│   ├── gameData.js         # Board configuration, cards, alliances, constants
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
| `create-room` | Client→Server | Host creates a room |
| `room-created` | Server→Client | Returns room code |
| `join-room` | Client→Server | Client joins with code+name |
| `joined` | Server→Client | Confirms join with player list |
| `player-joined/left` | Server→All | Player list updates |
| `start-game` | Host→Server→Clients | Sends initial game state to each client |
| `game-action` | Client→Server→Host | Client action relayed to host |
| `state-update` | Host→Server→Clients | Host broadcasts state changes |
| `global-news` | Host→Server→Clients | Global News card shown to all |
| `chat` | Any→Server→Others | Chat messages |
| `error-msg` | Server→Client | Error notifications |

### Key Patterns in ui.js
- `isOnlineClient()` — returns true when playing online as non-host
- `handleRemoteAction(data)` — host dispatches client actions to engine
- All action handlers check `isOnlineClient()` → call `network.sendAction()` instead of engine directly
- Card decks stripped from network payloads (`stripCardDecks()`) to reduce message size
- Start Game button double-checks both `lobbyIsHost` and `network.isHost`

## Game Mechanics

### Victory Conditions
1. **Influence Victory**: First to reach 1000 Influence Points
2. **Last Standing**: Be the last solvent player

### Board Layout (40 spaces, clockwise)
- **Corners**: Global Summit (GO), Trade Sanctions (Jail), Free Trade Zone, International Incident
- **Countries**: 23 countries across 8 alliances
- **Other**: 4 transports, 2 infrastructure, 2 taxes, 5 card spaces

### Alliances & Their Bonuses
Own ALL countries in an alliance to unlock the bonus (like Monopoly color sets).
Must complete an alliance before developing (building) on any of its countries.

| Alliance | Countries | Completion Bonus |
|----------|-----------|------------------|
| EASTERN | Moldova, Armenia, Ukraine | +50 influence/turn |
| AFRICAN_RISING | Nigeria, Kenya, Egypt | $250 tourism income/turn |
| SOUTH_ASIAN | India, Bangladesh, Sri Lanka, Nepal | +$200 on all rent collected |
| BRICS | South Africa, China, Brazil | +100 influence per rent payment |
| EU | France, Germany, UK | Double rent on developed properties |
| ASIAN_TIGERS | Japan, South Korea, Singapore | Tech Hub costs -50% |
| OIL_NATIONS | Saudi Arabia, UAE | $300 oil royalties/turn |
| AMERICAS | Canada, USA | Free development upgrade/round |

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

### v1.2 - Board Maximization & UI Cleanup (Current)
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
- [ ] Reconnection handling (refresh disconnects — need session persistence + rejoin)
- [ ] Turn timer option
- [ ] Spectator mode
- [ ] Mobile responsive improvements
- [ ] Auction system when player declines to buy
- [ ] AI opponents

## File Details

### gameData.js
- `ALLIANCES` - Alliance definitions with colors and bonuses
- `RESOURCES` - Resource types and their effects
- `DEVELOPMENT_TIERS` - Building upgrade levels
- `BOARD` - Array of 40 space objects
- `GLOBAL_NEWS_CARDS` - 18 world event cards
- `DIPLOMATIC_CABLE_CARDS` - 18 personal event cards
- `PLAYER_AVATARS` - Array of `{emoji, img}` objects (customizable)
- `PLAYER_COLORS` - 8 player colors
- Constants: STARTING_MONEY, GO_SALARY, SANCTIONS_BAIL, INFLUENCE_TO_WIN

### gameEngine.js
- `createGameState(playerNames)` - Factory to create initial state
- `GameEngine` class:
  - State management and event emission
  - `rollDiceAction()` - Handle dice roll
  - `movePlayer()` / `movePlayerTo()` - Movement logic
  - `handleLanding()` - Process landing on spaces
  - `calculateRent()` - Rent with all bonuses
  - `buyProperty()` / `developProperty()` / `freeUpgradeProperty()` - Property management
  - `useImmunityCard()` - Separate method for Diplomatic Immunity (validates card ownership)
  - `proposeTrade()` / `acceptTrade()` - Trading system
  - `useInfluenceAction()` - Influence powers
  - `checkWinCondition()` - Victory detection
  - `getPlayerById()` - Lookup player by ID

### ui.js (~1900 lines)
- `getAvatarHtml(avatar, size)` - Renders player avatar as image with emoji fallback
- `addChatMessage(msg)` - Adds chat message and persists to localStorage
- `isOnlineClient()` - Returns true when playing online as non-host
- `handleRemoteAction(data)` - Host dispatches remote client actions to engine
- `initApp()` - Entry point, initializes state
- `render()` - Main render dispatcher (preserves chat input, auto-scrolls chat, defers while animation in progress)
- `renderLobby()` / `renderGame()` - Screen renderers
- `renderBoard()` - 11x11 CSS grid board with calc-based square sizing
- `renderPlayerCard()` - Player info panels
- `renderActionPanel()` - Context-sensitive actions with trade notification badge
- `renderPropertyPanel()` - Uses local player (not current turn player) in online mode
- `renderTradePanel()` - Uses local player in online mode
- `attachGameEvents()` - Event listener setup
- `handleRollDice()` - Dice animation + engine call (or sendAction for clients)
- `animatePlayerMovement()` - Smooth floating token sliding between cells (render() defers while active)
- `getFlagHtml()` - Converts flag emoji to image for cross-platform display
- `hostOnlineGame()` / `joinOnlineGame()` - Network setup with callbacks
- Debug tools at bottom (window.enableDebug(), window.debug.*)

### network.js (Socket.IO Client)
- `NetworkManager` class with Socket.IO internals
- `SERVER_URL` auto-detects localhost vs production
- `host(name, callback)` - Creates room via server
- `join(name, code, callback)` - Joins room via server
- `startGame()` - Host creates state, sends to server for relay to clients
- `broadcastState(state)` - Host sends state to all clients (strips card decks)
- `broadcastGlobalNews(card)` - Host sends Global News card to all clients
- `sendAction(action)` - Client sends action to host via server
- `sendChat(msg)` - Send chat message
- `stripCardDecks(state)` - Removes card deck arrays to reduce payload size
- `destroy()` - Disconnect and cleanup

### server/index.js (Socket.IO Relay Server)
- Express + Socket.IO, listens on PORT env var or 3000
- CORS: allows alexander699.github.io + localhost
- Room management: create/join with 5-char codes, max 8 players
- Message relay: game-action → host, state-update → all clients, global-news → all clients
- Disconnect handling: host leaves = room closes, client leaves = player removed
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
- 11x11 CSS Grid, always square: `--board-s = min(avail-height, avail-width) * 0.96`
- `getSpacePosition(id)` converts space ID (0-39) to {row, col}
- Clockwise: Bottom (0-10) → Left (11-20) → Top (21-30) → Right (31-39)

### Rendering
- Full re-render on state change (simple but works)
- Template literals for HTML generation
- Event listeners re-attached after each render
- Chat input text preserved across re-renders via `chatInputDraft`
- Chat auto-scrolls to bottom after each render

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
window.debug.giveProperty(14)              // India
window.debug.giveInfluence(500)
window.debug.moveTo(10)                    // Trade Sanctions
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

### Key Space IDs
- 0: Global Summit (GO), 10: Trade Sanctions (Jail), 20: Free Trade Zone, 30: International Incident
- 3: Armenia, 14: India, 39: USA (most expensive)

## Quick Reference

### Starting a Local Game
1. Open http://localhost:8080
2. Set number of players (2-8), enter names
3. Click "Start Game"

### Starting an Online Game
1. **Host**: Enter name, click "Create Room", share the 5-letter code
2. **Client**: Enter name + room code, click "Join Room"
3. **Host**: Click "Start Game (Host)" when all players have joined

### Game Controls
- **Space/Enter**: Roll dice or End Turn
- **Click board spaces**: View details
- **Save button**: Saves to localStorage
- **Load button**: Appears if save exists
