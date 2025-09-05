import express, { Request, Response } from "express";
import { IncomingHttpHeaders } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";

const app = express();
const port = process.env.TEST_PORT || 4000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const uploadDir = path.join(os.tmpdir(), 'proxy-test-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 10 // max 10 files
  }
});

// Store for testing stateful operations
const dataStore: Record<string, any> = {};

// Helper to echo back request details
function getRequestInfo(req: Request) {
   return {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      body: req.body,
      timestamp: new Date().toISOString(),
   };
}

// === Basic HTTP Methods ===

app.get("/test/get", (req, res) => {
   res.json({
      message: "GET request successful",
      ...getRequestInfo(req),
   });
});

app.post("/test/post", (req, res) => {
   res.json({
      message: "POST request successful",
      received: req.body,
      ...getRequestInfo(req),
   });
});

app.put("/test/put/:id", (req, res) => {
   const { id } = req.params;
   dataStore[id] = req.body;
   res.json({
      message: `PUT request successful for id: ${id}`,
      stored: dataStore[id],
      ...getRequestInfo(req),
   });
});

app.patch("/test/patch/:id", (req, res) => {
   const { id } = req.params;
   dataStore[id] = { ...(dataStore[id] || {}), ...req.body };
   res.json({
      message: `PATCH request successful for id: ${id}`,
      updated: dataStore[id],
      ...getRequestInfo(req),
   });
});

app.delete("/test/delete/:id", (req, res) => {
   const { id } = req.params;
   const existed = id in dataStore;
   delete dataStore[id];
   res.json({
      message: `DELETE request successful for id: ${id}`,
      existed,
      ...getRequestInfo(req),
   });
});

app.head("/test/head", (req, res) => {
   res.set({
      "X-Custom-Header": "head-response",
      "X-Timestamp": new Date().toISOString(),
   });
   res.end();
});

app.options("/test/options", (req, res) => {
   res.set({
      Allow: "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
   });
   res.json({ message: "OPTIONS request successful" });
});

// === Query Parameters Testing ===

app.get("/test/query", (req, res) => {
   res.json({
      message: "Query parameters received",
      query: req.query,
      count: Object.keys(req.query).length,
   });
});

app.get("/test/complex-query", (req, res) => {
   // Test with arrays and special characters
   const { sort, filter, limit, "special-key": specialKey } = req.query;
   res.json({
      message: "Complex query test",
      parsed: {
         sort,
         filter,
         limit: limit ? parseInt(limit as string) : undefined,
         specialKey,
      },
      raw: req.query,
   });
});

// === Header Testing ===

app.get("/test/headers", (req, res) => {
   res.json({
      message: "Headers received",
      headers: req.headers,
      customHeaders: Object.keys(req.headers).filter((h) => h.startsWith("x-")),
   });
});

app.get("/test/auth", (req, res) => {
   const auth = req.headers.authorization;
   if (!auth) {
      res.status(401).json({ error: "No authorization header" });
      return;
   }

   if (auth === "Bearer valid-token") {
      res.json({ message: "Authorized", user: "test-user" });
   } else {
      res.status(403).json({ error: "Invalid token" });
   }
});

// === Content Type Testing ===

app.post("/test/form", express.urlencoded({ extended: true }), (req, res) => {
   res.json({
      message: "Form data received",
      contentType: req.headers["content-type"],
      formData: req.body,
   });
});

// Multipart form data with file uploads
app.post("/test/multipart", upload.fields([
   { name: 'file', maxCount: 1 },
   { name: 'files', maxCount: 5 },
   { name: 'avatar', maxCount: 1 },
   { name: 'documents', maxCount: 10 }
]), (req, res) => {
   const files = req.files as { [fieldname: string]: Express.Multer.File[] };
   
   // Process uploaded files
   const fileInfo: any = {};
   for (const [fieldName, fileArray] of Object.entries(files || {})) {
      fileInfo[fieldName] = fileArray.map(f => ({
         originalName: f.originalname,
         filename: f.filename,
         mimeType: f.mimetype,
         size: f.size,
         path: f.path
      }));
   }
   
   res.json({
      message: "Multipart data received",
      contentType: req.headers["content-type"],
      fields: req.body, // Non-file form fields
      files: fileInfo,
      totalFiles: Object.values(files || {}).reduce((sum, arr) => sum + arr.length, 0)
   });
});

// Single file upload endpoint
app.post("/test/upload/single", upload.single('file'), (req, res) => {
   if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
   }
   
   res.json({
      message: 'File uploaded successfully',
      file: {
         originalName: req.file.originalname,
         filename: req.file.filename,
         mimeType: req.file.mimetype,
         size: req.file.size,
         path: req.file.path
      },
      fields: req.body
   });
});

// Multiple files upload endpoint
app.post("/test/upload/multiple", upload.array('files', 5), (req, res) => {
   if (!req.files || !Array.isArray(req.files)) {
      return res.status(400).json({ error: 'No files uploaded' });
   }
   
   res.json({
      message: 'Files uploaded successfully',
      count: req.files.length,
      files: req.files.map(f => ({
         originalName: f.originalname,
         filename: f.filename,
         mimeType: f.mimetype,
         size: f.size
      })),
      fields: req.body
   });
});

// Raw binary upload endpoint
app.post("/test/upload/raw", express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
   const buffer = req.body as Buffer;
   
   res.json({
      message: 'Raw binary data received',
      contentType: req.headers['content-type'],
      size: buffer.length,
      first10Bytes: Array.from(buffer.slice(0, 10)),
      isBuffer: Buffer.isBuffer(buffer)
   });
});

// === Status Code Testing ===

app.get("/test/status/:code", (req, res) => {
   const code = parseInt(req.params.code);
   if (code >= 200 && code < 600) {
      res.status(code).json({
         message: `Returning status ${code}`,
         requestedCode: code,
      });
   } else {
      res.status(400).json({ error: "Invalid status code" });
   }
});

// === Redirect Testing ===

app.get("/test/redirect", (req, res) => {
   res.redirect("/test/redirect-target");
});

app.get("/test/redirect-target", (req, res) => {
   res.json({ message: "Redirect successful", finalDestination: true });
});

app.get("/test/redirect-external", (req, res) => {
   res.redirect("https://httpbin.org/get");
});

// === Cookie Testing ===

app.get("/test/cookies/set", (req, res) => {
   res.cookie("test-cookie", "test-value", { httpOnly: true });
   res.cookie("session", "abc123", { maxAge: 900000 });
   res.json({ message: "Cookies set" });
});

app.get("/test/cookies/get", (req, res) => {
   res.json({
      message: "Cookies received",
      cookies: req.headers.cookie,
   });
});

// === Large Payload Testing ===

app.get("/test/large-response", (req, res) => {
   const size = parseInt(req.query.size as string) || 1000;
   const data = Array(size)
      .fill(0)
      .map((_, i) => ({
         id: i,
         value: `Item ${i}`,
         timestamp: Date.now(),
      }));
   res.json({ message: "Large response", count: size, data });
});

app.post("/test/large-upload", (req, res) => {
   const bodySize = JSON.stringify(req.body).length;
   res.json({
      message: "Large upload received",
      sizeBytes: bodySize,
      sizeKB: (bodySize / 1024).toFixed(2),
   });
});

// === Timeout Testing ===

app.get("/test/slow", async (req, res) => {
   const delay = parseInt(req.query.delay as string) || 5000;
   await new Promise((resolve) => setTimeout(resolve, delay));
   res.json({ message: `Response after ${delay}ms delay` });
});

// === Server-Sent Events (SSE) ===

app.get("/test/sse", (req, res) => {
   res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
   });

   let counter = 0;
   const maxEvents = parseInt(req.query.count as string) || 5;

   const interval = setInterval(() => {
      counter++;
      const data = JSON.stringify({
         message: `Event ${counter}`,
         timestamp: new Date().toISOString(),
         counter,
      });

      res.write(`data: ${data}\n\n`);

      if (counter >= maxEvents) {
         clearInterval(interval);
         res.write("event: close\ndata: Stream ended\n\n");
         res.end();
      }
   }, 1000);

   req.on("close", () => {
      clearInterval(interval);
   });
});

// === WebSocket Endpoint Info ===
// Note: WebSocket testing would require a separate ws server setup
app.get("/test/websocket-info", (req, res) => {
   res.json({
      message: "WebSocket endpoint available at ws://localhost:4000/test/ws",
      note: "Requires separate WebSocket server implementation",
   });
});

// === Error Testing ===

app.get("/test/error", (req, res) => {
   const type = req.query.type || "generic";

   switch (type) {
      case "timeout":
         // Intentionally don't respond
         setTimeout(() => {}, 60000);
         break;
      case "crash":
         res.status(500).json({ error: "Internal server error", type: "crash" });
         break;
      case "not-found":
         res.status(404).json({ error: "Not found", type: "not-found" });
         break;
      default:
         res.status(500).json({ error: "Generic error", type });
   }
});

// === Chunked Transfer Testing ===

app.get("/test/chunked", (req, res) => {
   res.setHeader("Transfer-Encoding", "chunked");
   res.setHeader("Content-Type", "text/plain");

   const chunks = ["First chunk\n", "Second chunk\n", "Third chunk\n", "Final chunk\n"];
   let index = 0;

   const sendChunk = () => {
      if (index < chunks.length) {
         res.write(chunks[index]);
         index++;
         setTimeout(sendChunk, 500);
      } else {
         res.end();
      }
   };

   sendChunk();
});

// === CORS Testing ===

app.get("/test/cors", (req, res) => {
   res.set({
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-Custom-Header",
      "X-Custom-Header": "cors-test-value",
   });
   res.json({ message: "CORS headers set", origin: req.headers.origin });
});

// === Encoding Testing ===

app.get("/test/encoding/:type", (req, res) => {
   const { type } = req.params;

   switch (type) {
      case "utf8":
         res.json({ message: "UTF-8 test: 你好世界 🌍 émojis" });
         break;
      case "base64": {
         const data = Buffer.from("Hello World").toString("base64");
         res.json({ message: "Base64 encoded", data });
         break;
      }
      case "binary": {
         const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
         res.set("Content-Type", "application/octet-stream");
         res.send(buffer);
         break;
      }
      default:
         res.json({ message: "Unknown encoding type" });
   }
});

// === Summary Endpoint ===

app.get("/test", (req, res) => {
   res.json({
      message: "Test server is running",
      port,
      endpoints: {
         methods: [
            "GET /test/get",
            "POST /test/post",
            "PUT /test/put/:id",
            "PATCH /test/patch/:id",
            "DELETE /test/delete/:id",
            "HEAD /test/head",
            "OPTIONS /test/options",
         ],
         query: ["GET /test/query?key=value", "GET /test/complex-query?sort=asc&filter=active&limit=10"],
         headers: ["GET /test/headers", "GET /test/auth (requires Authorization header)"],
         status: ["GET /test/status/:code (200-599)"],
         streaming: ["GET /test/sse?count=5", "GET /test/chunked", "GET /test/large-response?size=1000"],
         uploads: [
            "POST /test/multipart (multipart/form-data with files)",
            "POST /test/upload/single (single file)",
            "POST /test/upload/multiple (multiple files)",
            "POST /test/upload/raw (raw binary)"
         ],
         special: [
            "GET /test/slow?delay=5000",
            "GET /test/redirect",
            "GET /test/cors",
            "GET /test/encoding/:type (utf8|base64|binary)",
         ],
      },
   });
});

// Start server
app.listen(port, () => {
   console.log(`Test server running on port ${port}`);
   console.log(`Access test endpoints at http://localhost:${port}/test`);
});
