import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createGameState, GameEngine } from '../js/gameEngine.js';

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  'https://alexander699.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:3000'
];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: ALLOWED_ORIGINS }));

// Room storage: code -> room state
const rooms = new Map();

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const ROOM_TTL = 2 * 60 * 60 * 1000; // 2 hours
const CREATOR_RECONNECT_GRACE_MS = 8000;

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalizeClientId(clientId) {
  if (typeof clientId !== 'string') return null;
  const trimmed = clientId.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function clearRoomTimers(room) {
  if (!room) return;
  if (room.creatorDisconnectTimeout) {
    clearTimeout(room.creatorDisconnectTimeout);
    room.creatorDisconnectTimeout = null;
  }
  for (const timer of room.disconnectSkipTimers.values()) {
    clearTimeout(timer);
  }
  room.disconnectSkipTimers.clear();
}

function orderedMembers(room) {
  const members = Array.from(room.members.values()).filter(m => !m.kicked);
  if (room.started) {
    members.sort((a, b) => (a.playerIndex ?? 999) - (b.playerIndex ?? 999));
  }
  return members;
}

function rosterPayload(room, extra = {}) {
  const members = orderedMembers(room);
  return {
    players: members.map(m => m.name),
    participants: members.map(m => ({
      name: m.name,
      clientId: m.clientId,
      connected: !!m.connected,
      playerId: m.playerId || null,
      playerIndex: Number.isInteger(m.playerIndex) ? m.playerIndex : null,
      avatarIndex: Number.isInteger(m.avatarIndex) ? m.avatarIndex : null
    })),
    ...extra
  };
}

function findMemberBySocketId(room, socketId) {
  for (const member of room.members.values()) {
    if (member.socketId === socketId) return member;
  }
  return null;
}

function findMemberByPlayerId(room, playerId) {
  for (const member of room.members.values()) {
    if (member.playerId === playerId) return member;
  }
  return null;
}

// Strip card decks from state before sending to clients (anti-cheat)
function stripCardDecks(state) {
  const stripped = JSON.parse(JSON.stringify(state));
  stripped.globalNewsDeck = [];
  stripped.diplomaticDeck = [];
  stripped.globalNewsDiscard = [];
  stripped.diplomaticDiscard = [];
  return stripped;
}

// Broadcast state to all connected players in a room
function broadcastStateToAll(room, roomCode) {
  if (!room.engine) return;
  const strippedState = stripCardDecks(room.engine.state);
  for (const member of orderedMembers(room)) {
    if (!member.connected || !member.socketId || member.kicked) continue;
    io.to(member.socketId).emit('state-update', { state: strippedState });
  }
}

// Broadcast animation to players in a room
function broadcastAnimationToAll(room, roomCode, type, data) {
  if (!room.engine) return;

  // Diplomatic Cable cards: only send to the player who drew them
  if (type === 'card' && data && data.deckType !== 'globalNews') {
    const currentPlayer = room.engine.getCurrentPlayer();
    const member = findMemberByPlayerId(room, currentPlayer.id);
    if (member?.connected && member.socketId) {
      io.to(member.socketId).emit('animation', { type, data });
    }
    return;
  }

  // Global News cards: send animation + dedicated global-news event to all
  if (type === 'card' && data && data.deckType === 'globalNews') {
    for (const member of orderedMembers(room)) {
      if (!member.connected || !member.socketId) continue;
      io.to(member.socketId).emit('global-news', { card: data.card });
      io.to(member.socketId).emit('animation', { type, data });
    }
    return;
  }

  // All other animations: broadcast to everyone
  for (const member of orderedMembers(room)) {
    if (!member.connected || !member.socketId) continue;
    io.to(member.socketId).emit('animation', { type, data });
  }
}

// Check if the current player is disconnected and skip their turn
function checkAndSkipDisconnectedTurn(room, roomCode) {
  if (!room.engine || room.engine.state.gameOver) return;
  const currentPlayer = room.engine.getCurrentPlayer();
  if (currentPlayer && currentPlayer.connected === false && !currentPlayer.bankrupt) {
    room.engine.log(`${currentPlayer.name}'s turn auto-skipped (disconnected).`, 'warning');
    room.engine.state.lastDice = null;
    room.engine.nextTurn();
    // The engine.on() callback will broadcast the new state.
    // Check again in case the next player is also disconnected.
    // Use setTimeout to avoid deep recursion.
    setTimeout(() => checkAndSkipDisconnectedTurn(room, roomCode), 100);
  }
}

// Set up engine callbacks for a room
function setupEngineCallbacks(room, roomCode) {
  room.engine.on((engineState) => {
    broadcastStateToAll(room, roomCode);
    // After broadcasting, check if new active player is disconnected
    setTimeout(() => checkAndSkipDisconnectedTurn(room, roomCode), 200);
  });

  room.engine.onAnimation((type, data) => {
    broadcastAnimationToAll(room, roomCode, type, data);
  });
}

// Process a game action from a client
function processGameAction(room, roomCode, senderId, data) {
  const engine = room.engine;
  if (!engine || engine.state.gameOver) return;
  if (!senderId || !data || typeof data.actionType !== 'string') return;

  const activePlayer = engine.getCurrentPlayer();
  if (!activePlayer) return;
  const activePlayerId = activePlayer.id;
  const isValidSpaceId = (spaceId) =>
    Number.isInteger(spaceId) && spaceId >= 0 && spaceId < engine.state.totalSpaces;
  const requiresActiveTurn = () => {
    if (senderId !== activePlayerId) {
      log(`Ignoring turn action ${data.actionType} from non-active player ${senderId} (active: ${activePlayerId})`);
      return false;
    }
    return true;
  };
  const requiresPhase = (expectedPhase) => engine.state.phase === expectedPhase;

  try {
    switch (data.actionType) {
      // --- Turn-based actions (only active player) ---
      case 'roll-dice':
        if (requiresActiveTurn() && requiresPhase('pre-roll')) {
          engine.rollDiceAction();
        }
        break;
      case 'pay-bail':
        if (requiresActiveTurn() && requiresPhase('pre-roll')) {
          engine.payBail(engine.getCurrentPlayer());
        }
        break;
      case 'use-immunity':
        if (requiresActiveTurn() && requiresPhase('pre-roll')) {
          engine.useImmunityCard(engine.getCurrentPlayer());
        }
        break;
      case 'buy-property':
        if (requiresActiveTurn() && requiresPhase('action')) {
          engine.buyProperty(activePlayerId);
        }
        break;
      case 'decline-purchase':
        if (requiresActiveTurn() && requiresPhase('action')) {
          engine.declinePurchase();
        }
        break;
      case 'end-turn':
        if (requiresActiveTurn() && requiresPhase('end-turn')) {
          engine.endTurn();
        }
        break;
      case 'influence-action': {
        if (!requiresActiveTurn()) break;
        if (!['embargo', 'summit', 'development_grant'].includes(data.action)) break;
        if (data.action === 'embargo') {
          if (typeof data.targetId !== 'string' || data.targetId === senderId) break;
          const target = engine.getPlayerById(data.targetId);
          if (!target || target.bankrupt) break;
          engine.useInfluenceAction(senderId, data.action, data.targetId);
          break;
        }
        engine.useInfluenceAction(senderId, data.action);
        break;
      }
      // --- Any-player actions (use sender ID) ---
      case 'propose-trade':
        if (typeof data.partnerId === 'string' && data.partnerId) {
          const offer = data.offer && typeof data.offer === 'object' ? data.offer : {};
          engine.proposeTrade(senderId, data.partnerId, offer);
        }
        break;
      case 'accept-trade':
        if (typeof data.tradeId === 'string' && data.tradeId) {
          engine.acceptTrade(data.tradeId, senderId);
        }
        break;
      case 'reject-trade':
        if (typeof data.tradeId === 'string' && data.tradeId) {
          engine.rejectTrade(data.tradeId, senderId);
        }
        break;
      case 'cancel-trade':
        if (typeof data.tradeId === 'string' && data.tradeId) {
          engine.cancelTrade(data.tradeId, senderId);
        }
        break;
      case 'develop-property':
        if (isValidSpaceId(data.spaceId)) {
          engine.developProperty(senderId, data.spaceId);
        }
        break;
      case 'free-upgrade':
        if (isValidSpaceId(data.spaceId)) {
          engine.freeUpgradeProperty(senderId, data.spaceId);
        }
        break;
      case 'mortgage-property':
        if (isValidSpaceId(data.spaceId)) {
          engine.mortgageProperty(senderId, data.spaceId);
        }
        break;
      case 'unmortgage-property':
        if (isValidSpaceId(data.spaceId)) {
          engine.unmortgageProperty(senderId, data.spaceId);
        }
        break;
      case 'sell-development':
        if (isValidSpaceId(data.spaceId)) {
          engine.sellDevelopment(senderId, data.spaceId);
        }
        break;
      case 'sell-property':
        if (isValidSpaceId(data.spaceId)) {
          engine.sellProperty(senderId, data.spaceId);
        }
        break;
    }
  } catch (error) {
    log(`Error processing action ${data.actionType} in room ${roomCode}: ${error?.message || error}`);
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  log(`Socket connected: ${socket.id}`);
  let currentRoom = null;

  // --- Room creator creates a room ---
  socket.on('create-room', ({ name, clientId }) => {
    const safeName = (name || 'Host').trim().slice(0, 16) || 'Host';
    const resolvedClientId = normalizeClientId(clientId) || `legacy-${socket.id}`;
    const code = generateRoomCode();

    const room = {
      creatorSocketId: socket.id,
      creatorClientId: resolvedClientId,
      members: new Map(),
      started: false,
      createdAt: Date.now(),
      engine: null,
      playerAssignments: new Map(),
      creatorDisconnectTimeout: null,
      disconnectSkipTimers: new Map()
    };

    room.members.set(resolvedClientId, {
      clientId: resolvedClientId,
      name: safeName,
      socketId: socket.id,
      connected: true,
      kicked: false,
      isCreator: true,
      playerId: null,
      playerIndex: null,
      avatarIndex: 0
    });

    rooms.set(code, room);
    currentRoom = code;
    socket.data.clientId = resolvedClientId;
    socket.join(code);

    log(`Room ${code} created by "${safeName}" (${socket.id})`);
    socket.emit('room-created', {
      code,
      clientId: resolvedClientId,
      isHost: true,
      ...rosterPayload(room)
    });
  });

  // --- Client joins or rejoins a room ---
  socket.on('join-room', ({ code, name, clientId }) => {
    const roomCode = (code || '').toUpperCase().trim();
    const room = rooms.get(roomCode);
    const safeName = (name || 'Player').trim().slice(0, 16) || 'Player';
    const resolvedClientId = normalizeClientId(clientId) || `legacy-${socket.id}`;

    if (!room) {
      socket.emit('error-msg', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    const existingSeat = room.members.get(resolvedClientId);
    if (existingSeat?.kicked) {
      socket.emit('error-msg', { message: 'You were removed from this game by the host.' });
      return;
    }

    // Game already started: only reconnect to an existing seat.
    if (room.started) {
      if (!existingSeat) {
        socket.emit('error-msg', {
          message: 'Game already started. Rejoin is only available from the same browser/device.'
        });
        return;
      }

      if (existingSeat.socketId && existingSeat.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingSeat.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      existingSeat.connected = true;
      existingSeat.socketId = socket.id;
      socket.data.clientId = resolvedClientId;
      currentRoom = roomCode;
      socket.join(roomCode);

      // If this is the creator reconnecting, restore their socket
      if (existingSeat.clientId === room.creatorClientId) {
        room.creatorSocketId = socket.id;
        if (room.creatorDisconnectTimeout) {
          clearTimeout(room.creatorDisconnectTimeout);
          room.creatorDisconnectTimeout = null;
        }
      }

      log(`"${existingSeat.name}" rejoined room ${roomCode}`);

      // Send current game state
      const assignment = room.playerAssignments.get(resolvedClientId);
      if (assignment && room.engine) {
        socket.emit('game-start', {
          state: stripCardDecks(room.engine.state),
          localId: assignment.localId,
          playerIndex: assignment.playerIndex,
          rejoined: true
        });

        // Mark player as connected in the engine
        const player = room.engine.getPlayerById(existingSeat.playerId);
        if (player) {
          player.connected = true;
          room.engine.log(`${player.name} reconnected.`, 'success');
          broadcastStateToAll(room, roomCode);
        }
      }

      socket.emit('joined', {
        ...rosterPayload(room),
        rejoined: true,
        clientId: resolvedClientId,
        isHost: room.creatorClientId === resolvedClientId
      });

      socket.to(roomCode).emit('player-joined', {
        ...rosterPayload(room),
        newPlayer: existingSeat.name,
        reconnected: true
      });
      return;
    }

    // Lobby (pre-start) join/rejoin
    if (existingSeat) {
      if (existingSeat.socketId && existingSeat.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingSeat.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      existingSeat.connected = true;
      existingSeat.socketId = socket.id;
      if (existingSeat.clientId === room.creatorClientId) {
        room.creatorSocketId = socket.id;
        if (room.creatorDisconnectTimeout) {
          clearTimeout(room.creatorDisconnectTimeout);
          room.creatorDisconnectTimeout = null;
        }
      }
      socket.data.clientId = resolvedClientId;
      currentRoom = roomCode;
      socket.join(roomCode);

      socket.emit('joined', {
        ...rosterPayload(room),
        rejoined: true,
        clientId: resolvedClientId,
        isHost: room.creatorClientId === resolvedClientId
      });
      socket.to(roomCode).emit('player-joined', {
        ...rosterPayload(room),
        newPlayer: existingSeat.name,
        reconnected: true
      });
      return;
    }

    if (orderedMembers(room).length >= MAX_PLAYERS) {
      socket.emit('error-msg', { message: 'Room is full (max 8 players).' });
      return;
    }

    for (const member of orderedMembers(room)) {
      if (member.name === safeName) {
        socket.emit('error-msg', { message: 'A player with that name is already in the room.' });
        return;
      }
    }

    room.members.set(resolvedClientId, {
      clientId: resolvedClientId,
      name: safeName,
      socketId: socket.id,
      connected: true,
      kicked: false,
      isCreator: false,
      playerId: null,
      playerIndex: null,
      avatarIndex: orderedMembers(room).length
    });

    socket.data.clientId = resolvedClientId;
    currentRoom = roomCode;
    socket.join(roomCode);

    log(`"${safeName}" joined room ${roomCode} (${orderedMembers(room).length} players)`);
    socket.emit('joined', {
      ...rosterPayload(room),
      clientId: resolvedClientId,
      isHost: false
    });
    socket.to(roomCode).emit('player-joined', {
      ...rosterPayload(room),
      newPlayer: safeName
    });
  });

  // --- Player updates their avatar selection (lobby only) ---
  socket.on('update-avatar', ({ avatarIndex }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.started) return;
    const resolvedClientId = socket.data.clientId;
    if (!resolvedClientId) return;
    const member = room.members.get(resolvedClientId);
    if (!member || member.kicked) return;
    if (!Number.isInteger(avatarIndex) || avatarIndex < 0) return;
    member.avatarIndex = avatarIndex;
    // Broadcast updated roster to all players in the room
    io.to(currentRoom).emit('player-joined', {
      ...rosterPayload(room),
      avatarUpdate: true
    });
  });

  // --- Room creator starts the game (server creates the engine) ---
  socket.on('start-game', ({ mapId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.creatorSocketId !== socket.id) return;
    if (room.started) return;

    const members = orderedMembers(room);
    if (members.length < 2) {
      socket.emit('error-msg', { message: 'Need at least 2 players to start.' });
      return;
    }

    const playerNames = members.map(m => m.name);
    const avatarIndices = members.map(m => Number.isInteger(m.avatarIndex) ? m.avatarIndex : 0);
    const state = createGameState(playerNames, mapId || 'classic', avatarIndices);

    // Assign player IDs to members
    room.playerAssignments.clear();
    members.forEach((member, i) => {
      member.playerId = state.players[i].id;
      member.playerIndex = i;
      room.playerAssignments.set(member.clientId, {
        localId: state.players[i].id,
        playerIndex: i,
        name: member.name
      });
    });

    room.engine = new GameEngine(state);
    room.started = true;
    const roomCode = currentRoom;

    // Set up engine callbacks (broadcast state + animations)
    setupEngineCallbacks(room, roomCode);

    log(`Game started in room ${roomCode} (${members.length} players, map: ${mapId || 'classic'})`);

    // Send game-start to each connected player
    const strippedState = stripCardDecks(room.engine.state);
    for (const member of members) {
      if (!member.connected || !member.socketId) continue;
      const assignment = room.playerAssignments.get(member.clientId);
      if (!assignment) continue;
      io.to(member.socketId).emit('game-start', {
        state: strippedState,
        localId: assignment.localId,
        playerIndex: assignment.playerIndex
      });
      log(`Sent game-start to "${member.name}" (index ${assignment.playerIndex})`);
    }
  });

  // --- Clients send actions to server for processing ---
  socket.on('game-action', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.started || !room.engine) return;

    const sender = room.members.get(socket.data.clientId || '');
    if (!sender || sender.kicked || !sender.connected) return;
    if (!data || typeof data !== 'object' || typeof data.actionType !== 'string') return;

    const senderId = sender.playerId;
    if (!senderId) return;

    processGameAction(room, currentRoom, senderId, data);
  });

  // --- Room creator kicks a player ---
  socket.on('kick-player', ({ playerId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.creatorSocketId !== socket.id || !room.started || !playerId) return;

    const target = Array.from(room.members.values()).find(m =>
      !m.isCreator && !m.kicked && m.playerId === playerId
    );
    if (!target) return;

    target.kicked = true;
    target.connected = false;
    const targetSocketId = target.socketId;
    target.socketId = null;

    log(`Creator kicked "${target.name}" from room ${currentRoom}`);

    // Handle in the engine
    if (room.engine) {
      const player = room.engine.getPlayerById(playerId);
      if (player && !player.bankrupt) {
        const wasCurrentTurn = room.engine.getCurrentPlayer().id === player.id;
        player.connected = false;
        room.engine.declareBankruptcy(player);
        if (wasCurrentTurn && !room.engine.state.gameOver) {
          room.engine.state.lastDice = null;
          room.engine.nextTurn();
        }
      }
    }

    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked', { message: 'You were removed by the host.' });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.disconnect(true);
    }

    io.to(currentRoom).emit('player-left', {
      ...rosterPayload(room),
      leftPlayer: target.name,
      kicked: true
    });
  });

  // --- Chat ---
  socket.on('chat', (msg) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const sender = room.members.get(socket.data.clientId || '');
    if (!sender || sender.kicked) return;

    const rawText = typeof msg === 'string'
      ? msg
      : (msg && typeof msg === 'object' && typeof msg.text === 'string' ? msg.text : '');
    const text = rawText.trim().slice(0, 200);
    if (!text) return;

    let color = '#ffffff';
    if (room.engine && sender.playerId) {
      const player = room.engine.getPlayerById(sender.playerId);
      if (player?.color) color = player.color;
    }

    const payload = {
      name: sender.name,
      color,
      text,
      time: Date.now()
    };

    socket.to(currentRoom).emit('chat', payload);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    log(`Socket disconnected: ${socket.id}`);

    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const clientId = socket.data.clientId;
    const member = (clientId && room.members.get(clientId)) || findMemberBySocketId(room, socket.id);
    if (!member) return;

    // Ignore stale disconnects from superseded sockets.
    if (member.socketId && member.socketId !== socket.id) return;

    member.connected = false;
    member.socketId = null;

    const isCreator = member.clientId === room.creatorClientId;
    if (isCreator) {
      room.creatorSocketId = null;
    }

    if (room.started) {
      if (member.kicked) return;

      log(`"${member.name}" disconnected from active room ${currentRoom}`);

      // Handle in the engine
      if (room.engine && member.playerId) {
        const player = room.engine.getPlayerById(member.playerId);
        if (player && !player.bankrupt) {
          player.connected = false;
          room.engine.log(`${player.name} disconnected.`, 'warning');

          // If it was their turn, skip it
          if (room.engine.getCurrentPlayer().id === player.id && !room.engine.state.gameOver) {
            room.engine.log(`${player.name}'s turn skipped (disconnected).`, 'warning');
            room.engine.state.lastDice = null;
            room.engine.nextTurn();
          } else {
            // Still broadcast the updated connectivity state
            broadcastStateToAll(room, currentRoom);
          }
        }
      }

      // Notify remaining players
      io.to(currentRoom).emit('player-left', {
        ...rosterPayload(room),
        leftPlayer: member.name,
        disconnected: true
      });

      // Check if ALL players are disconnected — keep room alive, engine persists on server
      const anyConnected = Array.from(room.members.values()).some(m => m.connected && !m.kicked);
      if (!anyConnected) {
        log(`All players disconnected from room ${currentRoom} — room kept alive for reconnect`);
      }
      return;
    }

    // Lobby phase
    if (isCreator) {
      // Creator left the lobby — wait briefly then close
      const roomCode = currentRoom;
      log(`Creator "${member.name}" disconnected from lobby ${roomCode} - waiting ${CREATOR_RECONNECT_GRACE_MS}ms`);
      room.creatorDisconnectTimeout = setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r || r.creatorSocketId) return;
        log(`Creator "${member.name}" did not return to lobby ${roomCode} - closing room`);
        io.to(roomCode).emit('error-msg', {
          message: 'Host disconnected. The lobby has been closed.'
        });
        clearRoomTimers(r);
        rooms.delete(roomCode);
      }, CREATOR_RECONNECT_GRACE_MS);
      return;
    }

    // Non-creator left the lobby — remove them
    room.members.delete(member.clientId);
    log(`"${member.name}" left room ${currentRoom} (${orderedMembers(room).length} players remain)`);
    io.to(currentRoom).emit('player-left', {
      ...rosterPayload(room),
      leftPlayer: member.name
    });

    if (room.members.size === 0) {
      clearRoomTimers(room);
      rooms.delete(currentRoom);
      log(`Room ${currentRoom} deleted (empty)`);
    }
  });
});

// Clean up stale rooms every 5 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL) {
      log(`Cleaning up stale room ${code}`);
      io.to(code).emit('error-msg', { message: 'Room expired due to inactivity.' });
      clearRoomTimers(room);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
