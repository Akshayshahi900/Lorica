import {Queue} from 'bullmq';
import type {CloneRepoJob , ReviewJobPayload} from '@lorica/types';
import { connection } from './connection';

// Retries are scheduled from the ReviewJob row, not here: Redis may be down or
// lose data, so each queue entry is a single, disposable delivery attempt.
export const reviewQueue = new Queue<ReviewJobPayload>('review', {connection, 
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

// An unhandled 'error' event would crash the process during a Redis outage.
reviewQueue.on('error', (error) => {
    console.error(`[queue] stage=review_queue.error error_type=${error.name}`);
});

const ENQUEUE_TIMEOUT_MS = 3_000;

/**
 * Hands a review attempt to the worker. The job id makes repeated dispatches
 * of the same attempt a no-op. Rejects instead of waiting on an unreachable
 * Redis (maxRetriesPerRequest: null would otherwise hang forever).
 */
export async function enqueueReview(reviewJobId: number, attempt: number) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error('Timed out enqueueing review job')),
            ENQUEUE_TIMEOUT_MS,
        );
    });
    try {
        await Promise.race([
            reviewQueue.add('review', { reviewJobId }, { jobId: `review-${reviewJobId}-${attempt}` }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export const indexQueue = new Queue<CloneRepoJob>('code-index', {connection, defaultJobOptions:{
    attempts:2,
    backoff:{
        type:'exponential',
        delay:3000,
    },
    removeOnComplete:100,
    removeOnFail:500,
}})

/** Closes the queues and their Redis connection (shutdown, tests). */
export async function closeQueues() {
    await Promise.all([reviewQueue.close(), indexQueue.close()]);
    await connection.quit();
}
