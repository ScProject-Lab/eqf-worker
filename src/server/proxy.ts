export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS ヘッダー
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // ルーティング
        // /api/p2pquake  → p2pquake API
        // /api/kyoshin   → Yahoo強震モニタ
        
        let targetUrl: string | null = null;

        if (path.startsWith("/api/p2pquake")) {
            const params = url.searchParams.toString();
            targetUrl = `https://api.p2pquake.net/v2/history?${params}`;
        
        } else if (path.startsWith("/api/kyoshin")) {
            // /api/kyoshin/20240101/20240101120000.json
            const subPath = path.replace("/api/kyoshin", "");
            const t = url.searchParams.get("t") ?? Date.now();
            targetUrl = `https://weather-kyoshin.west.edge.storage-yahoo.jp/RealTimeData${subPath}?${t}`;
        
        } else {
            return new Response("Not Found", { status: 404 });
        }

        // キャッシュ確認
        const cache = caches.default;
        const cacheKey = new Request(targetUrl);
        const cached = await cache.match(cacheKey);
        if (cached) {
            return new Response(cached.body, {
                headers: { ...Object.fromEntries(cached.headers), ...corsHeaders }
            });
        }

        // 上流にフェッチ
        const upstream = await fetch(targetUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        if (!upstream.ok) {
            return new Response("Upstream error", { 
                status: upstream.status, 
                headers: corsHeaders 
            });
        }

        const response = new Response(upstream.body, {
            status: upstream.status,
            headers: {
                ...Object.fromEntries(upstream.headers),
                ...corsHeaders,
                // p2pquakeは10秒、Yahooは1秒キャッシュ
                "Cache-Control": path.startsWith("/api/p2pquake")
                    ? "public, max-age=10"
                    : "public, max-age=1",
            }
        });

        // キャッシュに保存
        await cache.put(cacheKey, response.clone());
        return response;
    }
} satisfies ExportedHandler<Env>;
