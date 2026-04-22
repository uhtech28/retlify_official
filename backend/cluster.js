/**
 * Cluster entry point - forks one worker per CPU core.
 *
 * Use this in production to saturate all cores of a single machine.
 * On Render/Railway/Fly.io, each container gets 1-2 vCPUs, so cluster mode
 * doubles throughput at zero infra cost. Horizontal scaling (multiple
 * instances) happens at the PaaS level and stacks on top of cluster.
 *
 * Start via:  node cluster.js
 * Or:         npm start
 *
 * Override worker count with WORKERS env var.
 */

'use strict';

const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
  const workerCount = parseInt(process.env.WORKERS || os.cpus().length, 10);
  console.log('[cluster] primary ' + process.pid + ' starting ' + workerCount + ' workers');

  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log('[cluster] worker ' + worker.process.pid + ' died (' + (signal || code) + ') - restarting');
    cluster.fork();
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[cluster] SIGTERM received - shutting down workers');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 30000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  require('./server');
}
