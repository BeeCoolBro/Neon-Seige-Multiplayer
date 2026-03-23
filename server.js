const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('.'));

const rooms = {}; // roomCode -> [socketId, socketId]

io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  socket.on('join-room', (code) => {
    if (!rooms[code]) rooms[code] = [];

    // Max 2 players per room
    if (rooms[code].length >= 2) {
      socket.emit('room-full');
      return;
    }

    socket.join(code);
    socket.currentRoom = code;
    rooms[code].push(socket.id);

    const playerNum = rooms[code].length;
    socket.emit('joined', playerNum);
    console.log(`Room ${code}: player ${playerNum} joined`);

    // Both players present — start the game
    if (playerNum === 2) {
      io.to(code).emit('game-ready');
      console.log(`Room ${code}: game starting!`);
    }
  });

  socket.on('leave-room', (code) => {
    if (rooms[code]) {
      rooms[code] = rooms[code].filter(id => id !== socket.id);
      socket.to(code).emit('partner-left');
      if (rooms[code].length === 0) delete rooms[code];
    }
    socket.leave(code);
    socket.currentRoom = null;
  });

  // Relay player actions to the other person in the room
  socket.on('player-action', (data) => {
    socket.to(data.room).emit('player-action', data);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const code = socket.currentRoom;
    if (code && rooms[code]) {
      rooms[code] = rooms[code].filter(id => id !== socket.id);
      socket.to(code).emit('partner-left');
      if (rooms[code].length === 0) delete rooms[code];
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Neon Siege server running on port', process.env.PORT || 3000);
});
