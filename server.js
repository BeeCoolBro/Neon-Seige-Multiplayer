const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('.'));

const rooms = {};
const matchQueues = { 2: [], 3: [], 4: [] };

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function getRoomNames(room) {
  // Returns { playerNum: name } for all joined players
  const names = {};
  room.players.forEach((id, i) => {
    names[i + 1] = room.names[id] || ('PLAYER' + (i + 1));
  });
  return names;
}

io.on('connection', socket => {
  console.log('Player connected:', socket.id);

  socket.on('matchmake', (data) => {
    const max = Math.min(4, Math.max(2, (data && data.max) ? data.max : 2));
    const name = (data && data.name) ? data.name : 'PLAYER';
    socket.matchName = name;

    matchQueues[max] = matchQueues[max].filter(s => s.connected);
    if (!matchQueues[max].find(s => s.id === socket.id)) {
      matchQueues[max].push(socket);
      socket.matchMax = max;
    }

    if (matchQueues[max].length >= max) {
      const players = matchQueues[max].splice(0, max);
      const code = makeRoomCode();
      rooms[code] = { players: [], names: {}, max };
      console.log(`Matched ${max} players in room ${code}`);
      players.forEach(s => s.emit('matched', { code, max }));
    }
  });

  socket.on('cancel-matchmake', () => {
    [2, 3, 4].forEach(n => { matchQueues[n] = matchQueues[n].filter(s => s.id !== socket.id); });
  });

  socket.on('join-room', (data) => {
    const code = typeof data === 'object' ? data.code : data;
    const max = typeof data === 'object' ? (data.max || 2) : 2;
    const name = typeof data === 'object' ? (data.name || 'PLAYER') : 'PLAYER';

    if (!rooms[code]) rooms[code] = { players: [], names: {}, max };
    const room = rooms[code];

    room.players = room.players.filter(id => io.sockets.sockets.has(id));

    if (room.players.length >= room.max) {
      socket.emit('room-full');
      return;
    }

    socket.join(code);
    socket.currentRoom = code;
    room.players.push(socket.id);
    room.names[socket.id] = name;

    const playerNum = room.players.length;
    const total = room.players.length;
    const names = getRoomNames(room);

    socket.emit('joined', { num: playerNum, total, max: room.max, names });
    console.log(`Room ${code} [${room.max}p]: ${name} joined as P${playerNum}`);

    // Tell waiting players someone joined
    socket.to(code).emit('player-joined', { total, max: room.max, names });

    if (total >= room.max) {
      io.to(code).emit('game-ready');
      console.log(`Room ${code}: game ready!`);
    }
  });

  socket.on('leave-room', (code) => {
    if (rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
      delete rooms[code].names[socket.id];
    }
    socket.to(code).emit('partner-left');
    socket.leave(code);
    socket.currentRoom = null;
  });

  socket.on('player-action', (data) => {
    socket.to(data.room).emit('player-action', data);
  });

  socket.on('disconnect', () => {
    [2, 3, 4].forEach(n => { matchQueues[n] = matchQueues[n].filter(s => s.id !== socket.id); });
    const code = socket.currentRoom;
    if (code && rooms[code]) {
      rooms[code].players = rooms[code].players.filter(id => id !== socket.id);
      delete rooms[code].names[socket.id];
      socket.to(code).emit('partner-left');
      if (rooms[code].players.length === 0) {
        setTimeout(() => {
          if (rooms[code] && rooms[code].players.length === 0) {
            delete rooms[code];
          }
        }, 10 * 60 * 1000);
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Neon Siege server on port', process.env.PORT || 3000);
});
