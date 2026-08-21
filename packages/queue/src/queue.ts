import {Queue} from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export interface ReviewJobPayload{
    reviewJobId:number;
}

export const reviewQueue = new Queue<ReviewJobPayload>('review', {connection, 
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

export const indexQueue = new Queue<CloneRepoJob>('code-index', {connection, defaultJobOptions:{
    attempts:1,
    backoff:{
        type:'exponential',
        delay:1000,
    },
    removeOnComplete:100,
    removeOnFail:500,
}})