// ============================================================
// GLOBAL ECONOMIC WARS - Network Manager (Socket.IO)
// ============================================================

// Socket.IO relay server - host is still the game authority,
// server just relays messages between host and clients.

const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://${window.location.hostname}:3000`
  : 'https://monopolyclaude.onrender.com';

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.isHost = false;
    this.roomCode = '';
    this.playerName = '';
    this.callback = null;
    this.players = []; // Array of {name, peerId, playerId}
    this.localPlayerId = null;
  }

  log(msg, type = 'info') {
    const prefix = this.isHost ? '[HOST]' : '[CLIENT]';
    const style = type === 'error' ? 'color: red' : type === 'warn' ? 'color: orange' : 'color: green';
    console.log(`%c${prefix} ${msg}`, style);
  }

  // Strip large card decks from state to reduce message size
  stripCardDecks(state) {
    const stripped = JSON.parse(JSON.stringify(state));
    stripped.globalNewsDeck = [];
    stripped.diplomaticDeck = [];
    stripped.globalNewsDiscard = [];
    stripped.diplomaticDiscard = [];
    return stripped;
  }

  connectSocket() {
    this.log(`Connecting to server: ${SERVER_URL}`);
    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.log(`Connected to server (id: ${this.socket.id})`);
    });

    this.socket.on('connect_error', (err) => {
      this.log(`Connection error: ${err.message}`, 'error');
      if (this.callback) {
        this.callback('error', { message: 'Cannot connect to game server. Please try again.' });
      }
    });

    this.socket.on('error-msg', (data) => {
      this.log(`Server error: ${data.message}`, 'error');
      if (this.callback) {
        this.callback('error', data);
      }
    });
  }

  host(name, callback) {
    this.isHost = true;
    this.playerName = name;
    this.callback = callback;
    this.players = [{ name, playerId: null }];

    this.connectSocket();

    this.socket.on('connect', () => {
      this.socket.emit('create-room', { name });
    });

    this.socket.on('room-created', ({ code }) => {
      this.log(`Room created: ${code}`);
      this.roomCode = code;
      callback('room-created', { code });
    });

    this.socket.on('player-joined', ({ players, newPlayer }) => {
      this.log(`Player joined: ${newPlayer} (${players.length} total)`);
      this.players = players.map(n => ({ name: n, playerId: null }));
      callback('player-joined', { players });
    });

    this.socket.on('player-left', ({ players, leftPlayer }) => {
      this.log(`Player left: ${leftPlayer}`);
      this.players = players.map(n => ({ name: n, playerId: null }));
      callback('player-left', { players });
    });

    this.socket.on('game-action', (data) => {
      this.log(`Received action: ${data.actionType}`);
      callback('action', data);
    });

    this.socket.on('chat', (msg) => {
      callback('chat', msg);
    });

    this.socket.on('disconnect', () => {
      this.log('Disconnected from server', 'warn');
    });
  }

  join(name, code, callback) {
    this.isHost = false;
    this.playerName = name;
    this.roomCode = code.toUpperCase().trim();
    this.callback = callback;

    this.connectSocket();

    this.socket.on('connect', () => {
      this.log(`Joining room: ${this.roomCode}`);
      this.socket.emit('join-room', { code: this.roomCode, name });
    });

    this.socket.on('joined', ({ players }) => {
      this.log(`Joined room with players: ${players.join(', ')}`);
      this.players = players.map(n => ({ name: n, playerId: null }));
      callback('joined', { players });
    });

    this.socket.on('player-joined', ({ players, newPlayer }) => {
      this.log(`Player joined: ${newPlayer}`);
      this.players = players.map(n => ({ name: n, playerId: null }));
      callback('player-joined', { players });
    });

    this.socket.on('player-left', ({ players, leftPlayer }) => {
      this.log(`Player left: ${leftPlayer}`);
      this.players = players.map(n => ({ name: n, playerId: null }));
      callback('player-left', { players });
    });

    this.socket.on('game-start', (data) => {
      this.log('=== GAME START RECEIVED ===');
      this.log(`Local player ID: ${data.localId}`);
      this.log(`Player index: ${data.playerIndex}`);
      this.log(`State has ${data.state?.players?.length || 0} players`);
      this.localPlayerId = data.localId;
      callback('game-start', data);
    });

    this.socket.on('state-update', (data) => {
      callback('state-update', data);
    });

    this.socket.on('global-news', (data) => {
      callback('global-news', data);
    });

    this.socket.on('chat', (msg) => {
      callback('chat', msg);
    });

    this.socket.on('disconnect', () => {
      this.log('Disconnected from server', 'warn');
      callback('error', { message: 'Lost connection to server. The game session has ended.' });
    });
  }

  startGame(mapId = 'classic') {
    this.log('=== startGame() called ===');

    if (!this.isHost) {
      this.log('ERROR: Only host can start the game', 'error');
      return;
    }

    if (this.players.length < 2) {
      this.log('ERROR: Need at least 2 players to start', 'error');
      this.callback('error', { message: 'Need at least 2 players to start the game' });
      return;
    }

    import('./gameEngine.js').then(({ createGameState }) => {
      const playerNames = this.players.map(p => p.name);
      this.log(`Creating game state for: ${playerNames.join(', ')} on map: ${mapId}`);

      const state = createGameState(playerNames, mapId);

      // Assign player IDs
      this.players.forEach((playerInfo, i) => {
        playerInfo.playerId = state.players[i].id;
      });

      // Start game locally for host
      this.localPlayerId = this.players[0].playerId;
      this.log(`Host is player 0: ${this.players[0].name} (ID: ${this.localPlayerId})`);

      this.callback('game-start', {
        type: 'game-start',
        state: JSON.parse(JSON.stringify(state)),
        localId: this.players[0].playerId,
        playerIndex: 0
      });

      // Build per-player assignments for the server to relay
      const playerAssignments = this.players.slice(1).map((p, i) => ({
        name: p.name,
        localId: p.playerId,
        playerIndex: i + 1
      }));

      // Send stripped state to server for relay to clients
      const clientState = this.stripCardDecks(state);
      this.log(`Sending game-start to server (${JSON.stringify(clientState).length} bytes)`);

      this.socket.emit('start-game', {
        state: clientState,
        playerAssignments
      });

      this.log('=== Game start complete ===');
    }).catch(err => {
      this.log(`FATAL: Failed to start game: ${err.message}`, 'error');
      console.error(err);
      this.callback('error', { message: 'Failed to initialize game. Please try again.' });
    });
  }

  broadcastState(state) {
    if (!this.isHost || !this.socket) return;
    this.socket.emit('state-update', { state: this.stripCardDecks(state) });
  }

  broadcastGlobalNews(card) {
    if (!this.isHost || !this.socket) return;
    this.socket.emit('global-news', { card });
  }

  sendAction(action) {
    if (this.isHost) return; // Host processes locally
    if (!this.socket) {
      this.log('Cannot send action - not connected', 'error');
      return;
    }
    // Always include the sender's player ID so the host knows who sent it
    action.fromPlayerId = this.localPlayerId;
    this.log(`Sending action: ${action.actionType}`);
    this.socket.emit('game-action', action);
  }

  sendChat(msg) {
    if (!this.socket) return;
    this.socket.emit('chat', msg);
    // Socket.IO broadcast excludes sender, so add locally
    if (this.callback) {
      this.callback('chat', msg);
    }
  }

  destroy() {
    this.log('Destroying network manager');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.players = [];
    this.localPlayerId = null;
  }
}
