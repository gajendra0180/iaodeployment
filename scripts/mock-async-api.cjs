/**
 * Mock Async API Server for testing 202 polling
 *
 * Endpoints:
 * - GET /generate - Returns 202 with statusUrl, simulates async job
 * - GET /status/:jobId - Returns job status (processing → completed)
 */

const http = require('http');
const url = require('url');

const PORT = 5001;
const jobs = new Map();

// Simulate job completion after X seconds
const JOB_DURATION_MS = 60000; // 60 seconds (1 minute)

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Main endpoint - starts async job
  if (path === '/generate' || path === '/') {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    jobs.set(jobId, {
      id: jobId,
      status: 'processing',
      startTime,
      completionTime: startTime + JOB_DURATION_MS,
      result: null
    });

    console.log(`[${new Date().toISOString()}] Started job: ${jobId}`);

    // Return 202 Accepted with status URL
    res.writeHead(202);
    res.end(JSON.stringify({
      status: 'processing',
      statusUrl: `/status/${jobId}`,
      jobId: jobId,
      estimatedTime: JOB_DURATION_MS / 1000,
      message: 'Your request is being processed'
    }));
    return;
  }

  // Status endpoint - check job progress
  if (path.startsWith('/status/')) {
    const jobId = path.replace('/status/', '');
    const job = jobs.get(jobId);

    if (!job) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }

    const now = Date.now();
    const elapsed = now - job.startTime;
    const remaining = Math.max(0, job.completionTime - now);

    // Check if job is complete
    if (now >= job.completionTime) {
      job.status = 'completed';
      job.result = {
        generatedText: `This is the async result for job ${jobId}`,
        processingTime: `${JOB_DURATION_MS / 1000} seconds`,
        timestamp: new Date().toISOString(),
        data: {
          items: ['item1', 'item2', 'item3'],
          count: 3,
          success: true
        }
      };

      console.log(`[${new Date().toISOString()}] Completed job: ${jobId}`);

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'completed',
        jobId: jobId,
        result: job.result
      }));
      return;
    }

    // Still processing
    const progress = Math.min(99, Math.floor((elapsed / JOB_DURATION_MS) * 100));
    console.log(`[${new Date().toISOString()}] Job ${jobId} progress: ${progress}%`);

    res.writeHead(202);
    res.end(JSON.stringify({
      status: 'processing',
      jobId: jobId,
      progress: progress,
      estimatedTimeRemaining: Math.ceil(remaining / 1000),
      message: `Processing... ${progress}% complete`
    }));
    return;
  }

  // Unknown endpoint
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`
====================================
  Mock Async API Server
====================================
  Running on: http://localhost:${PORT}

  Endpoints:
    GET /generate    - Start async job (returns 202)
    GET /status/:id  - Check job status

  Job duration: ${JOB_DURATION_MS / 1000} seconds
====================================
`);
});
