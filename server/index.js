const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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
// Room members are keyed by persistent clientId, not socket id,
// so players can reconnect after refresh.
const rooms = new Map();

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const ROOM_TTL = 2 * 60 * 60 * 1000; // 2 hours

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
      playerIndex: Number.isInteger(m.playerIndex) ? m.playerIndex : null
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

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  log(`Socket connected: ${socket.id}`);
  let currentRoom = null;

  // --- Host creates a room ---
  socket.on('create-room', ({ name, clientId }) => {
    const safeName = (name || 'Host').trim().slice(0, 16) || 'Host';
    const resolvedClientId = normalizeClientId(clientId) || `legacy-${socket.id}`;
    const code = generateRoomCode();

    const room = {
      hostSocketId: socket.id,
      hostClientId: resolvedClientId,
      members: new Map(),
      started: false,
      createdAt: Date.now(),
      latestState: null,
      playerAssignments: new Map()
    };

    room.members.set(resolvedClientId, {
      clientId: resolvedClientId,
      name: safeName,
      socketId: socket.id,
      connected: true,
      kicked: false,
      isHost: true,
      playerId: null,
      playerIndex: null
    });

    rooms.set(code, room);
    currentRoom = code;
    socket.data.clientId = resolvedClientId;
    socket.join(code);

    log(`Room ${code} created by "${safeName}" (${socket.id})`);
    socket.emit('room-created', { code, clientId: resolvedClientId, ...rosterPayload(room) });
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

      log(`"${existingSeat.name}" rejoined room ${roomCode}`);
      socket.emit('joined', { ...rosterPayload(room), rejoined: true, clientId: resolvedClientId });

      const assignment = room.playerAssignments.get(resolvedClientId);
      if (assignment && room.latestState) {
        io.to(socket.id).emit('game-start', {
          state: room.latestState,
          localId: assignment.localId,
          playerIndex: assignment.playerIndex,
          rejoined: true
        });
      } else {
        socket.emit('error-msg', { message: 'Reconnected, waiting for host sync...' });
      }

      if (room.hostSocketId && room.hostSocketId !== socket.id) {
        io.to(room.hostSocketId).emit('player-connection', {
          name: existingSeat.name,
          clientId: existingSeat.clientId,
          playerId: existingSeat.playerId,
          connected: true
        });
      }

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
      socket.data.clientId = resolvedClientId;
      currentRoom = roomCode;
      socket.join(roomCode);

      socket.emit('joined', { ...rosterPayload(room), rejoined: true, clientId: resolvedClientId });
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
      isHost: false,
      playerId: null,
      playerIndex: null
    });

    socket.data.clientId = resolvedClientId;
    currentRoom = roomCode;
    socket.join(roomCode);

    log(`"${safeName}" joined room ${roomCode} (${orderedMembers(room).length} players)`);
    socket.emit('joined', { ...rosterPayload(room), clientId: resolvedClientId });
    socket.to(roomCode).emit('player-joined', {
      ...rosterPayload(room),
      newPlayer: safeName
    });
  });

  // --- Host starts the game ---
  socket.on('start-game', ({ state, playerAssignments }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostSocketId !== socket.id) return;

    room.started = true;
    room.latestState = state || null;
    room.playerAssignments.clear();

    if (Array.isArray(playerAssignments)) {
      playerAssignments.forEach((assignment) => {
        if (!assignment || !assignment.clientId) return;
        room.playerAssignments.set(assignment.clientId, {
          localId: assignment.localId,
          playerIndex: assignment.playerIndex,
          name: assignment.name
        });
        const member = room.members.get(assignment.clientId);
        if (member) {
          member.playerId = assignment.localId || null;
          member.playerIndex = Number.isInteger(assignment.playerIndex) ? assignment.playerIndex : null;
        }
      });
    }

    log(`Game started in room ${currentRoom}`);

    // Send each connected non-host player their own assignment.
    for (const member of orderedMembers(room)) {
      if (member.isHost || !member.connected || member.kicked || !member.socketId) continue;
      const assignment = room.playerAssignments.get(member.clientId);
      if (!assignment) continue;
      io.to(member.socketId).emit('game-start', {
        state,
        localId: assignment.localId,
        playerIndex: assignment.playerIndex
      });
      log(`Sent game-start to "${member.name}" (index ${assignment.playerIndex})`);
    }
  });

  // --- Clients send actions to host ---
  socket.on('game-action', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.started) return;

    const sender = room.members.get(socket.data.clientId || '');
    if (!sender || sender.kicked || !sender.connected) return;

    io.to(room.hostSocketId).emit('game-action', data);
  });

  // --- Host broadcasts state to clients ---
  socket.on('state-update', ({ state }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostSocketId !== socket.id) return;

    room.latestState = state || room.latestState;
    socket.to(currentRoom).emit('state-update', { state });
  });

  // --- Host broadcasts Global News ---
  socket.on('global-news', ({ card }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostSocketId !== socket.id) return;

    socket.to(currentRoom).emit('global-news', { card });
  });

  // --- Host broadcasts animation events (for client-side visual sync) ---
  socket.on('animation', ({ type, data }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostSocketId !== socket.id) return;
    socket.to(currentRoom).emit('animation', { type, data });
  });

  // --- Host kicks a player by playerId ---
  socket.on('kick-player', ({ playerId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostSocketId !== socket.id || !room.started || !playerId) return;

    const target = Array.from(room.members.values()).find(m =>
      !m.isHost && !m.kicked && m.playerId === playerId
    );
    if (!target) return;

    target.kicked = true;
    target.connected = false;
    const targetSocketId = target.socketId;
    target.socketId = null;

    log(`Host kicked "${target.name}" from room ${currentRoom}`);

    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked', { message: 'You were removed by the host.' });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.disconnect(true);
    }

    io.to(room.hostSocketId).emit('player-kicked', {
      name: target.name,
      clientId: target.clientId,
      playerId: target.playerId
    });

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

    socket.to(currentRoom).emit('chat', msg);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    log(`Socket disconnected: ${socket.id}`);

    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    if (socket.id === room.hostSocketId) {
      // Host left - end the room.
      const hostName = room.members.get(room.hostClientId)?.name || 'Host';
      log(`Host "${hostName}" left room ${currentRoom} - closing room`);
      io.to(currentRoom).emit('error-msg', {
        message: 'Host disconnected. The game session has ended.'
      });
      rooms.delete(currentRoom);
      return;
    }

    const clientId = socket.data.clientId;
    const member = (clientId && room.members.get(clientId)) || findMemberBySocketId(room, socket.id);
    if (!member) return;

    // Ignore stale disconnects from superseded sockets.
    if (member.socketId && member.socketId !== socket.id) return;

    if (room.started) {
      if (member.kicked) return;

      member.connected = false;
      member.socketId = null;

      log(`"${member.name}" disconnected from active room ${currentRoom}`);
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('player-connection', {
          name: member.name,
          clientId: member.clientId,
          playerId: member.playerId,
          connected: false
        });
      }
      io.to(currentRoom).emit('player-left', {
        ...rosterPayload(room),
        leftPlayer: member.name,
        disconnected: true
      });
      return;
    }

    room.members.delete(member.clientId);
    log(`"${member.name}" left room ${currentRoom} (${orderedMembers(room).length} players remain)`);
    io.to(currentRoom).emit('player-left', {
      ...rosterPayload(room),
      leftPlayer: member.name
    });

    if (room.members.size === 0) {
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
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
