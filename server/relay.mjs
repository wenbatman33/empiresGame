#!/usr/bin/env node
// 中繼伺服器（docs/08 §3）：只轉發訊息、管理房間，不跑模擬也不看內容
// 用法：node server/relay.mjs [port]（預設 8787）；客戶端連 ws://主機:8787/room/房間代碼
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
/** 房間代碼 → 連線集合 */
const rooms = new Map();
const MAX_PER_ROOM = 16;
const MAX_MSG = 256 * 1024;

const http = createServer((req, res) => {
  // 健康檢查
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(`三國霸業中繼伺服器：${rooms.size} 個房間\n`);
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });

wss.on('connection', (ws, req) => {
  const m = /^\/room\/([A-Za-z0-9_-]{1,32})/.exec(req.url ?? '');
  if (!m) {
    ws.close(4000, 'bad room');
    return;
  }
  const code = m[1].toUpperCase();
  let room = rooms.get(code);
  if (!room) {
    room = new Set();
    rooms.set(code, room);
  }
  if (room.size >= MAX_PER_ROOM) {
    ws.close(4001, 'room full');
    return;
  }
  room.add(ws);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    // 原樣轉給同房間的其他人
    for (const peer of room) if (peer !== ws && peer.readyState === 1) peer.send(data.toString());
  });
  ws.on('close', () => {
    room.delete(ws);
    if (!room.size) rooms.delete(code);
  });
});

http.listen(PORT, () => console.log(`中繼伺服器啟動：ws://localhost:${PORT}/room/<房間代碼>`));
