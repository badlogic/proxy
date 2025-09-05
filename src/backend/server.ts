import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { type ClientRequest, type IncomingMessage, ServerResponse } from "http";
import { createProxyMiddleware, type Options as ProxyOptions } from "http-proxy-middleware";
import type { Socket } from "net";
import { URL } from "url";

const app = express();
const port = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV !== "production";

// Proxy configuration
const PROXY_TIMEOUT = 30000; // 30 seconds

app.use(cors());

// Custom logging middleware
app.use((req, res, next) => {
   const start = Date.now();
   const originalEnd = res.end;

   res.end = function (this: Response, ...args: any[]): Response {
      const duration = Date.now() - start;
      if (req.path === "/proxy") {
         console.log(`[PROXY] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
      }
      return originalEnd.apply(this, args as any) as Response;
   };

   next();
});

// Parse JSON only for non-proxy routes
app.use((req, res, next) => {
   if (req.path !== "/proxy") {
      express.json()(req, res, next);
   } else {
      next();
   }
});

app.get("/api/health", (req, res) => {
   res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/api/hello", (req, res) => {
   res.json({ message: "Hello from proxy API!" });
});

// Single proxy endpoint
app.all("/proxy", (req: Request, res: Response, next: NextFunction) => {
   // Handle preflight OPTIONS requests (when browser is checking CORS for the proxy itself)
   if (req.method === "OPTIONS" && !req.query.target) {
      // This is a preflight request to the proxy endpoint itself
      return res.status(204).end();
   }

   const targetUrl = req.query.target as string;

   if (!targetUrl) {
      return res.status(400).json({ error: "Missing target parameter" });
   }

   try {
      new URL(targetUrl);
   } catch (error) {
      return res.status(400).json({ error: "Invalid target URL" });
   }

   console.log(`[PROXY] Proxying request to: ${targetUrl}`);

   const targetUrlParsed = new URL(targetUrl);
   const targetBase = `${targetUrlParsed.protocol}//${targetUrlParsed.host}`;

   const proxyOptions: ProxyOptions = {
      target: targetBase, // Use only the base URL
      changeOrigin: true,
      followRedirects: false,
      timeout: PROXY_TIMEOUT,
      proxyTimeout: PROXY_TIMEOUT,
      secure: false,
      ws: true,

      pathRewrite: (path, req) => {
         // Use the parsed URL from above
         const targetUrlObj = new URL(targetUrl);

         // Get ALL query params from the original request
         const expressReq = req as any;
         const allQueryParams = expressReq.query || {};

         // Start with target URL's existing params
         const combinedParams = new URLSearchParams(targetUrlObj.search);

         // Add all query params EXCEPT 'target'
         for (const [key, value] of Object.entries(allQueryParams)) {
            if (key !== "target" && !combinedParams.has(key)) {
               combinedParams.set(key, String(value));
            }
         }

         const queryString = combinedParams.toString();
         return targetUrlObj.pathname + (queryString ? `?${queryString}` : "");
      },

      on: {
         error: (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
            console.error("[PROXY ERROR]", err.message);

            if (res instanceof ServerResponse && !res.headersSent) {
               res.writeHead(502, { "Content-Type": "application/json" });
               res.end(
                  JSON.stringify({
                     error: "Proxy error",
                     message: err.message,
                     target: targetUrl,
                  }),
               );
            }
         },

         proxyReq: (proxyReq: ClientRequest, req: IncomingMessage) => {
            if (isDevelopment) {
               console.log(`[PROXY REQ] ${req.method} -> ${targetUrl}`);
            }

            // Remove headers that might cause issues when forwarding
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");

            // Add forwarding headers
            proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
         },

         proxyRes: (proxyRes: IncomingMessage) => {
            if (isDevelopment) {
               console.log(`[PROXY RES] ${proxyRes.statusCode} from ${targetUrl}`);
            }

            // Add CORS headers
            if (!proxyRes.headers["access-control-allow-origin"]) {
               proxyRes.headers["access-control-allow-origin"] = "*";
            }
         },
      },

      logger: isDevelopment ? console : undefined,
   };

   const proxy = createProxyMiddleware(proxyOptions);
   proxy(req, res, next);
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
   console.error("API Error:", err);

   const status = (err as any).status || 500;
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
   console.log(`Usage: http://localhost:${port}/proxy?target=<url>`);
});
