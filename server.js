const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('.'));

// rooms[code] = { players: [socketId, ...], started: bool }
const rooms = {};

io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  socket.on('join-room', (code) => {
    if (!rooms[code]) rooms[code] = { players: [], started: false };
    const room = rooms[code];

    // Allow up to 2 players (reconnect replaces old slot)
    if (room.players.length >= 2) {
      socket.emit('room-full');
      return;
    }

    socket.join(code);
    socket.currentRoom = code;
    room.players.push(socket.id);

    const playerNum = room.players.length;
    socket.emit('joined', playerNum);
    console.log(`Room ${code}: player ${playerNum} joined (started: ${room.started})`);

    // Trigger game-ready when 2 players present
    if (playerNum === 2) {
      io.to(code).emit('game-ready');
      room.started = true;
    }
  });

  socket.on('leave-room', (code) => {
    if (rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
      socket.to(code).emit('partner-left');
    }
    socket.leave(code);
    socket.currentRoom = null;
  });

  socket.on('player-action', (data) => {
    socket.to(data.room).emit('player-action', data);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const code = socket.currentRoom;
    if (code && rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
      socket.to(code).emit('partner-left');
      // Clean up empty rooms after 5 minutes
      if (rooms[code].players.length === 0) {
        setTimeout(() => {
          if (rooms[code] && rooms[code].players.length === 0) {
            delete rooms[code];
            console.log(`Room ${code} cleaned up`);
          }
        }, 5 * 60 * 1000);
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Neon Siege server running on port', process.env.PORT || 3000);
});
