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

// Room storage: code -> { host, players, started, createdAt }
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  log(`Socket connected: ${socket.id}`);
  let currentRoom = null;

  // --- Host creates a room ---
  socket.on('create-room', ({ name }) => {
    const code = generateRoomCode();
    const room = {
      host: socket.id,
      players: new Map([[socket.id, { name, playerId: null }]]),
      started: false,
      createdAt: Date.now()
    };
    rooms.set(code, room);
    currentRoom = code;
    socket.join(code);

    log(`Room ${code} created by "${name}" (${socket.id})`);
    socket.emit('room-created', { code });
  });

  // --- Client joins a room ---
  socket.on('join-room', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error-msg', { message: 'Room not found. Check the code and try again.' });
      return;
    }
    if (room.started) {
      socket.emit('error-msg', { message: 'Game has already started.' });
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('error-msg', { message: 'Room is full (max 8 players).' });
      return;
    }

    // Check duplicate names
    for (const [, p] of room.players) {
      if (p.name === name) {
        socket.emit('error-msg', { message: 'A player with that name is already in the room.' });
        return;
      }
    }

    room.players.set(socket.id, { name, playerId: null });
    currentRoom = code;
    socket.join(code);

    const playerNames = Array.from(room.players.values()).map(p => p.name);
    log(`"${name}" joined room ${code} (${playerNames.length} players)`);

    // Tell the joiner they're in
    socket.emit('joined', { players: playerNames });

    // Tell everyone else
    socket.to(code).emit('player-joined', { players: playerNames, newPlayer: name });
  });

  // --- Host starts the game ---
  socket.on('start-game', ({ state, playerAssignments }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    room.started = true;
    log(`Game started in room ${currentRoom}`);

    // Send each client their personalized game-start message
    for (const [sid, playerData] of room.players) {
      if (sid === socket.id) continue; // Skip host - host handles locally

      const assignment = playerAssignments.find(a => a.name === playerData.name);
      if (assignment) {
        io.to(sid).emit('game-start', {
          state,
          localId: assignment.localId,
          playerIndex: assignment.playerIndex
        });
        log(`Sent game-start to "${playerData.name}" (index ${assignment.playerIndex})`);
      }
    }
  });

  // --- Client sends action to host ---
  socket.on('game-action', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.started) return;

    // Relay to host only
    io.to(room.host).emit('game-action', data);
  });

  // --- Host broadcasts state to all clients ---
  socket.on('state-update', ({ state }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    // Send to all others in the room
    socket.to(currentRoom).emit('state-update', { state });
  });

  // --- Chat ---
  socket.on('chat', (msg) => {
    if (!currentRoom) return;
    // Broadcast to everyone else in the room
    socket.to(currentRoom).emit('chat', msg);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    log(`Socket disconnected: ${socket.id}`);

    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.get(socket.id);
    const playerName = player?.name || 'Unknown';
    room.players.delete(socket.id);

    if (socket.id === room.host) {
      // Host left - end the room
      log(`Host "${playerName}" left room ${currentRoom} - closing room`);
      io.to(currentRoom).emit('error-msg', { message: 'Host disconnected. The game session has ended.' });
      rooms.delete(currentRoom);
    } else {
      // Client left
      const playerNames = Array.from(room.players.values()).map(p => p.name);
      log(`"${playerName}" left room ${currentRoom} (${playerNames.length} players remain)`);
      io.to(currentRoom).emit('player-left', { players: playerNames, leftPlayer: playerName });

      // Clean up empty rooms
      if (room.players.size === 0) {
        rooms.delete(currentRoom);
        log(`Room ${currentRoom} deleted (empty)`);
      }
    }
  });
});

// Clean up stale rooms every 5 minutes
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
