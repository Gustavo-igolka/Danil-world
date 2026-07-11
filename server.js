// server.js
// «Мир Данилов 2» — сетевой сервер поверх WebSocket.
// Вся логика правил — в engine.js. Сервер только принимает сообщения от
// клиентов, вызывает методы движка и рассылает персональное состояние каждому.

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Game } = require('./engine');

const PORT = process.env.PORT || 8080;

const game = new Game();
const sockets = new Map(); // playerId -> ws

function broadcastState() {
  for (const [id, ws] of sockets.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    ws.send(JSON.stringify(game.stateFor(id)));
  }
}

function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message }));
}

// --- Простой статический сервер ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // --- присоединение ---
    if (msg.type === 'join') {
      if (player) return; // уже присоединился
      if (game.phase !== 'lobby') { sendError(ws, 'Игра уже началась, дождитесь следующей партии.'); return; }
      player = game.addPlayer(ws, (msg.name || '').trim().slice(0, 24));
      sockets.set(player.id, ws);
      ws.send(JSON.stringify({ type: 'welcome', id: player.id }));
      broadcastState();
      return;
    }

    if (!player) { sendError(ws, 'Сначала подключитесь (join).'); return; }

    let result;
    switch (msg.type) {
      case 'start_game':
        result = game.startGame();
        break;
      case 'pick_boss':
        result = game.pickBoss(player, msg.choice);
        break;
      case 'play_card':
        result = game.playCard(player, {
          cardUid: msg.cardUid,
          purpleUid: msg.purpleUid,
          mainTargets: msg.mainTargets,
          purpleTargets: msg.purpleTargets,
        });
        break;
      case 'activate_judge':
        result = game.activateJudge(player);
        break;
      case 'pass_action':
        result = game.passAction(player);
        break;
      case 'attack':
        result = game.attack(player, { attackerUid: msg.attackerUid, defenderId: msg.defenderId, targetUid: msg.targetUid });
        break;
      case 'skip_attack':
        result = game.skipAttack(player);
        break;
      default:
        return;
    }

    if (result && result.error) sendError(ws, result.error);
    broadcastState();
  });

  ws.on('close', () => {
    if (player) {
      game.removePlayer(player.id);
      sockets.delete(player.id);
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер «Мир Данилов 2» запущен: http://localhost:${PORT}`);
});
