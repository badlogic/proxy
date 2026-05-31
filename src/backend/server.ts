import { type ClientRequest, type IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import {
   getRedditCookieHeader,
   getRedditCookieStatus,
   isRedditHost,
   refreshRedditCookies,
   startRedditCookieAutomation,
} from "./reddit-cookies.js";

interface ProxyContext {
   targetUrl: URL;
   finalPath: string;
   isSse: boolean;
}

type ProxyRequest = Request & {
   proxyContext?: ProxyContext;
};

const app = express();
const port = Number(process.env.PORT ?? 3000);
startRedditCookieAutomation();
const isDevelopment = process.env.NODE_ENV !== "production";

const parsedTimeout = Number(process.env.PROXY_TIMEOUT);
const DEFAULT_PROXY_TIMEOUT = Number.isFinite(parsedTimeout) ? parsedTimeout : 30000; // 30s default; set env to override

app.use(
   cors({
      origin: true,
      credentials: true,
   }),
);

// Avoid body parsing for the proxy endpoint so we can stream bodies untouched
app.use((req, res, next) => {
   if (req.path.startsWith("/proxy")) {
      return next();
   }

   express.json({ limit: "1mb" })(req, res, next);
});

// CORS preflight for the proxy endpoint itself
const handleProxyPreflight = (req: Request, res: Response) => {
   const origin = req.headers.origin ?? "*";
   const requestedMethod = req.headers["access-control-request-method"];
   const requestedHeaders = req.headers["access-control-request-headers"];

   res.header("Access-Control-Allow-Origin", origin);
   res.header("Access-Control-Allow-Credentials", "true");
   res.header(
      "Access-Control-Allow-Methods",
      requestedMethod ? String(requestedMethod) : "GET,POST,PUT,PATCH,DELETE,OPTIONS",
   );
   res.header(
      "Access-Control-Allow-Headers",
      requestedHeaders ? String(requestedHeaders) : "Authorization,Content-Type",
   );
   res.header("Access-Control-Max-Age", "86400");
   res.sendStatus(204);
};

app.options("/proxy", handleProxyPreflight);
app.options("/proxy/*", handleProxyPreflight);

app.get("/api/health", (_req, res) => {
   res.json({ status: "healthy", timestamp: new Date().toISOString(), redditCookies: getRedditCookieStatus() });
});

app.post("/api/reddit-cookies/refresh", async (_req, res) => {
   await refreshRedditCookies();
   res.json(getRedditCookieStatus());
});

function resolveRawTarget(req: Request): string | undefined {
   const query = req.query;
   const queryUrl = typeof query.url === "string" ? query.url : undefined;
   const queryTarget = typeof query.target === "string" ? query.target : undefined;
   const headerTarget = req.header("x-proxy-target");
   const params = req.params as Record<string, string | undefined>;
   const wildcardTarget = params?.["0"];

   const candidate = queryUrl ?? queryTarget ?? headerTarget ?? wildcardTarget;
   if (!candidate || !candidate.trim()) {
      return undefined;
   }

   const encodedFlag = Array.isArray(query.encoded)
      ? query.encoded.includes("true")
      : typeof query.encoded === "string" && query.encoded.toLowerCase() === "true";

   if (encodedFlag) {
      try {
         return Buffer.from(candidate.trim(), "base64").toString("utf8");
      } catch {
         // fall back to raw value if decoding fails
      }
   }

   return candidate.trim();
}

function buildFinalPath(targetUrl: URL, originalUrl: string): string {
   const mergedParams = new URLSearchParams(targetUrl.search);
   const queryIndex = originalUrl.indexOf("?");

   if (queryIndex >= 0) {
      const extras = new URLSearchParams(originalUrl.slice(queryIndex + 1));
      extras.forEach((value, key) => {
         if (key === "url" || key === "target" || key === "encoded") {
            return;
         }
         mergedParams.append(key, value);
      });
   }

   const queryString = mergedParams.toString();
   return `${targetUrl.pathname}${queryString ? `?${queryString}` : ""}`;
}

function handleProxy(req: ProxyRequest, res: Response, next: NextFunction): void {
   const rawTarget = resolveRawTarget(req);

   if (!rawTarget) {
      res.status(400).json({ error: "Missing target url" });
      return;
   }

   let targetUrl: URL;
   try {
      targetUrl = new URL(rawTarget);
   } catch {
      res.status(400).json({ error: "Invalid target URL" });
      return;
   }

   const finalPath = buildFinalPath(targetUrl, req.originalUrl);
   const acceptsHeader = String(req.headers.accept || "");
   const isSse = acceptsHeader.split(",").some((part) => part.trim().startsWith("text/event-stream"));

   req.proxyContext = { targetUrl, finalPath, isSse };

   if (isSse) {
      // Keep sockets alive for streaming responses
      req.socket.setTimeout(0);
      req.socket.setKeepAlive(true);
      res.socket?.setTimeout?.(0);
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
   }

   const proxyOptions: ProxyOptions = {
      target: `${targetUrl.protocol}//${targetUrl.host}`,
      changeOrigin: true,
      followRedirects: false,
      secure: false,
      ws: true,
      xfwd: false,
      prependPath: false,
      pathRewrite: () => finalPath,
      logger: isDevelopment ? console : undefined,
      on: {
         proxyReq: (proxyReq: ClientRequest, rawReq: IncomingMessage) => {
            const incomingHeaders = rawReq.headers;
            for (const [headerName, headerValue] of Object.entries(incomingHeaders)) {
               if (headerValue === undefined) {
                  continue;
               }

               // Skip headers that we intentionally override or that reveal proxying
               const lowerHeaderName = headerName.toLowerCase();
               if (
                  lowerHeaderName === "host" ||
                  lowerHeaderName === "connection" ||
                  lowerHeaderName === "origin" ||
                  lowerHeaderName === "referer" ||
                  lowerHeaderName === "forwarded" ||
                  lowerHeaderName === "via" ||
                  lowerHeaderName === "x-real-ip" ||
                  lowerHeaderName.startsWith("x-forwarded-") ||
                  lowerHeaderName.startsWith("x-proxy-") ||
                  lowerHeaderName.startsWith("x-ngrok-")
               ) {
                  continue;
               }

               proxyReq.setHeader(headerName, headerValue);
            }

            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
            proxyReq.removeHeader("forwarded");
            proxyReq.removeHeader("via");
            proxyReq.removeHeader("x-real-ip");
            proxyReq.removeHeader("x-forwarded-for");
            proxyReq.removeHeader("x-forwarded-host");
            proxyReq.removeHeader("x-forwarded-port");
            proxyReq.removeHeader("x-forwarded-proto");
            proxyReq.removeHeader("x-proxy-target");

            proxyReq.setHeader(
               "User-Agent",
               "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            );
            proxyReq.setHeader("Accept", "application/json,text/plain,*/*");
            proxyReq.setHeader("Accept-Language", "en-US,en;q=0.9");

            const expressReq = rawReq as ProxyRequest;
            const targetHost = expressReq.proxyContext?.targetUrl.hostname ?? "";
            if (isRedditHost(targetHost)) {
               const redditCookies = getRedditCookieHeader();
               if (redditCookies) {
                  proxyReq.setHeader("Cookie", redditCookies);
               }
               proxyReq.setHeader(
                  "User-Agent",
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
               );
               proxyReq.setHeader("Sec-CH-UA", '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"');
               proxyReq.setHeader("Sec-CH-UA-Mobile", "?0");
               proxyReq.setHeader("Sec-CH-UA-Platform", '"macOS"');
               proxyReq.setHeader("Sec-Fetch-Dest", "empty");
               proxyReq.setHeader("Sec-Fetch-Mode", "cors");
               proxyReq.setHeader("Sec-Fetch-Site", "same-origin");
            }

            if (expressReq.proxyContext?.isSse) {
               proxyReq.setHeader("Accept", "text/event-stream");
               proxyReq.setHeader("Cache-Control", "no-cache");
            }
         },
         proxyRes: (proxyRes: IncomingMessage, rawReq: IncomingMessage, rawRes: ServerResponse) => {
            const expressReq = rawReq as ProxyRequest;
            const context = expressReq.proxyContext;
            const origin = rawReq.headers.origin ?? "*";

            proxyRes.headers["access-control-allow-origin"] = origin;
            proxyRes.headers["access-control-allow-credentials"] = "true";
            if (!proxyRes.headers["access-control-expose-headers"]) {
               proxyRes.headers["access-control-expose-headers"] = "*";
            }

            rawRes.setHeader("Access-Control-Allow-Origin", origin);
            rawRes.setHeader("Access-Control-Allow-Credentials", "true");
            rawRes.setHeader("Access-Control-Expose-Headers", "*");

            if (context) {
               rawRes.setHeader("x-proxy-target", context.targetUrl.toString());
            }

            if (typeof proxyRes.statusCode === "number") {
               rawRes.setHeader("x-proxy-status", String(proxyRes.statusCode));
            }
         },
         error: (err: Error, rawReq: IncomingMessage, rawRes: ServerResponse | Socket) => {
            const context = (rawReq as ProxyRequest).proxyContext;
            console.error("[PROXY ERROR]", err.message);

            if (rawRes instanceof ServerResponse && !rawRes.headersSent) {
               rawRes.writeHead(502, { "Content-Type": "application/json" });
               rawRes.end(
                  JSON.stringify({
                     error: "Proxy error",
                     message: err.message,
                     url: context?.targetUrl.toString(),
                  }),
               );
            }
         },
      },
   };

   if (!isSse && DEFAULT_PROXY_TIMEOUT > 0) {
      proxyOptions.timeout = DEFAULT_PROXY_TIMEOUT;
      proxyOptions.proxyTimeout = DEFAULT_PROXY_TIMEOUT;
   }

   const proxy = createProxyMiddleware(proxyOptions);
   proxy(req, res, next);
}

app.all("/proxy", handleProxy);
app.all("/proxy/*", handleProxy);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
   console.error("API Error:", err);

   const status = err instanceof Error && "status" in err && typeof err.status === "number" ? err.status : 500;
   const message = isDevelopment ? err.message : "Internal server error";

   res.status(status).json({
      error: message,
      ...(isDevelopment && { stack: err.stack }),
   });
});

// 404 handler
app.use((_req: Request, res: Response) => {
   res.status(404).json({ error: "Endpoint not found" });
});

app.listen(port, () => {
   console.log(`API server running on port ${port}`);
   console.log(`Usage: http://localhost:${port}/proxy?url=<url>`);
});
