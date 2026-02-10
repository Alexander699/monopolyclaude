// ============================================================
// GLOBAL ECONOMIC WARS - Network Manager (Socket.IO)
// ============================================================

// Socket.IO relay server - host is still the game authority,
// server relays actions/state between host and clients.

const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://${window.location.hostname}:3000`
  : 'https://monopolyclaude.onrender.com';

const CLIENT_ID_KEY = 'gew_client_id';

function createClientId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.isHost = false;
    this.roomCode = '';
    this.playerName = '';
    this.callback = null;
    this.players = []; // Array of {name, clientId, playerId, connected}
    this.localPlayerId = null;
    this.clientId = this.getOrCreateClientId();
    this.wasKicked = false;
    this.hostListenersRegistered = false;
  }

  getOrCreateClientId() {
    try {
      let id = localStorage.getItem(CLIENT_ID_KEY);
      if (!id) {
        id = createClientId();
        localStorage.setItem(CLIENT_ID_KEY, id);
      }
      return id;
    } catch (e) {
      return createClientId();
    }
  }

  persistClientId(id) {
    if (!id) return;
    this.clientId = id;
    try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (e) {}
  }

  setPlayers(players, participants) {
    if (Array.isArray(participants) && participants.length > 0) {
      this.players = participants.map(p => ({
        name: p.name,
        clientId: p.clientId || null,
        playerId: p.playerId || null,
        connected: p.connected !== false
      }));
      return;
    }

    this.players = (players || []).map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, clientId: null, playerId: null, connected: true };
      }
      return {
        name: entry?.name || 'Player',
        clientId: entry?.clientId || null,
        playerId: entry?.playerId || null,
        connected: entry?.connected !== false
      };
    });
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
    this.wasKicked = false;
    this.players = [{ name, clientId: this.clientId, playerId: null, connected: true }];

    this.connectSocket();

    this.socket.on('connect', () => {
      this.socket.emit('create-room', { name, clientId: this.clientId });
    });

    this.socket.on('room-created', (data) => {
      this.log(`Room created: ${data.code}`);
      this.roomCode = data.code;
      if (data.clientId) this.persistClientId(data.clientId);
      this.setPlayers(data.players, data.participants);
      callback('room-created', {
        code: data.code,
        players: this.players.map(p => p.name),
        participants: this.players
      });
    });

    this.socket.on('player-joined', ({ players, participants, newPlayer, reconnected }) => {
      this.log(`Player joined: ${newPlayer || 'unknown'} (${players?.length || 0} total)`);
      this.setPlayers(players, participants);
      callback('player-joined', {
        players: this.players.map(p => p.name),
        participants: this.players,
        newPlayer,
        reconnected: !!reconnected
      });
    });

    this.socket.on('player-left', ({ players, participants, leftPlayer, disconnected, kicked }) => {
      this.log(`Player left: ${leftPlayer || 'unknown'}`);
      this.setPlayers(players, participants);
      callback('player-left', {
        players: this.players.map(p => p.name),
        participants: this.players,
        leftPlayer,
        disconnected: !!disconnected,
        kicked: !!kicked
      });
    });

    this.socket.on('player-connection', (data) => {
      callback('player-connection', data);
    });

    this.socket.on('player-kicked', (data) => {
      callback('player-kicked', data);
    });

    this.socket.on('game-action', (data) => {
      this.log(`Received action: ${data.actionType}`);
      callback('action', data);
    });

    this.socket.on('chat', (msg) => {
      callback('chat', msg);
    });

    this.socket.on('animation', (data) => {
      callback('animation', data);
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
    this.wasKicked = false;

    this.connectSocket();

    this.socket.on('connect', () => {
      this.log(`Joining room: ${this.roomCode}`);
      this.socket.emit('join-room', {
        code: this.roomCode,
        name,
        clientId: this.clientId
      });
    });

    this.socket.on('joined', (data) => {
      this.log(`Joined room with players: ${(data.players || []).join(', ')}`);
      if (data.clientId) this.persistClientId(data.clientId);
      this.setPlayers(data.players, data.participants);
      callback('joined', {
        players: this.players.map(p => p.name),
        participants: this.players,
        rejoined: !!data.rejoined
      });
    });

    this.socket.on('player-joined', ({ players, participants, newPlayer, reconnected }) => {
      this.log(`Player joined: ${newPlayer || 'unknown'}`);
      this.setPlayers(players, participants);
      callback('player-joined', {
        players: this.players.map(p => p.name),
        participants: this.players,
        newPlayer,
        reconnected: !!reconnected
      });
    });

    this.socket.on('player-left', ({ players, participants, leftPlayer, disconnected, kicked }) => {
      this.log(`Player left: ${leftPlayer || 'unknown'}`);
      this.setPlayers(players, participants);
      callback('player-left', {
        players: this.players.map(p => p.name),
        participants: this.players,
        leftPlayer,
        disconnected: !!disconnected,
        kicked: !!kicked
      });
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

    this.socket.on('animation', (data) => {
      callback('animation', data);
    });

    this.socket.on('promote-to-host', (data) => {
      this.log('=== PROMOTED TO HOST ===');
      this.isHost = true;
      if (data.participants) {
        this.players = data.participants.map(p => ({
          name: p.name,
          clientId: p.clientId,
          playerId: p.playerId,
          connected: p.connected
        }));
      }
      callback('promote-to-host', data);
    });

    this.socket.on('host-migrated', (data) => {
      this.log(`Host migrated: new host is "${data.newHostName}"`);
      callback('host-migrated', data);
    });

    this.socket.on('kicked', (data) => {
      this.wasKicked = true;
      callback('kicked', data);
    });

    this.socket.on('disconnect', () => {
      this.log('Disconnected from server', 'warn');
      if (!this.wasKicked && !this.isHost) {
        callback('error', { message: 'Lost connection to server. The game session has ended.' });
      }
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
      const playerNames = this.players.map((p, i) => p.name || `Player ${i + 1}`);
      this.log(`Creating game state for: ${playerNames.join(', ')} on map: ${mapId}`);

      const state = createGameState(playerNames, mapId);

      // Assign game player IDs in lobby order.
      this.players.forEach((playerInfo, i) => {
        playerInfo.playerId = state.players[i].id;
        if (!playerInfo.clientId) {
          playerInfo.clientId = `legacy_${i}_${playerInfo.name}`;
        }
      });

      // Host is index 0 in lobby order.
      this.localPlayerId = this.players[0].playerId;
      this.log(`Host is player 0: ${this.players[0].name} (ID: ${this.localPlayerId})`);

      this.callback('game-start', {
        type: 'game-start',
        state: JSON.parse(JSON.stringify(state)),
        localId: this.players[0].playerId,
        playerIndex: 0
      });

      // Send per-player assignments (including clientId) to server for reconnect support.
      const playerAssignments = this.players.map((p, i) => ({
        name: p.name,
        clientId: p.clientId,
        localId: p.playerId,
        playerIndex: i
      }));

      const clientState = this.stripCardDecks(state);
      this.log(`Sending game-start to server (${JSON.stringify(clientState).length} bytes)`);

      this.socket.emit('start-game', {
        state: clientState,
        playerAssignments
      });

      // Send full state backup immediately so server has it for host migration
      this.socket.emit('host-state-backup', { state: JSON.parse(JSON.stringify(state)) });

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
    // Send full state backup (with card decks) for host migration support
    this.socket.emit('host-state-backup', { state: JSON.parse(JSON.stringify(state)) });
  }

  broadcastGlobalNews(card) {
    if (!this.isHost || !this.socket) return;
    this.socket.emit('global-news', { card });
  }

  broadcastAnimation(type, data) {
    if (!this.isHost || !this.socket || !type) return;
    this.socket.emit('animation', { type, data });
  }

  sendAction(action) {
    if (this.isHost) return; // Host processes locally
    if (!this.socket) {
      this.log('Cannot send action - not connected', 'error');
      return;
    }
    // Always include the sender's player ID so host can attribute any-player actions.
    action.fromPlayerId = this.localPlayerId;
    this.log(`Sending action: ${action.actionType}`);
    this.socket.emit('game-action', action);
  }

  sendChat(msg) {
    if (!this.socket) return;
    this.socket.emit('chat', msg);
    // Socket.IO broadcast excludes sender, so add locally.
    if (this.callback) {
      this.callback('chat', msg);
    }
  }

  registerHostListeners() {
    if (!this.socket || this.hostListenersRegistered) return;
    this.hostListenersRegistered = true;

    const callback = this.callback;
    if (!callback) return;

    this.socket.on('game-action', (data) => {
      this.log(`Received action: ${data.actionType}`);
      callback('action', data);
    });

    this.socket.on('player-connection', (data) => {
      callback('player-connection', data);
    });

    this.socket.on('player-kicked', (data) => {
      callback('player-kicked', data);
    });
  }

  kickPlayer(playerId) {
    if (!this.isHost || !this.socket || !playerId) return;
    this.socket.emit('kick-player', { playerId });
  }

  destroy() {
    this.log('Destroying network manager');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.players = [];
    this.localPlayerId = null;
    this.roomCode = '';
    this.wasKicked = false;
  }
}
