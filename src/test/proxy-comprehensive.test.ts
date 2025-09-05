import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';

describe('Comprehensive Proxy Tests', () => {
  let proxyProcess: ChildProcess;
  let testServerProcess: ChildProcess;
  const proxyUrl = 'http://localhost:3000';
  const testServerUrl = 'http://localhost:4000';
  
  // Start both servers before tests
  before(async () => {
    return new Promise<void>((resolve, reject) => {
      // Start test server first
      testServerProcess = spawn('npx', ['tsx', 'src/test/test-server.ts'], {
        env: { ...process.env, TEST_PORT: '4000' }
      });
      
      testServerProcess.stdout?.on('data', (data) => {
        console.log(`[TEST-SERVER] ${data}`);
        if (data.toString().includes('Test server running')) {
          // Start proxy server after test server is ready
          proxyProcess = spawn('npx', ['tsx', 'src/backend/server.ts'], {
            env: { ...process.env, PORT: '3000' }
          });
          
          proxyProcess.stdout?.on('data', (data) => {
            console.log(`[PROXY] ${data}`);
            if (data.toString().includes('API server running')) {
              setTimeout(resolve, 1000); // Give both servers time to fully initialize
            }
          });
          
          proxyProcess.stderr?.on('data', (data) => {
            console.error(`[PROXY ERROR] ${data}`);
          });
        }
      });
      
      testServerProcess.stderr?.on('data', (data) => {
        console.error(`[TEST-SERVER ERROR] ${data}`);
      });
      
      // Timeout if servers don't start
      setTimeout(() => reject(new Error('Servers failed to start')), 10000);
    });
  });
  
  // Kill both servers after tests
  after(() => {
    if (proxyProcess) proxyProcess.kill();
    if (testServerProcess) testServerProcess.kill();
  });
  
  // === HTTP Methods Tests ===
  
  describe('HTTP Methods', () => {
    it('should proxy GET requests', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/get`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'GET request successful');
      assert.strictEqual(data.method, 'GET');
    });
    
    it('should proxy POST requests with JSON body', async () => {
      const testData = { test: 'data', number: 123, nested: { value: true } };
      
      const response = await fetch(`${proxyUrl}/proxy?target=${encodeURIComponent(`${testServerUrl}/test/post`)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData)
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'POST request successful');
      assert.deepStrictEqual(data.received, testData);
    });
    
    it('should proxy PUT requests', async () => {
      const updateData = { name: 'Updated Item', status: 'active' };
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/put/123`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.message.includes('PUT request successful'));
      assert.deepStrictEqual(data.stored, updateData);
    });
    
    it('should proxy PATCH requests', async () => {
      const patchData = { status: 'updated' };
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/patch/123`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchData)
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.message.includes('PATCH request successful'));
      assert.strictEqual(data.updated.status, 'updated');
    });
    
    it('should proxy DELETE requests', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/delete/123`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.message.includes('DELETE request successful'));
      assert.strictEqual(data.existed, true);
    });
    
    it('should proxy HEAD requests', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/head`, {
        method: 'HEAD'
      });
      
      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get('x-custom-header'));
      assert.ok(response.headers.get('x-timestamp'));
    });
    
    it('should proxy OPTIONS requests', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/options`, {
        method: 'OPTIONS'
      });
      
      assert.strictEqual(response.status, 204);
      assert.ok(response.headers.get('access-control-allow-origin'));
      assert.ok(response.headers.get('access-control-allow-methods'));
    });
  });
  
  // === Query Parameters Tests ===
  
  describe('Query Parameters', () => {
    it('should preserve simple query parameters', async () => {
      const params = new URLSearchParams({
        key1: 'value1',
        key2: 'value2',
        number: '42'
      });
      
      const targetUrl = `${testServerUrl}/test/query?${params}`;
      const response = await fetch(`${proxyUrl}/proxy?target=${encodeURIComponent(targetUrl)}`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.query.key1, 'value1');
      assert.strictEqual(data.query.key2, 'value2');
      assert.strictEqual(data.query.number, '42');
      assert.strictEqual(data.count, 3);
    });
    
    it('should handle complex query parameters with special characters', async () => {
      const targetUrl = `${testServerUrl}/test/complex-query?sort=desc&filter=name:test&limit=10&special-key=value%20with%20spaces`;
      const response = await fetch(`${proxyUrl}/proxy?target=${encodeURIComponent(targetUrl)}`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.parsed.sort, 'desc');
      assert.strictEqual(data.parsed.filter, 'name:test');
      assert.strictEqual(data.parsed.limit, 10);
      assert.ok(data.parsed.specialKey);
    });
    
  });
  
  // === Headers Tests ===
  
  describe('Headers', () => {
    it('should forward custom headers', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/headers`, {
        headers: {
          'X-Custom-Header': 'test-value',
          'X-Request-ID': '12345',
          'X-User-Agent': 'proxy-test'
        }
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.customHeaders.includes('x-custom-header'));
      assert.ok(data.customHeaders.includes('x-request-id'));
      assert.ok(data.customHeaders.includes('x-user-agent'));
    });
    
    it('should handle authorization headers', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/auth`, {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'Authorized');
      assert.strictEqual(data.user, 'test-user');
    });
    
    it('should handle unauthorized requests', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/auth`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 401);
      assert.strictEqual(data.error, 'No authorization header');
    });
  });
  
  // === Status Codes Tests ===
  
  describe('Status Codes', () => {
    const testCodes = [200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503];
    
    for (const code of testCodes) {
      it(`should preserve status code ${code}`, async () => {
        const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/status/${code}`);
        
        assert.strictEqual(response.status, code);
        if (code !== 204) { // 204 has no content
          const data = await response.json();
          assert.strictEqual(data.requestedCode, code);
        }
      });
    }
  });
  
  // === Large Payload Tests ===
  
  describe('Large Payloads', () => {
    it('should handle large response payloads', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/large-response?size=500`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.count, 500);
      assert.strictEqual(data.data.length, 500);
    });
    
    it('should handle large request payloads', async () => {
      const largeData = Array(100).fill(0).map((_, i) => ({
        id: i,
        data: 'x'.repeat(1000) // 1KB per item
      }));
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/large-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largeData)
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(parseFloat(data.sizeKB) > 100);
    });
  });
  
  // === Server-Sent Events (SSE) Tests ===
  
  describe('Server-Sent Events', () => {
    it('should proxy SSE streams', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/sse?count=3`);
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/event-stream');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let events = [];
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          const lines = text.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                events.push(data);
              } catch (e) {
                // Not JSON data
              }
            }
          }
        }
      }
      
      assert.ok(events.length >= 3);
      assert.ok(events[0].message.includes('Event'));
    });
  });
  
  // === Redirect Tests ===
  
  describe('Redirects', () => {
    it('should follow internal redirects', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/redirect`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.finalDestination, true);
    });
  });
  
  // === Timeout Tests ===
  
  describe('Timeouts', () => {
    it('should handle slow responses within timeout', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/slow?delay=2000`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.ok(data.message.includes('2000ms'));
    });
    
    // Note: Testing actual timeout (>30s) would make tests too slow
  });
  
  // === CORS Tests ===
  
  describe('CORS', () => {
    it('should add CORS headers to responses', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/cors`, {
        headers: {
          'Origin': 'http://example.com'
        }
      });
      
      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get('access-control-allow-origin'));
      assert.ok(response.headers.get('x-proxy-target'));
      assert.ok(response.headers.get('x-proxy-status'));
    });
  });
  
  // === Chunked Transfer Tests ===
  
  describe('Chunked Transfer', () => {
    it('should handle chunked transfer encoding', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/chunked`);
      const text = await response.text();
      
      assert.strictEqual(response.status, 200);
      assert.ok(text.includes('First chunk'));
      assert.ok(text.includes('Final chunk'));
    });
  });
  
  // === Content Encoding Tests ===
  
  describe('Content Encoding', () => {
    it('should handle UTF-8 content', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/encoding/utf8`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.ok(data.message.includes('你好世界'));
      assert.ok(data.message.includes('🌍'));
    });
    
    it('should handle base64 encoded content', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/encoding/base64`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data, Buffer.from('Hello World').toString('base64'));
    });
    
    it('should handle binary content', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/encoding/binary`);
      const buffer = await response.arrayBuffer();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'application/octet-stream');
      assert.ok(buffer.byteLength > 0);
    });
  });
  
  // === Error Handling Tests ===
  
  describe('Error Handling', () => {
    it('should return 502 for unreachable targets', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=http://non-existent-domain-12345.com/test`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 502);
      assert.strictEqual(data.error, 'Proxy error');
      assert.ok(data.message);
    });
    
    it('should handle 404 responses correctly', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/error?type=not-found`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 404);
      assert.strictEqual(data.type, 'not-found');
    });
    
    it('should handle 500 errors', async () => {
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/error?type=crash`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 500);
      assert.strictEqual(data.type, 'crash');
    });
  });
});