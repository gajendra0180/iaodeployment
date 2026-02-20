/**
 * Load Testing Script for APIX Proxy
 *
 * Tests different scenarios:
 * 1. Health check endpoint (baseline)
 * 2. Server metadata fetch (DynamoDB read)
 * 3. Full proxy flow (with mock payment)
 *
 * Usage:
 *   node scripts/load-test.js [scenario] [concurrency] [duration_seconds]
 *
 * Examples:
 *   node scripts/load-test.js health 100 10
 *   node scripts/load-test.js metadata 50 10
 *   node scripts/load-test.js proxy 10 10
 */

const http = require('http');
const https = require('https');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const SCENARIO = process.argv[2] || 'health';
const CONCURRENCY = parseInt(process.argv[3]) || 50;
const DURATION_SECONDS = parseInt(process.argv[4]) || 10;

// Test scenarios
const scenarios = {
  // Baseline: pure Express throughput
  health: {
    method: 'GET',
    path: '/health',
    description: 'Health check (no DB, no external calls)',
  },

  // DynamoDB read performance
  metadata: {
    method: 'GET',
    path: '/api/servers',
    description: 'Server list (DynamoDB scan)',
  },

  // Single server lookup (GSI query)
  server: {
    method: 'GET',
    path: '/api/server/laksdlaskl',
    description: 'Single server lookup (DynamoDB query)',
  },

  // Metrics endpoint
  metrics: {
    method: 'GET',
    path: '/api/metrics/laksdlaskl',
    description: 'Metrics fetch (DynamoDB + contract read)',
  },
};

// Stats
let stats = {
  requests: 0,
  successes: 0,
  failures: 0,
  latencies: [],
  errors: {},
  startTime: null,
  endTime: null,
};

// Make a single request
function makeRequest(scenario) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const url = new URL(scenario.path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: scenario.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - startTime;
        stats.requests++;
        stats.latencies.push(latency);

        if (res.statusCode >= 200 && res.statusCode < 400) {
          stats.successes++;
        } else {
          stats.failures++;
          const errorKey = `HTTP ${res.statusCode}`;
          stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;
        }
        resolve({ latency, status: res.statusCode });
      });
    });

    req.on('error', (err) => {
      const latency = Date.now() - startTime;
      stats.requests++;
      stats.failures++;
      stats.latencies.push(latency);
      const errorKey = err.code || err.message;
      stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;
      resolve({ latency, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      stats.requests++;
      stats.failures++;
      stats.errors['TIMEOUT'] = (stats.errors['TIMEOUT'] || 0) + 1;
      resolve({ latency: 30000, error: 'timeout' });
    });

    req.end();
  });
}

// Worker that continuously makes requests
async function worker(scenario, stopSignal) {
  while (!stopSignal.stop) {
    await makeRequest(scenario);
  }
}

// Calculate percentile
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Print results
function printResults() {
  const duration = (stats.endTime - stats.startTime) / 1000;
  const rps = stats.requests / duration;
  const avgLatency = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;

  console.log('\n' + '='.repeat(60));
  console.log('LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Scenario:     ${SCENARIO}`);
  console.log(`Concurrency:  ${CONCURRENCY} workers`);
  console.log(`Duration:     ${duration.toFixed(2)}s`);
  console.log('-'.repeat(60));
  console.log(`Total Requests:    ${stats.requests}`);
  console.log(`Successful:        ${stats.successes} (${(stats.successes/stats.requests*100).toFixed(1)}%)`);
  console.log(`Failed:            ${stats.failures} (${(stats.failures/stats.requests*100).toFixed(1)}%)`);
  console.log('-'.repeat(60));
  console.log(`Requests/sec:      ${rps.toFixed(2)} RPS`);
  console.log('-'.repeat(60));
  console.log('Latency:');
  console.log(`  Average:         ${avgLatency.toFixed(2)}ms`);
  console.log(`  Min:             ${Math.min(...stats.latencies)}ms`);
  console.log(`  Max:             ${Math.max(...stats.latencies)}ms`);
  console.log(`  P50:             ${percentile(stats.latencies, 50)}ms`);
  console.log(`  P90:             ${percentile(stats.latencies, 90)}ms`);
  console.log(`  P99:             ${percentile(stats.latencies, 99)}ms`);

  if (Object.keys(stats.errors).length > 0) {
    console.log('-'.repeat(60));
    console.log('Errors:');
    for (const [error, count] of Object.entries(stats.errors)) {
      console.log(`  ${error}: ${count}`);
    }
  }
  console.log('='.repeat(60));

  // Recommendations
  console.log('\nRECOMMENDATIONS:');
  if (rps < 100) {
    console.log('⚠️  Low throughput. Check for blocking operations.');
  } else if (rps < 500) {
    console.log('✓  Moderate throughput. Consider connection pooling.');
  } else if (rps < 1000) {
    console.log('✓  Good throughput for a proxy with DB operations.');
  } else {
    console.log('✓  Excellent throughput!');
  }

  if (percentile(stats.latencies, 99) > 1000) {
    console.log('⚠️  High P99 latency. Check for slow DB queries or external calls.');
  }

  if (stats.failures / stats.requests > 0.01) {
    console.log('⚠️  Error rate > 1%. Check server logs.');
  }
}

// Main
async function main() {
  const scenario = scenarios[SCENARIO];
  if (!scenario) {
    console.error(`Unknown scenario: ${SCENARIO}`);
    console.error(`Available: ${Object.keys(scenarios).join(', ')}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('APIX PROXY LOAD TEST');
  console.log('='.repeat(60));
  console.log(`Target:       ${BASE_URL}`);
  console.log(`Scenario:     ${SCENARIO} - ${scenario.description}`);
  console.log(`Endpoint:     ${scenario.method} ${scenario.path}`);
  console.log(`Concurrency:  ${CONCURRENCY} workers`);
  console.log(`Duration:     ${DURATION_SECONDS} seconds`);
  console.log('='.repeat(60));
  console.log('\nStarting load test...\n');

  const stopSignal = { stop: false };
  stats.startTime = Date.now();

  // Start workers
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(scenario, stopSignal));
  }

  // Progress indicator
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const rps = stats.requests / elapsed;
    process.stdout.write(`\r[${elapsed.toFixed(0)}s] Requests: ${stats.requests} | RPS: ${rps.toFixed(1)} | Errors: ${stats.failures}`);
  }, 500);

  // Stop after duration
  await new Promise(resolve => setTimeout(resolve, DURATION_SECONDS * 1000));
  stopSignal.stop = true;
  stats.endTime = Date.now();

  clearInterval(progressInterval);
  console.log('\n');

  // Wait for in-flight requests
  await Promise.all(workers);

  printResults();
}

main().catch(console.error);
