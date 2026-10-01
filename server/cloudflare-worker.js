// 中繼伺服器（Cloudflare Workers ＋ Durable Objects 版，docs/08 §3.2 推薦方案）
// 和 server/relay.mjs 行為相同：每個房間一個 Durable Object，只轉發訊息
// 部署：需要 Cloudflare 帳號；`npx wrangler deploy -c server/wrangler.toml`
export class Room {
  constructor(state) {
    this.state = state;
    this.peers = new Set();
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (this.peers.size >= 16) return new Response('room full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.peers.add(server);
    server.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > 256 * 1024) return;
      for (const p of this.peers) if (p !== server) p.send(e.data);
    });
    const bye = () => this.peers.delete(server);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(req, env) {
    const m = /^\/room\/([A-Za-z0-9_-]{1,32})/.exec(new URL(req.url).pathname);
    if (!m) return new Response('三國霸業中繼伺服器', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const id = env.ROOMS.idFromName(m[1].toUpperCase());
    return env.ROOMS.get(id).fetch(req);
  },
};
