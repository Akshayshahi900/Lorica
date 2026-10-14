import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// ioredis keeps reconnecting on its own; this only reports the outage.
connection.on('error', (error) => {
  console.error(`[queue] stage=redis.connection_error error_type=${error.name}`);
});