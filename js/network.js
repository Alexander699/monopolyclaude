// ============================================================
// GLOBAL ECONOMIC WARS - Network Manager (Socket.IO)
// ============================================================

// Server-authoritative model: the server runs the GameEngine.
// All clients are equal — they send actions and receive state updates.

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
    this.isHost = false;       // True = room creator (can start game + kick). NOT a game-logic host.
    this.roomCode = '';
    this.playerName = '';
    this.callback = null;
    this.players = [];         // Array of {name, clientId, playerId, connected}
    this.localPlayerId = null;
    this.clientId = this.getOrCreateClientId();
    this.wasKicked = false;
    this.hasConnectedOnce = false;
    this.hasShownInitialConnectError = false;
    this.lastConnectionStatusKey = null;
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
        connected: p.connected !== false,
        avatarIndex: Number.isInteger(p.avatarIndex) ? p.avatarIndex : null
      }));
      return;
    }

    this.players = (players || []).map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, clientId: null, playerId: null, connected: true, avatarIndex: null };
      }
      return {
        name: entry?.name || 'Player',
        clientId: entry?.clientId || null,
        playerId: entry?.playerId || null,
        connected: entry?.connected !== false,
        avatarIndex: Number.isInteger(entry?.avatarIndex) ? entry.avatarIndex : null
      };
    });
  }

  log(msg, type = 'info') {
    const prefix = this.isHost ? '[CREATOR]' : '[CLIENT]';
    const style = type === 'error' ? 'color: red' : type === 'warn' ? 'color: orange' : 'color: green';
    console.log(`%c${prefix} ${msg}`, style);
  }

  emitConnectionStatus(connected, message) {
    if (!this.callback || this.wasKicked) return;
    const statusKey = `${connected ? '1' : '0'}:${message || ''}`;
    if (statusKey === this.lastConnectionStatusKey) return;
    this.lastConnectionStatusKey = statusKey;
    this.callback('connection-status', { connected: !!connected, message: message || '' });
  }

  isConnected() {
    return !!(this.socket && this.socket.connected);
  }

  connectSocket() {
    this.log(`Connecting to server: ${SERVER_URL}`);
    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      const isReconnect = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.hasShownInitialConnectError = false;
      this.log(`Connected to server (id: ${this.socket.id})`);
      if (isReconnect) {
        this.emitConnectionStatus(true, 'Reconnected to game server.');
      }
    });

    this.socket.on('connect_error', (err) => {
      this.log(`Connection error: ${err.message}`, 'error');
      if (!this.hasConnectedOnce) {
        if (!this.hasShownInitialConnectError && this.callback) {
          this.hasShownInitialConnectError = true;
          this.callback('error', { message: 'Cannot connect to game server. Please try again.' });
        }
        return;
      }

      this.emitConnectionStatus(false, 'Lost connection to server. Reconnecting...');
    });

    this.socket.on('error-msg', (data) => {
      this.log(`Server error: ${data.message}`, 'error');
      if (this.callback) {
        this.callback('error', data);
      }
    });
  }

  // Register all gameplay event listeners (shared by both host and join)
  _registerGameplayListeners(callback) {
    this.socket.on('game-start', (data) => {
      this.log('=== GAME START RECEIVED ===');
      this.log(`Local player ID: ${data.localId}`);
      this.log(`Player index: ${data.playerIndex}`);
      this.localPlayerId = data.localId;
      callback('game-start', data);
    });

    this.socket.on('state-update', (data) => {
      callback('state-update', data);
    });

    this.socket.on('global-news', (data) => {
      callback('global-news', data);
    });

    this.socket.on('animation', (data) => {
      callback('animation', data);
    });

    this.socket.on('chat', (msg) => {
      callback('chat', msg);
    });

    this.socket.on('kicked', (data) => {
      this.wasKicked = true;
      callback('kicked', data);
    });

    this.socket.on('disconnect', (reason) => {
      this.log(`Disconnected from server (${reason || 'unknown'})`, 'warn');
      this.emitConnectionStatus(false, 'Lost connection to server. Reconnecting...');
    });
  }

  // Register lobby event listeners (shared by both host and join)
  _registerLobbyListeners(callback) {
    this.socket.on('joined', (data) => {
      this.log(`Joined room with players: ${(data.players || []).join(', ')}`);
      if (data.clientId) this.persistClientId(data.clientId);
      if (typeof data.isHost === 'boolean') this.isHost = data.isHost;
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
  }

  host(name, callback) {
    this.isHost = true;
    this.playerName = name;
    this.callback = callback;
    this.wasKicked = false;
    this.hasConnectedOnce = false;
    this.hasShownInitialConnectError = false;
    this.lastConnectionStatusKey = null;
    this.players = [{ name, clientId: this.clientId, playerId: null, connected: true }];

    this.connectSocket();

    this.socket.on('connect', () => {
      if (this.roomCode) {
        this.log(`Rejoining room: ${this.roomCode}`);
        this.socket.emit('join-room', {
          code: this.roomCode,
          name,
          clientId: this.clientId
        });
        return;
      }
      this.socket.emit('create-room', { name, clientId: this.clientId });
    });

    this.socket.on('room-created', (data) => {
      this.log(`Room created: ${data.code}`);
      this.roomCode = data.code;
      if (data.clientId) this.persistClientId(data.clientId);
      if (typeof data.isHost === 'boolean') this.isHost = data.isHost;
      this.setPlayers(data.players, data.participants);
      callback('room-created', {
        code: data.code,
        players: this.players.map(p => p.name),
        participants: this.players
      });
    });

    this._registerLobbyListeners(callback);
    this._registerGameplayListeners(callback);
  }

  join(name, code, callback) {
    this.isHost = false;
    this.playerName = name;
    this.roomCode = code.toUpperCase().trim();
    this.callback = callback;
    this.wasKicked = false;
    this.hasConnectedOnce = false;
    this.hasShownInitialConnectError = false;
    this.lastConnectionStatusKey = null;

    this.connectSocket();

    this.socket.on('connect', () => {
      this.log(`Joining room: ${this.roomCode}`);
      this.socket.emit('join-room', {
        code: this.roomCode,
        name,
        clientId: this.clientId
      });
    });

    this._registerLobbyListeners(callback);
    this._registerGameplayListeners(callback);
  }

  startGame(mapId = 'classic') {
    this.log('=== startGame() called ===');

    if (!this.isHost) {
      this.log('ERROR: Only room creator can start the game', 'error');
      return;
    }

    if (this.players.length < 2) {
      this.log('ERROR: Need at least 2 players to start', 'error');
      this.callback('error', { message: 'Need at least 2 players to start the game' });
      return;
    }

    // Server creates the game state — just tell it the map
    this.socket.emit('start-game', { mapId });
    this.log(`Requested game start with map: ${mapId}`);
  }

  sendAction(action) {
    if (!this.socket || !this.socket.connected) {
      this.log('Cannot send action - socket disconnected', 'warn');
      return;
    }
    action.fromPlayerId = this.localPlayerId;
    this.log(`Sending action: ${action.actionType}`);
    this.socket.emit('game-action', action);
  }

  sendChat(msg) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('chat', msg);
    // Socket.IO broadcast excludes sender, so add locally.
    if (this.callback) {
      this.callback('chat', msg);
    }
  }

  updateAvatar(avatarIndex) {
    if (!this.socket) return;
    this.socket.emit('update-avatar', { avatarIndex });
  }

  kickPlayer(playerId) {
    if (!this.isHost || !this.socket || !playerId) return;
    this.socket.emit('kick-player', { playerId });
  }

  destroy() {
    this.log('Destroying network manager');
    this.callback = null;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isHost = false;
    this.players = [];
    this.localPlayerId = null;
    this.roomCode = '';
    this.wasKicked = false;
    this.hasConnectedOnce = false;
    this.hasShownInitialConnectError = false;
    this.lastConnectionStatusKey = null;
  }
}
