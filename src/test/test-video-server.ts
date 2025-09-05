import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createReadStream, statSync } from 'fs';

const app = express();
const port = process.env.VIDEO_TEST_PORT || 4001;

// Create a fake video file (just binary data for testing)
const videoDir = '/tmp/proxy-test-videos';
const videoPath = path.join(videoDir, 'test-video.mp4');

// Helper to parse range header
function parseRange(range: string | undefined, totalSize: number) {
  if (!range || !range.startsWith('bytes=')) {
    return null;
  }

  const parts = range.replace('bytes=', '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
  
  if (isNaN(start) || isNaN(end) || start > end || start < 0) {
    return null;
  }
  
  return { start, end };
}

// === Video Streaming with Range Support ===

app.get('/video/stream', (req: Request, res: Response) => {
  try {
    // Ensure video file exists
    if (!fs.existsSync(videoPath)) {
      // Create a fake 10MB "video" file
      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }
      
      const size = 10 * 1024 * 1024; // 10MB
      const buffer = Buffer.alloc(1024 * 1024); // 1MB chunks
      
      // Fill with pseudo-random data
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
      }
      
      const stream = fs.createWriteStream(videoPath);
      for (let i = 0; i < 10; i++) {
        stream.write(buffer);
      }
      stream.end();
    }
    
    const stat = statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    console.log(`[VIDEO] Request with range: ${range}`);
    
    if (range) {
      // Parse range header
      const parsedRange = parseRange(range, fileSize);
      
      if (!parsedRange) {
        res.status(416).send('Range Not Satisfiable');
        return;
      }
      
      const { start, end } = parsedRange;
      const chunkSize = (end - start) + 1;
      
      console.log(`[VIDEO] Serving bytes ${start}-${end}/${fileSize}`);
      
      // Send partial content
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache'
      });
      
      // Create read stream with specific range
      const stream = createReadStream(videoPath, { start, end });
      stream.pipe(res);
      
    } else {
      // No range requested, send entire file
      console.log(`[VIDEO] Serving entire file: ${fileSize} bytes`);
      
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });
      
      const stream = createReadStream(videoPath);
      stream.pipe(res);
    }
  } catch (error) {
    console.error('[VIDEO] Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// === Audio Streaming with Range Support ===

app.get('/audio/stream', (req: Request, res: Response) => {
  // Similar to video but with audio mime type
  const audioPath = path.join(videoDir, 'test-audio.mp3');
  
  if (!fs.existsSync(audioPath)) {
    // Create a fake 5MB "audio" file
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    
    const size = 5 * 1024 * 1024; // 5MB
    const buffer = Buffer.alloc(size);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    fs.writeFileSync(audioPath, buffer);
  }
  
  const stat = statSync(audioPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    const parsedRange = parseRange(range, fileSize);
    
    if (!parsedRange) {
      res.status(416).send('Range Not Satisfiable');
      return;
    }
    
    const { start, end } = parsedRange;
    const chunkSize = (end - start) + 1;
    
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache'
    });
    
    createReadStream(audioPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes'
    });
    
    createReadStream(audioPath).pipe(res);
  }
});

// === File Download with Resume Support ===

app.get('/download/file', (req: Request, res: Response) => {
  const filePath = path.join(videoDir, 'large-file.bin');
  
  if (!fs.existsSync(filePath)) {
    // Create a 20MB file for download testing
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    
    const size = 20 * 1024 * 1024; // 20MB
    const buffer = Buffer.alloc(size);
    
    // Add some recognizable pattern
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = i % 256;
    }
    
    fs.writeFileSync(filePath, buffer);
  }
  
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    const parsedRange = parseRange(range, fileSize);
    
    if (!parsedRange) {
      res.status(416).send('Range Not Satisfiable');
      return;
    }
    
    const { start, end } = parsedRange;
    const chunkSize = (end - start) + 1;
    
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="large-file.bin"'
    });
    
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'attachment; filename="large-file.bin"'
    });
    
    createReadStream(filePath).pipe(res);
  }
});

// === HLS Streaming Simulation ===

app.get('/hls/playlist.m3u8', (req: Request, res: Response) => {
  // Simulate HLS playlist
  const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
/hls/segment0.ts
#EXTINF:10.0,
/hls/segment1.ts
#EXTINF:10.0,
/hls/segment2.ts
#EXT-X-ENDLIST`;

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(playlist);
});

app.get('/hls/segment:id.ts', (req: Request, res: Response) => {
  const segmentId = req.params.id;
  
  // Generate fake segment data
  const segmentSize = 1024 * 512; // 512KB per segment
  const buffer = Buffer.alloc(segmentSize);
  
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = (parseInt(segmentId) + i) % 256;
  }
  
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Content-Length', segmentSize.toString());
  res.send(buffer);
});

// === Test Endpoints ===

app.get('/test/range-info', (req: Request, res: Response) => {
  res.json({
    headers: req.headers,
    hasRange: !!req.headers.range,
    range: req.headers.range,
    userAgent: req.headers['user-agent']
  });
});

app.head('/video/stream', (req: Request, res: Response) => {
  // HEAD request for video metadata
  const stat = fs.existsSync(videoPath) ? statSync(videoPath) : { size: 10485760 };
  
  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  });
  res.end();
});

// === Summary Endpoint ===

app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Video/Audio streaming test server',
    port,
    endpoints: {
      streaming: [
        'GET /video/stream - Video with range support',
        'HEAD /video/stream - Video metadata',
        'GET /audio/stream - Audio with range support',
        'GET /download/file - File download with resume support'
      ],
      hls: [
        'GET /hls/playlist.m3u8 - HLS playlist',
        'GET /hls/segment:id.ts - HLS segments'
      ],
      test: [
        'GET /test/range-info - Show range request info'
      ]
    },
    rangeRequestExample: 'curl -H "Range: bytes=0-1023" http://localhost:4001/video/stream'
  });
});

// Start server
app.listen(port, () => {
  console.log(`Video streaming test server running on port ${port}`);
  console.log(`Test video streaming at http://localhost:${port}/video/stream`);
  console.log(`Example: curl -H "Range: bytes=0-1023" http://localhost:${port}/video/stream`);
});