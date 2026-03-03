export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // /api/* はプロキシ処理
        if (url.pathname.startsWith("/api/")) {
            return handleProxy(request);
        }

        return (
            (await routePartykitRequest(request, { ...env })) ||
            env.ASSETS.fetch(request)
        );
    },
} satisfies ExportedHandler<Env>;

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
