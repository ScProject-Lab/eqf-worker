import {
    type Connection,
    Server,
    type WSMessage,
    routePartykitRequest,
} from "partyserver";
import type { ChatMessage, Message } from "../shared";

export class Chat extends Server<Env> {  // ← export が必要
    static options = { hibernate: true };
    messages = [] as ChatMessage[];
    external?: WebSocket;

    async connectExternal() {
        const response = await fetch("https://ws-api.wolfx.jp/jma_eew", {
            headers: { Upgrade: "websocket" },
        });
        const ws = response.webSocket;
        if (!ws) { console.log("WebSocket upgrade failed"); return; }
        ws.accept();
        this.external = ws;
        ws.addEventListener("message", (event) => {
            this.broadcast(event.data.toString());
        });
        ws.addEventListener("close", () => {
            console.log("external closed, reconnecting...");
            setTimeout(() => this.connectExternal(), 3000);
        });
    }

    broadcastMessage(message: Message, exclude?: string[]) {
        this.broadcast(JSON.stringify(message), exclude);
    }

    async onStart() {
        this.ctx.storage.sql.exec(
            `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
        );
        this.messages = this.ctx.storage.sql
            .exec(`SELECT * FROM messages`)
            .toArray() as ChatMessage[];
        await this.connectExternal();
    }

    onConnect(connection: Connection) {
        connection.send(JSON.stringify({
            type: "all",
            messages: this.messages,
        } satisfies Message));
    }

    saveMessage(message: ChatMessage) {
        const existingMessage = this.messages.find((m) => m.id === message.id);
        if (existingMessage) {
            this.messages = this.messages.map((m) =>
                m.id === message.id ? message : m
            );
        } else {
            this.messages.push(message);
        }
        this.ctx.storage.sql.exec(
            `INSERT INTO messages (id, user, role, content) VALUES ('${message.id}', '${message.user}', '${message.role}', ${JSON.stringify(message.content)}) ON CONFLICT (id) DO UPDATE SET content = ${JSON.stringify(message.content)}`,
        );
    }

    onMessage(connection: Connection, message: WSMessage) {
        this.broadcast(message);
        const parsed = JSON.parse(message as string) as Message;
        if (parsed.type === "add" || parsed.type === "update") {
            this.saveMessage(parsed);
        }
    }
}

// プロキシ用CORSヘッダー
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

async function handleProxy(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    let targetUrl: string | null = null;

    if (path.startsWith("/api/p2pquake")) {
        const params = url.searchParams.toString();
        targetUrl = `https://api.p2pquake.net/v2/history?${params}`;
    } else if (path.startsWith("/api/kyoshin")) {
        const subPath = path.replace("/api/kyoshin", "");
        const t = url.searchParams.get("t") ?? Date.now();
        targetUrl = `https://weather-kyoshin.west.edge.storage-yahoo.jp/RealTimeData${subPath}?${t}`;
    } else {
        return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    const cache = caches.default;
    const cacheKey = new Request(targetUrl);
    const cached = await cache.match(cacheKey);
    if (cached) {
        return new Response(cached.body, {
            headers: { ...Object.fromEntries(cached.headers), ...corsHeaders }
        });
    }

    const upstream = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!upstream.ok) {
        return new Response("Upstream error", { status: upstream.status, headers: corsHeaders });
    }

    const response = new Response(upstream.body, {
        status: upstream.status,
        headers: {
            ...Object.fromEntries(upstream.headers),
            ...corsHeaders,
            "Cache-Control": path.startsWith("/api/p2pquake")
                ? "public, max-age=10"
                : "public, max-age=1",
        }
    });

    await cache.put(cacheKey, response.clone());
    return response;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/")) {
            return handleProxy(request);
        }

        return (
            (await routePartykitRequest(request, { ...env })) ||
            env.ASSETS.fetch(request)
        );
    },
} satisfies ExportedHandler<Env>;
