const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('.'));

const rooms = {};
let matchQueue = []; // sockets waiting for a match

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  // ── MATCHMAKING ──────────────────────────────────────────
  socket.on('matchmake', () => {
    // Remove any stale entries from the queue first
    matchQueue = matchQueue.filter(s => s.connected);

    if (matchQueue.length > 0) {
      // Pair with the first waiting player
      const partner = matchQueue.shift();
      const code = makeRoomCode();
      console.log(`Matched ${socket.id} with ${partner.id} in room ${code}`);
      // Tell both players the room code — they'll each emit join-room
      socket.emit('matched', code);
      partner.emit('matched', code);
    } else {
      // No one waiting — join the queue
      matchQueue.push(socket);
      console.log(`${socket.id} added to matchmaking queue (${matchQueue.length} waiting)`);
    }
  });

  socket.on('cancel-matchmake', () => {
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
    console.log(`${socket.id} cancelled matchmaking`);
  });

  // ── ROOM JOINING ─────────────────────────────────────────
  socket.on('join-room', (code) => {
    if (!rooms[code]) rooms[code] = { players: [] };
    const room = rooms[code];

    // Remove stale disconnected entries
    room.players = room.players.filter(id => io.sockets.sockets.has(id));

    if (room.players.length >= 2) {
      socket.emit('room-full');
      return;
    }

    socket.join(code);
    socket.currentRoom = code;
    room.players.push(socket.id);

    const playerNum = room.players.length;
    socket.emit('joined', playerNum);
    console.log(`Room ${code}: player ${playerNum} joined`);

    if (playerNum === 2) {
      io.to(code).emit('game-ready');
      console.log(`Room ${code}: game ready!`);
    }
  });

  socket.on('leave-room', (code) => {
    if (rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
    }
    socket.to(code).emit('partner-left');
    socket.leave(code);
    socket.currentRoom = null;
  });

  socket.on('player-action', (data) => {
    socket.to(data.room).emit('player-action', data);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    // Remove from matchmaking queue if waiting
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
    const code = socket.currentRoom;
    if (code && rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
      socket.to(code).emit('partner-left');
      if (rooms[code].players.length === 0) {
        setTimeout(() => {
          if (rooms[code] && rooms[code].players.length === 0) {
            delete rooms[code];
            console.log(`Room ${code} cleaned up`);
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Neon Siege server on port', process.env.PORT || 3000);
});
