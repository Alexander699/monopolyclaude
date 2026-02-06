// ============================================================
// GLOBAL ECONOMIC WARS - Network Manager (PeerJS WebRTC)
// ============================================================

// Uses PeerJS for WebRTC peer-to-peer connections
// Host acts as authority; clients send actions, host broadcasts state

// PeerJS configuration with multiple ICE/TURN servers for better connectivity
const PEER_CONFIG = {
  debug: 2, // Show warnings and errors
  config: {
    iceServers: [
      // Google STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Twilio STUN
      { urls: 'stun:global.stun.twilio.com:3478' },
      // Free TURN servers from metered.ca
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  }
};

export class NetworkManager {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> connection
    this.isHost = false;
    this.roomCode = '';
    this.playerName = '';
    this.callback = null;
    this.players = []; // Array of {name, peerId, playerId}
    this.localPlayerId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connectionRetryDelay = 2000;
    this.pendingConnections = new Map(); // For tracking connection attempts
    this._keepAliveInterval = null;
    this._gameStartAcked = new Set();
    this._gameStarted = false;
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  log(msg, type = 'info') {
    const prefix = this.isHost ? '[HOST]' : '[CLIENT]';
    const style = type === 'error' ? 'color: red' : type === 'warn' ? 'color: orange' : 'color: green';
    console.log(`%c${prefix} ${msg}`, style);
  }

  host(name, callback) {
    this.isHost = true;
    this.playerName = name;
    this.callback = callback;
    this.roomCode = this.generateRoomCode();
    this.players = [{ name, peerId: null, playerId: null }];

    // Create peer with room code as ID prefix
    const peerId = 'gew-' + this.roomCode;

    this.log(`Creating host with ID: ${peerId}`);

    try {
      this.peer = new Peer(peerId, PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.log(`Host peer opened with ID: ${id}`);
        this.players[0].peerId = id;

        // Start keep-alive pings to prevent connections from going stale
        this._keepAliveInterval = setInterval(() => {
          this.pingAll();
        }, 10000); // Every 10 seconds

        callback('room-created', { code: this.roomCode });
      });

      this.peer.on('connection', (conn) => {
        this.log(`Incoming connection from: ${conn.peer}`);
        this.setupHostConnection(conn);
      });

      this.peer.on('error', (err) => {
        this.log(`Peer error: ${err.type} - ${err.message}`, 'error');
        this.handlePeerError(err, callback);
      });

      this.peer.on('disconnected', () => {
        this.log('Peer disconnected from server, attempting to reconnect...', 'warn');
        this.attemptReconnect();
      });

      this.peer.on('close', () => {
        this.log('Peer connection closed', 'warn');
      });

    } catch (e) {
      this.log(`Failed to create peer: ${e.message}`, 'error');
      callback('error', { message: 'Failed to initialize network. Make sure you have internet connection.' });
    }
  }

  setupHostConnection(conn) {
    const connId = conn.peer;
    this.pendingConnections.set(connId, conn);

    conn.on('open', () => {
      this.log(`Connection opened with: ${connId}`);
      this.pendingConnections.delete(connId);

      conn.on('data', (data) => {
        this.handleHostMessage(conn, data);
      });

      conn.on('error', (err) => {
        this.log(`Connection error with ${connId}: ${err}`, 'error');
      });
    });

    conn.on('close', () => {
      this.log(`Connection closed: ${connId}`);
      this.pendingConnections.delete(connId);
      this.handleDisconnect(conn);
    });

    conn.on('error', (err) => {
      this.log(`Connection error: ${err}`, 'error');
      this.pendingConnections.delete(connId);
    });

    // Connection timeout
    setTimeout(() => {
      if (this.pendingConnections.has(connId)) {
        this.log(`Connection timeout for ${connId}`, 'warn');
        this.pendingConnections.delete(connId);
      }
    }, 30000);
  }

  join(name, code, callback) {
    this.isHost = false;
    this.playerName = name;
    this.roomCode = code.toUpperCase().trim();
    this.callback = callback;

    const peerId = 'gew-' + this.roomCode + '-' + Math.random().toString(36).substr(2, 8);
    const hostId = 'gew-' + this.roomCode;

    this.log(`Creating client peer: ${peerId}`);
    this.log(`Will connect to host: ${hostId}`);

    try {
      this.peer = new Peer(peerId, PEER_CONFIG);

      this.peer.on('open', (id) => {
        this.log(`Client peer opened with ID: ${id}`);
        this.connectToHost(hostId, callback);
      });

      this.peer.on('error', (err) => {
        this.log(`Peer error: ${err.type} - ${err.message}`, 'error');
        this.handlePeerError(err, callback);
      });

      this.peer.on('disconnected', () => {
        this.log('Disconnected from server, attempting to reconnect...', 'warn');
        this.attemptReconnect();
      });

    } catch (e) {
      this.log(`Failed to create peer: ${e.message}`, 'error');
      callback('error', { message: 'Failed to initialize network. Check your internet connection.' });
    }
  }

  connectToHost(hostId, callback, retryCount = 0) {
    this.log(`Attempting to connect to host (attempt ${retryCount + 1})...`);

    const conn = this.peer.connect(hostId, {
      reliable: true,
      serialization: 'json'
    });

    // Connection timeout
    const connectionTimeout = setTimeout(() => {
      if (!this.connections.has('host')) {
        this.log('Connection timeout', 'warn');
        conn.close();

        // Retry logic
        if (retryCount < 3) {
          this.log(`Retrying connection (${retryCount + 2}/4)...`);
          setTimeout(() => {
            this.connectToHost(hostId, callback, retryCount + 1);
          }, this.connectionRetryDelay);
        } else {
          callback('error', {
            message: 'Could not connect to room. The host may not exist, or you may be behind a restrictive firewall. Try using a different network or ask the host to check their connection.'
          });
        }
      }
    }, 15000);

    conn.on('open', () => {
      this.log('Connected to host!');
      clearTimeout(connectionTimeout);
      this.connections.set('host', conn);

      // Send join request
      conn.send({ type: 'join', name: this.playerName, peerId: this.peer.id });
    });

    conn.on('data', (data) => {
      this.handleClientMessage(data);
    });

    conn.on('close', () => {
      this.log('Connection to host closed', 'warn');
      this.connections.delete('host');
      // Use the stored callback (this.callback) instead of the parameter,
      // since the callback may have been updated after game-start
      if (this.callback) {
        this.callback('error', { message: 'Lost connection to host. The game session has ended.' });
      }
    });

    conn.on('error', (err) => {
      this.log(`Connection error: ${err}`, 'error');
      clearTimeout(connectionTimeout);
    });
  }

  handlePeerError(err, callback) {
    let message = 'Connection error';

    switch (err.type) {
      case 'unavailable-id':
        message = 'Room code already in use. Please try creating a new room.';
        break;
      case 'peer-unavailable':
        message = 'Room not found. Check the room code and make sure the host is still online.';
        break;
      case 'network':
        message = 'Network error. Please check your internet connection and try again.';
        break;
      case 'server-error':
        message = 'Connection server is temporarily unavailable. Please try again in a few moments.';
        break;
      case 'socket-error':
        message = 'Socket connection failed. Your firewall may be blocking the connection.';
        break;
      case 'socket-closed':
        message = 'Connection was closed unexpectedly. Please try again.';
        break;
      case 'disconnected':
        message = 'Disconnected from server. Attempting to reconnect...';
        this.attemptReconnect();
        return;
      default:
        message = `Connection error: ${err.type}. Please try again.`;
    }

    callback('error', { message });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.peer && !this.peer.destroyed) {
      this.reconnectAttempts++;
      this.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      setTimeout(() => {
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      }, this.connectionRetryDelay * this.reconnectAttempts);
    } else {
      this.log('Max reconnection attempts reached', 'error');
      if (this.callback) {
        this.callback('error', { message: 'Lost connection to server. Please refresh and try again.' });
      }
    }
  }

  // Host message handling
  handleHostMessage(conn, data) {
    this.log(`Received: ${data.type}`);

    switch (data.type) {
      case 'join':
        this.handlePlayerJoin(conn, data);
        break;

      case 'action':
        // Forward action to game logic
        this.callback('action', data);
        break;

      case 'chat':
        // Broadcast chat to all players
        const chatMsg = { ...data, type: 'chat' };
        this.broadcast(chatMsg);
        this.callback('chat', data);
        break;

      case 'game-start-ack':
        // Client acknowledged receiving game-start
        if (!this._gameStartAcked) this._gameStartAcked = new Set();
        this._gameStartAcked.add(data.name);
        this.log(`Game start acknowledged by: ${data.name}`);
        break;

      case 'ping':
        conn.send({ type: 'pong' });
        break;
    }
  }

  handlePlayerJoin(conn, data) {
    if (this.players.length >= 8) {
      conn.send({ type: 'error', message: 'Room is full (max 8 players)' });
      return;
    }

    // Check for duplicate names
    if (this.players.some(p => p.name === data.name)) {
      conn.send({ type: 'error', message: 'A player with that name is already in the room' });
      return;
    }

    // Add player
    const playerInfo = { name: data.name, peerId: data.peerId, playerId: null };
    this.players.push(playerInfo);
    this.connections.set(data.name, conn);

    this.log(`Player joined: ${data.name} (${this.players.length} players total)`);
    this.log(`Connection stored for: ${data.name}, conn.open: ${conn.open}`);
    this.log(`Total connections in map: ${this.connections.size}`);

    // Send confirmation to joining player
    conn.send({
      type: 'joined',
      players: this.players.map(p => p.name),
      roomCode: this.roomCode
    });

    // Broadcast updated player list to all other players
    this.broadcast({
      type: 'player-joined',
      players: this.players.map(p => p.name),
      newPlayer: data.name
    });

    // Notify host UI
    this.callback('player-joined', { players: this.players.map(p => p.name) });
  }

  // Client message handling
  handleClientMessage(data) {
    this.log(`=== CLIENT received message: ${data.type} ===`);

    switch (data.type) {
      case 'joined':
        this.log(`Joined room with players: ${data.players.join(', ')}`);
        this.callback('joined', { players: data.players });
        break;

      case 'player-joined':
      case 'player-left':
        this.log(`Player list updated: ${data.players.join(', ')}`);
        this.callback(data.type, { players: data.players });
        break;

      case 'game-start':
        // Prevent processing duplicate game-start messages
        if (this._gameStarted) {
          this.log('Ignoring duplicate game-start message');
          break;
        }
        this._gameStarted = true;

        this.log(`=== GAME STARTING ===`);
        this.log(`Local player ID: ${data.localId}`);
        this.log(`Player index: ${data.playerIndex}`);
        this.log(`State has ${data.state?.players?.length || 0} players`);
        this.log(`State board has ${data.state?.board?.length || 0} spaces`);
        this.localPlayerId = data.localId;

        // Send acknowledgement to host
        const hostConn = this.connections.get('host');
        if (hostConn && hostConn.open) {
          hostConn.send({ type: 'game-start-ack', name: this.playerName });
          this.log('Sent game-start-ack to host');
        }

        this.callback('game-start', data);
        break;

      case 'game-start-confirm':
        // Host is confirming game-start was sent - if we haven't received game-start yet, log it
        if (!this._gameStarted) {
          this.log('Received game-start-confirm but no game-start yet - waiting for data...', 'warn');
        }
        break;

      case 'state-update':
        this.callback('state-update', data);
        break;

      case 'chat':
        this.callback('chat', data);
        break;

      case 'error':
        this.callback('error', data);
        break;

      case 'pong':
        // Connection alive
        break;
    }
  }

  handleDisconnect(conn) {
    let disconnectedPlayer = null;

    for (const [name, c] of this.connections) {
      if (c === conn) {
        disconnectedPlayer = name;
        this.connections.delete(name);
        this.players = this.players.filter(p => p.name !== name);
        break;
      }
    }

    if (disconnectedPlayer) {
      this.log(`Player disconnected: ${disconnectedPlayer}`);
      this.broadcast({
        type: 'player-left',
        players: this.players.map(p => p.name),
        leftPlayer: disconnectedPlayer
      });
      this.callback('player-left', { players: this.players.map(p => p.name) });
    }
  }

  broadcast(data, excludePeerId = null) {
    let successCount = 0;
    let failCount = 0;

    for (const [name, conn] of this.connections) {
      if (excludePeerId && conn.peer === excludePeerId) continue;

      try {
        if (conn.open) {
          conn.send(data);
          successCount++;
        } else {
          failCount++;
          this.log(`Connection to ${name} is not open`, 'warn');
        }
      } catch (e) {
        failCount++;
        this.log(`Failed to send to ${name}: ${e.message}`, 'error');
      }
    }

    if (failCount > 0) {
      this.log(`Broadcast: ${successCount} success, ${failCount} failed`, 'warn');
    }
  }

  sendAction(action) {
    if (this.isHost) {
      // Process locally - host handles directly
      return;
    }

    const conn = this.connections.get('host');
    if (conn && conn.open) {
      conn.send({ type: 'action', ...action });
    } else {
      this.log('Cannot send action - not connected to host', 'error');
    }
  }

  sendChat(msg) {
    const chatData = { type: 'chat', ...msg };

    if (this.isHost) {
      this.broadcast(chatData);
      this.callback('chat', msg);
    } else {
      const conn = this.connections.get('host');
      if (conn && conn.open) {
        conn.send(chatData);
      }
    }
  }

  // Strip large card decks from state to reduce message size for WebRTC
  stripCardDecks(state) {
    const stripped = JSON.parse(JSON.stringify(state));
    // Card decks are only needed on the host - clients get card effects via state updates
    stripped.globalNewsDeck = [];
    stripped.diplomaticDeck = [];
    stripped.globalNewsDiscard = [];
    stripped.diplomaticDiscard = [];
    return stripped;
  }

  startGame() {
    this.log('=== startGame() called ===');
    this.log(`isHost: ${this.isHost}`);
    this.log(`players array: ${JSON.stringify(this.players.map(p => p.name))}`);

    if (!this.isHost) {
      this.log('ERROR: Only host can start the game', 'error');
      return;
    }

    if (this.players.length < 2) {
      this.log('ERROR: Need at least 2 players to start', 'error');
      this.callback('error', { message: 'Need at least 2 players to start the game' });
      return;
    }

    this.log(`Starting game with ${this.players.length} players...`);
    this.log(`Connections map size: ${this.connections.size}`);
    this.log(`Connections in map: [${Array.from(this.connections.keys()).join(', ')}]`);

    // Debug: log each connection's state
    for (const [name, conn] of this.connections) {
      this.log(`  - Connection "${name}": open=${conn.open}, peer=${conn.peer}`);
    }

    // Import and create game state
    import('./gameEngine.js').then(({ createGameState }) => {
      this.log('GameEngine imported successfully');

      const playerNames = this.players.map(p => p.name);
      this.log(`Creating game state for players: ${playerNames.join(', ')}`);

      const state = createGameState(playerNames);
      this.log('Game state created');

      // Assign player IDs
      this.players.forEach((playerInfo, i) => {
        playerInfo.playerId = state.players[i].id;
        this.log(`Assigned player ID ${playerInfo.playerId} to ${playerInfo.name}`);
      });

      // First, start game for host (player 0)
      this.localPlayerId = this.players[0].playerId;
      this.log(`Starting game for HOST: ${this.players[0].name} (ID: ${this.localPlayerId})`);

      this.callback('game-start', {
        type: 'game-start',
        state: JSON.parse(JSON.stringify(state)),
        localId: this.players[0].playerId,
        playerIndex: 0
      });

      // Strip card decks to reduce payload size for WebRTC data channels
      const gameStateForClients = this.stripCardDecks(state);
      const stateJson = JSON.stringify(gameStateForClients);
      this.log(`Client state payload size: ${stateJson.length} bytes`);

      this.log(`Sending game-start to ${this.connections.size} client(s)...`);

      for (const [name, conn] of this.connections) {
        // Find the player info for this connection
        const playerInfo = this.players.find(p => p.name === name);

        if (!playerInfo) {
          this.log(`WARNING: No player info found for connection "${name}"`, 'warn');
          continue;
        }

        const playerIndex = this.players.indexOf(playerInfo);

        const gameStartData = {
          type: 'game-start',
          state: gameStateForClients,
          localId: playerInfo.playerId,
          playerIndex: playerIndex
        };

        try {
          if (!conn.open) {
            this.log(`WARNING: Connection to "${name}" is NOT open, attempting to send anyway`, 'warn');
          }
          this.log(`Sending game-start to "${name}" (index: ${playerIndex}, ID: ${playerInfo.playerId}, conn.open: ${conn.open})`);
          conn.send(gameStartData);
          this.log(`SUCCESS: game-start sent to ${name}`);

          // Send a follow-up confirmation ping after a short delay
          // This helps ensure the data channel is flushed
          setTimeout(() => {
            try {
              if (conn.open) {
                conn.send({ type: 'game-start-confirm' });
                this.log(`Sent game-start-confirm to ${name}`);
              }
            } catch (e) {
              this.log(`Failed to send confirm to ${name}: ${e.message}`, 'warn');
            }
          }, 500);

          // Retry game-start after 3 seconds if client hasn't acknowledged
          setTimeout(() => {
            if (conn.open && !this._gameStartAcked?.has(name)) {
              this.log(`Retrying game-start to "${name}" (no ack received)`, 'warn');
              try {
                conn.send(gameStartData);
              } catch (e) {
                this.log(`Retry failed for ${name}: ${e.message}`, 'error');
              }
            }
          }, 3000);
        } catch (e) {
          this.log(`ERROR sending to ${name}: ${e.message}`, 'error');
        }
      }

      this.log('=== Game start complete ===');
    }).catch(err => {
      this.log(`FATAL: Failed to start game: ${err.message}`, 'error');
      console.error(err);
      this.callback('error', { message: 'Failed to initialize game. Please try again.' });
    });
  }

  broadcastState(state) {
    if (!this.isHost) return;

    // Strip card decks to reduce payload size - clients don't need them
    this.broadcast({
      type: 'state-update',
      state: this.stripCardDecks(state)
    });
  }

  // Check if all connections are healthy
  checkConnections() {
    for (const [name, conn] of this.connections) {
      if (!conn.open) {
        this.log(`Connection to ${name} is not healthy`, 'warn');
        return false;
      }
    }
    return true;
  }

  // Send ping to keep connections alive
  pingAll() {
    this.broadcast({ type: 'ping' });
  }

  getConnectionCount() {
    return this.connections.size;
  }

  destroy() {
    this.log('Destroying network manager');

    // Clear keep-alive interval
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }

    // Close all connections
    for (const [, conn] of this.connections) {
      try {
        conn.close();
      } catch (e) {
        // Ignore
      }
    }
    this.connections.clear();

    // Destroy peer
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.peer = null;
    this.players = [];
    this.localPlayerId = null;
  }
}
