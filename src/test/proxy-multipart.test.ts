import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Note: FormData is available globally in Node 18+

describe('Proxy Multipart and File Upload Tests', () => {
  let proxyProcess: ChildProcess;
  let testServerProcess: ChildProcess;
  const proxyUrl = 'http://localhost:3000';
  const testServerUrl = 'http://localhost:4000';
  
  // Create test files
  const testFilesDir = path.join(os.tmpdir(), 'proxy-test-files');
  const testFile1Path = path.join(testFilesDir, 'test1.txt');
  const testFile2Path = path.join(testFilesDir, 'test2.json');
  const testImagePath = path.join(testFilesDir, 'test.png');
  
  before(async () => {
    // Create test files
    if (!fs.existsSync(testFilesDir)) {
      fs.mkdirSync(testFilesDir, { recursive: true });
    }
    
    fs.writeFileSync(testFile1Path, 'Hello, this is test file 1 content!');
    fs.writeFileSync(testFile2Path, JSON.stringify({ test: 'data', value: 123 }));
    
    // Create a small PNG image (1x1 pixel red image)
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x9A, 0x0C, 0x05,
      0x77, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
      0x44, 0xAE, 0x42, 0x60, 0x82  // IEND chunk
    ]);
    fs.writeFileSync(testImagePath, pngBuffer);
    
    return new Promise<void>((resolve, reject) => {
      // Start test server first
      testServerProcess = spawn('npx', ['tsx', 'src/test/test-server.ts'], {
        env: { ...process.env, TEST_PORT: '4000' }
      });
      
      testServerProcess.stdout?.on('data', (data) => {
        if (data.toString().includes('Test server running')) {
          // Start proxy server
          proxyProcess = spawn('npx', ['tsx', 'src/backend/server.ts'], {
            env: { ...process.env, PORT: '3000' }
          });
          
          proxyProcess.stdout?.on('data', (data) => {
            if (data.toString().includes('API server running')) {
              setTimeout(resolve, 1000);
            }
          });
        }
      });
      
      setTimeout(() => reject(new Error('Servers failed to start')), 10000);
    });
  });
  
  after(() => {
    if (proxyProcess) proxyProcess.kill();
    if (testServerProcess) testServerProcess.kill();
    
    // Cleanup test files
    try {
      fs.rmSync(testFilesDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });
  
  describe('Multipart Form Data', () => {
    it('should proxy multipart form data with single file', async () => {
      const formData = new FormData();
      formData.append('username', 'testuser');
      formData.append('email', 'test@example.com');
      
      const fileContent = fs.readFileSync(testFile1Path);
      const file = new File([fileContent], 'test1.txt', { type: 'text/plain' });
      formData.append('file', file);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/upload/single`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'File uploaded successfully');
      assert.ok(data.file);
      assert.strictEqual(data.file.originalName, 'test1.txt');
      assert.strictEqual(data.file.mimeType, 'text/plain');
      assert.strictEqual(data.fields.username, 'testuser');
      assert.strictEqual(data.fields.email, 'test@example.com');
    });
    
    it('should proxy multiple files upload', async () => {
      const formData = new FormData();
      formData.append('description', 'Multiple files test');
      
      const file1 = new File([fs.readFileSync(testFile1Path)], 'test1.txt', { type: 'text/plain' });
      const file2 = new File([fs.readFileSync(testFile2Path)], 'test2.json', { type: 'application/json' });
      
      formData.append('files', file1);
      formData.append('files', file2);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${encodeURIComponent(`${testServerUrl}/test/upload/multiple`)}`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.count, 2);
      assert.ok(data.files);
      assert.strictEqual(data.files.length, 2);
      assert.strictEqual(data.fields.description, 'Multiple files test');
    });
    
    it('should proxy complex multipart with mixed fields and files', async () => {
      const formData = new FormData();
      
      // Add regular fields
      formData.append('title', 'Test Document');
      formData.append('tags', 'test');
      formData.append('tags', 'proxy');
      formData.append('tags', 'multipart');
      formData.append('metadata', JSON.stringify({ version: 1, author: 'test' }));
      
      // Add files to different fields
      const textFile = new File([fs.readFileSync(testFile1Path)], 'document.txt', { type: 'text/plain' });
      const jsonFile = new File([fs.readFileSync(testFile2Path)], 'data.json', { type: 'application/json' });
      const imageFile = new File([fs.readFileSync(testImagePath)], 'image.png', { type: 'image/png' });
      
      formData.append('file', textFile);
      formData.append('documents', jsonFile);
      formData.append('avatar', imageFile);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/multipart`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'Multipart data received');
      assert.ok(data.files);
      assert.ok(data.fields);
      assert.strictEqual(data.totalFiles, 3);
    });
    
    it('should handle large file uploads', async () => {
      // Create a 2MB file
      const largeFilePath = path.join(testFilesDir, 'large.bin');
      const largeBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
      for (let i = 0; i < largeBuffer.length; i++) {
        largeBuffer[i] = Math.floor(Math.random() * 256);
      }
      fs.writeFileSync(largeFilePath, largeBuffer);
      
      const formData = new FormData();
      formData.append('description', 'Large file upload');
      
      const largeFile = new File([largeBuffer], 'large.bin', { type: 'application/octet-stream' });
      formData.append('file', largeFile);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/upload/single`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.file);
      assert.ok(data.file.size >= 2 * 1024 * 1024); // Should be at least 2MB
    });
  });
  
  describe('Raw Binary Upload', () => {
    it('should proxy raw binary data', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD]);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/upload/raw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: binaryData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'Raw binary data received');
      assert.strictEqual(data.size, binaryData.length);
      assert.ok(data.isBuffer);
    });
    
    it('should handle image upload as binary', async () => {
      const imageBuffer = fs.readFileSync(testImagePath);
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/upload/raw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png'
        },
        body: imageBuffer
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.contentType, 'image/png');
      assert.strictEqual(data.size, imageBuffer.length);
      // Check PNG signature
      assert.deepStrictEqual(data.first10Bytes.slice(0, 8), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    });
  });
  
  describe('Form URL Encoded', () => {
    it('should proxy application/x-www-form-urlencoded data', async () => {
      const params = new URLSearchParams();
      params.append('username', 'testuser');
      params.append('password', 'secret123');
      params.append('remember', 'true');
      params.append('tags', 'tag1');
      params.append('tags', 'tag2');
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.message, 'Form data received');
      assert.ok(data.contentType.includes('application/x-www-form-urlencoded'));
      assert.strictEqual(data.formData.username, 'testuser');
      assert.strictEqual(data.formData.password, 'secret123');
      assert.strictEqual(data.formData.remember, 'true');
    });
  });
  
  describe('Content-Type Preservation', () => {
    it('should preserve custom content types', async () => {
      const customData = '<xml><test>data</test></xml>';
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml'
        },
        body: customData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.headers['content-type'].includes('application/xml'));
    });
    
    it('should handle text/plain content', async () => {
      const textData = 'This is plain text data\nWith multiple lines\nAnd special chars: !@#$%^&*()';
      
      const response = await fetch(`${proxyUrl}/proxy?target=${testServerUrl}/test/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: textData
      });
      
      const data = await response.json();
      assert.strictEqual(response.status, 200);
      assert.ok(data.headers['content-type'].includes('text/plain'));
    });
  });
});