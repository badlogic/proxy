import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { type ChildProcess, spawn } from "child_process";

describe("Proxy Server Tests", () => {
   let serverProcess: ChildProcess;
   const serverUrl = "http://localhost:3000";

   // Start server before tests
   before(async () => {
      return new Promise<void>((resolve) => {
         serverProcess = spawn("npx", ["tsx", "src/backend/server.ts"], {
            env: { ...process.env, PORT: "3000" },
         });

         serverProcess.stdout?.on("data", (data) => {
            if (data.toString().includes("API server running")) {
               setTimeout(resolve, 1000); // Give server time to fully initialize
            }
         });

         serverProcess.stderr?.on("data", (data) => {
            console.error(`Server error: ${data}`);
         });
      });
   });

   // Kill server after tests
   after(() => {
      if (serverProcess) {
         serverProcess.kill();
      }
   });

   it("should return health status", async () => {
      const response = await fetch(`${serverUrl}/api/health`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.status, "healthy");
      assert.ok(data.timestamp);
   });

   it("should proxy GET requests", async () => {
      // Test with httpbin.org
      const targetUrl = "https://httpbin.org/get";
      const response = await fetch(`${serverUrl}/proxy?target=${encodeURIComponent(targetUrl)}`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok(data.url);
      assert.ok(data.headers);
   });

   it("should proxy POST requests with body", async () => {
      const targetUrl = "https://httpbin.org/post";
      const testData = { test: "data", number: 123 };

      const response = await fetch(`${serverUrl}/proxy?target=${encodeURIComponent(targetUrl)}`, {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
         },
         body: JSON.stringify(testData),
      });

      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.json);
   });

   it("should handle invalid URLs gracefully", async () => {
      const response = await fetch(`${serverUrl}/proxy?target=not-a-valid-url`);
      const data = await response.json();

      assert.strictEqual(response.status, 400);
      assert.ok(data.error);
   });

   it("should handle proxy errors", async () => {
      const targetUrl = "http://non-existent-domain-12345.com";
      const response = await fetch(`${serverUrl}/proxy?target=${encodeURIComponent(targetUrl)}`);
      const data = await response.json();

      assert.strictEqual(response.status, 502);
      assert.ok(data.error);
      assert.strictEqual(data.error, "Proxy error");
   });
});
