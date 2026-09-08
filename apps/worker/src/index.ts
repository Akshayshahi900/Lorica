import "dotenv/config";
import './clone-worker';
import './diff.worker';

console.log('[lorica:worker] All workers booted, waiting for jobs...');

process.on('SIGTERM', () => {
  console.log('[lorica:worker] Shutting down gracefully');
  process.exit(0);
});