import {Queue} from 'bullmq';
import IORedis from 'ioredis';
import type {CloneRepoJob , ReviewJobPayload} from '@lorica/types';


export const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});



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
    attempts:2,
    backoff:{
        type:'exponential',
        delay:3000,
    },
    removeOnComplete:100,
    removeOnFail:500,
}})