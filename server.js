const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve from /public OR root — works either way
const fs = require('fs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  const pub = path.join(__dirname, 'public', 'index.html');
  const root = path.join(__dirname, 'index.html');
  if (fs.existsSync(pub)) res.sendFile(pub);
  else if (fs.existsSync(root)) res.sendFile(root);
  else res.status(404).send('Upload index.html to root or public/ folder.');
});

// ─── GAME STATE ───────────────────────────────────────────────
const rooms = new Map(); // roomCode -> Room

function genCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function makeRoom(hostWs, hostId) {
  let code;
  do { code = 'ETH-' + genCode(); } while (rooms.has(code));

  const room = {
    code,
    players: new Map(), // id -> { ws, x, y, angle, floor, hp, inv, color }
    floor: 0,
    items: buildItems(),
    wardens: buildWardens(0),
    gateOpen: false,
    started: false,
    hostId,
  };

  room.players.set(hostId, {
    ws: hostWs, id: hostId,
    x: 2.5, y: 18.5, angle: 0,
    floor: 0, hp: 3, maxHp: 3,
    inv: [], hasKey: false, hasMKey: false,
    color: '#2255ff', name: 'P1',
  });

  rooms.set(code, room);
  return room;
}

// ─── ITEM / WARDEN TEMPLATES ──────────────────────────────────
function buildItems() {
  return [
    // floor 0
    [
      { id:'key0',   x:10.5, y:9.5,  type:'key',   label:'KEY',        collected:false },
      { id:'note0a', x:3.5,  y:3.5,  type:'note',  label:'NOTE',       collected:false, msg:'Jharbade patrols all night. Stay in shadows.' },
      { id:'note0b', x:20.5, y:5.5,  type:'note',  label:'NOTE',       collected:false, msg:'Elevator is on the south wall. Need key.' },
      { id:'torch0', x:6.5,  y:17.5, type:'torch', label:'TORCH',      collected:false },
      { id:'elev0',  x:22.5, y:18.5, type:'elev',  label:'ELEVATOR',   collected:false },
    ],
    // floor 1
    [
      { id:'key1',   x:11.5, y:9.5,  type:'key',   label:'KEY',        collected:false },
      { id:'note1',  x:2.5,  y:7.5,  type:'note',  label:'NOTE',       collected:false, msg:'Two wardens on this floor. Be very careful.' },
      { id:'boost1', x:18.5, y:13.5, type:'boost', label:'BOOST',      collected:false },
      { id:'elev1',  x:22.5, y:18.5, type:'elev',  label:'ELEVATOR',   collected:false },
    ],
    // floor 2
    [
      { id:'mkey',   x:12.5, y:9.5,  type:'mkey',  label:'MASTER KEY', collected:false },
      { id:'note2',  x:4.5,  y:3.5,  type:'note',  label:'NOTE',       collected:false, msg:'3 wardens. Master key opens the EXIT.' },
      { id:'exit',   x:22.5, y:18.5, type:'exit',  label:'EXIT',       collected:false },
    ],
  ];
}

const PATROL_ROUTES = [
  [ [{x:2,y:6},{x:21,y:6},{x:21,y:9},{x:2,y:9},{x:2,y:12},{x:21,y:12},{x:21,y:18},{x:2,y:18},{x:2,y:6}] ],
  [ [{x:2,y:5},{x:21,y:5},{x:21,y:9},{x:2,y:9},{x:2,y:5}],
    [{x:2,y:14},{x:21,y:14},{x:21,y:18},{x:2,y:18},{x:2,y:14}] ],
  [ [{x:2,y:3},{x:21,y:3},{x:21,y:7},{x:2,y:7},{x:2,y:3}],
    [{x:2,y:11},{x:21,y:11},{x:21,y:15},{x:2,y:15},{x:2,y:11}],
    [{x:2,y:17},{x:21,y:17},{x:21,y:9},{x:2,y:9},{x:2,y:17}] ],
];

function buildWardens(floor) {
  return PATROL_ROUTES[floor].map((patrol, i) => ({
    id: `w${floor}_${i}`,
    x: patrol[0].x + 0.5, y: patrol[0].y + 0.5,
    angle: Math.random() * Math.PI * 2,
    alert: 0, pIdx: 0, patrol, floor,
    stunTimer: 0,
  }));
}

// ─── MAPS (same as client) ────────────────────────────────────
const MAPS = [
  // floor 0
  [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
   [1,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,1,0,1,1,1,0,1,1,0,1,0,1,1,0,1,1,0,1,0,0,1],
   [1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1],
   [1,0,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,0,1,0,1,1],
   [1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,1],
   [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,1],
   [1,0,1,1,0,0,1,0,1,1,1,0,1,0,1,0,1,1,0,0,1,0,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,0,1,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,0,1,1],
   [1,0,1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
   [1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
   [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]],
  // floor 1
  [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
   [1,0,0,0,1,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
   [1,0,1,0,1,0,1,1,0,1,0,1,0,1,0,1,1,0,1,0,1,0,0,1],
   [1,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,1],
   [1,0,1,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,1,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,0,1],
   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]],
  // floor 2
  [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
   [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,1],
   [1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
   [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]],
];

const MAP_W = 24, MAP_H = 20;
function isWall(x, y, floor) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAPS[floor][ty][tx] === 1;
}

// ─── SERVER-SIDE GAME LOOP ────────────────────────────────────
const TICK = 1000 / 20; // 20 ticks/sec
const W_RADIUS = 0.3;

setInterval(() => {
  for (const [code, room] of rooms) {
    if (!room.started || room.players.size === 0) continue;
    tickRoom(room);
  }
}, TICK);

function tickRoom(room) {
  const dt = TICK / 1000;

  // Update wardens
  for (const w of room.wardens) {
    if (w.stunTimer > 0) { w.stunTimer -= dt; continue; }

    // Find closest player on same floor
    let closest = null, closestDist = Infinity;
    for (const p of room.players.values()) {
      if (p.floor !== w.floor || p.hp <= 0) continue;
      const dx = p.x - w.x, dy = p.y - w.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < closestDist) { closestDist = d; closest = p; }
    }

    if (!closest) { patrolWarden(w, dt, room.floor); continue; }

    const dx = closest.x - w.x, dy = closest.y - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const atp = Math.atan2(dy, dx);
    let diff = atp - w.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const VIEW = 7 - room.floor * 0.5;
    const CONE = 0.52 + room.floor * 0.03;
    const spotted = (Math.abs(diff) < CONE && dist < VIEW) || dist < 0.7;

    if (spotted) w.alert = Math.min(1, w.alert + dt * (0.7 + room.floor * 0.2));
    else w.alert = Math.max(0, w.alert - dt * 0.35);

    if (w.alert >= 1 || dist < 0.65) {
      // CATCH
      closest.hp--;
      w.alert = 0;
      closest.x = 2.5; closest.y = 18.5;
      broadcast(room, { type: 'caught', id: closest.id, hp: closest.hp, x: closest.x, y: closest.y });
      if (closest.hp <= 0) {
        broadcast(room, { type: 'dead', id: closest.id });
      }
      continue;
    }

    if (w.alert > 0.45) {
      // Chase
      const spd = (2.0 + room.floor * 0.4) * dt;
      w.angle = atp;
      const mx = (dx / dist) * spd, my = (dy / dist) * spd;
      moveWarden(w, mx, my, room.floor);
    } else {
      patrolWarden(w, dt, room.floor);
    }
  }

  // Broadcast warden positions
  broadcast(room, {
    type: 'wardens',
    wardens: room.wardens.map(w => ({
      id: w.id, x: w.x, y: w.y, angle: w.angle, alert: w.alert
    }))
  });
}

function patrolWarden(w, dt, floor) {
  const t = w.patrol[w.pIdx];
  const tdx = t.x + 0.5 - w.x, tdy = t.y + 0.5 - w.y;
  const td = Math.sqrt(tdx * tdx + tdy * tdy);
  if (td < 0.55) {
    w.pIdx = (w.pIdx + 1) % w.patrol.length;
    return;
  }
  const spd = (1.6 + floor * 0.35) * dt;
  w.angle = Math.atan2(tdy, tdx);
  const mx = (tdx / td) * spd, my = (tdy / td) * spd;
  moveWarden(w, mx, my, floor);
}

function moveWarden(w, mx, my, floor) {
  const canX = !isWall(w.x + mx + W_RADIUS, w.y, floor) &&
               !isWall(w.x + mx - W_RADIUS, w.y, floor) &&
               !isWall(w.x + mx + W_RADIUS, w.y + W_RADIUS, floor) &&
               !isWall(w.x + mx - W_RADIUS, w.y - W_RADIUS, floor);
  const canY = !isWall(w.x, w.y + my + W_RADIUS, floor) &&
               !isWall(w.x, w.y + my - W_RADIUS, floor) &&
               !isWall(w.x + W_RADIUS, w.y + my, floor) &&
               !isWall(w.x - W_RADIUS, w.y + my, floor);
  if (canX) w.x += mx; else w.pIdx = (w.pIdx + 1) % w.patrol.length;
  if (canY) w.y += my; else w.pIdx = (w.pIdx + 1) % w.patrol.length;
}

// ─── BROADCAST ───────────────────────────────────────────────
function broadcast(room, msg, excludeId = null) {
  const str = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === excludeId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(str);
    }
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ─── CONNECTION HANDLER ───────────────────────────────────────
const COLORS = ['#2255ff', '#ff5522', '#22cc55', '#ffcc00', '#ff22cc', '#00ccff'];

wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'host': {
        playerId = 'P1';
        const room = makeRoom(ws, playerId);
        roomCode = room.code;
        ws._roomCode = roomCode;
        ws._playerId = playerId;
        sendTo(ws, { type: 'hosted', code: roomCode, id: playerId });
        console.log(`Room ${roomCode} created`);
        break;
      }

      case 'join': {
        const code = msg.code;
        const room = rooms.get(code);
        if (!room) { sendTo(ws, { type: 'error', msg: 'Room not found!' }); return; }
        if (room.started && room.players.size >= 6) { sendTo(ws, { type: 'error', msg: 'Room full!' }); return; }

        playerId = 'P' + (room.players.size + 1);
        roomCode = code;
        ws._roomCode = code;
        ws._playerId = playerId;

        const color = COLORS[room.players.size % COLORS.length];
        const spawnX = 2.5 + room.players.size * 0.6;
        room.players.set(playerId, {
          ws, id: playerId,
          x: spawnX, y: 18.5, angle: 0,
          floor: 0, hp: 3, maxHp: 3,
          inv: [], hasKey: false, hasMKey: false,
          color, name: msg.name || playerId,
        });

        // Tell the joiner their id + full room state
        const existingPlayers = [...room.players.values()]
          .filter(p => p.id !== playerId)
          .map(p => ({ id: p.id, x: p.x, y: p.y, angle: p.angle, floor: p.floor, color: p.color, name: p.name, hp: p.hp }));

        sendTo(ws, {
          type: 'joined', id: playerId, color,
          players: existingPlayers,
          items: room.items,
          floor: room.floor,
        });

        // Tell everyone else a new player joined
        broadcast(room, {
          type: 'playerJoined',
          player: { id: playerId, x: spawnX, y: 18.5, angle: 0, floor: 0, color, name: msg.name || playerId, hp: 3 }
        }, playerId);

        console.log(`${playerId} joined room ${code}`);
        break;
      }

      case 'start': {
        const room = rooms.get(ws._roomCode);
        if (!room || ws._playerId !== room.hostId) return;
        room.started = true;
        broadcast(room, { type: 'gameStarted', floor: room.floor, items: room.items });
        console.log(`Room ${room.code} game started`);
        break;
      }

      case 'move': {
        const room = rooms.get(ws._roomCode);
        if (!room) return;
        const p = room.players.get(ws._playerId);
        if (!p || p.hp <= 0) return;
        p.x = msg.x; p.y = msg.y; p.angle = msg.angle; p.floor = msg.floor;
        broadcast(room, {
          type: 'playerMoved',
          id: ws._playerId, x: msg.x, y: msg.y, angle: msg.angle, floor: msg.floor
        }, ws._playerId);
        break;
      }

      case 'collectItem': {
        const room = rooms.get(ws._roomCode);
        if (!room) return;
        const p = room.players.get(ws._playerId);
        if (!p) return;
        const floorItems = room.items[msg.floor];
        const item = floorItems && floorItems.find(i => i.id === msg.id);
        if (!item || item.collected) return;
        item.collected = true;

        if (msg.itemType === 'key') p.hasKey = true;
        if (msg.itemType === 'mkey') p.hasMKey = true;

        broadcast(room, { type: 'itemCollected', id: msg.id, floor: msg.floor, by: ws._playerId });
        break;
      }

      case 'floorChange': {
        const room = rooms.get(ws._roomCode);
        if (!room) return;
        const p = room.players.get(ws._playerId);
        if (!p) return;
        const newFloor = msg.floor;
        p.floor = newFloor; p.x = 2.5; p.y = 18.5;
        // If ALL players changed floor, update wardens
        const allOnNewFloor = [...room.players.values()].every(pl => pl.floor === newFloor);
        if (allOnNewFloor) {
          room.floor = newFloor;
          room.wardens = buildWardens(newFloor);
          broadcast(room, { type: 'newFloor', floor: newFloor });
        } else {
          broadcast(room, { type: 'playerFloor', id: ws._playerId, floor: newFloor, x: p.x, y: p.y }, ws._playerId);
        }
        break;
      }

      case 'win': {
        const room = rooms.get(ws._roomCode);
        if (!room) return;
        broadcast(room, { type: 'won', by: ws._playerId });
        break;
      }

      case 'ping': {
        sendTo(ws, { type: 'pong' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.players.delete(playerId);
    broadcast(room, { type: 'playerLeft', id: playerId });
    if (room.players.size === 0) {
      rooms.delete(roomCode);
      console.log(`Room ${roomCode} closed`);
    }
  });

  ws.on('error', () => {});
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏠 Escape the Hostel server running on port ${PORT}`);
});
