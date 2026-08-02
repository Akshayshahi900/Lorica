import {Worker , Job} from 'bullmq';
import {connection , ReviewJobPayload} from '../../queue';
import { prisma } from '../../lib/prisma';

const worker = new Worker<ReviewJobPayload>(
    'review',
    async(job:Job<ReviewJobPayload>) =>{

        const reviewJob = await prisma.reviewJob.findUniqueOrThrow({
            where: {id: job.data.reviewJobId},
        })
        
        console.log(`[worker] picked up job ${job.id}`, job.data);
        //TODO:fetch ReviewJob from postgres , run diff parsing parsing + RAg + Claude review
    },
    {
        connection, concurrency:2
    }
);
worker.on('completed', (job) =>{
    console.log(`[worker] job ${job.id} completed`);
});

worker.on('failed' , (job , err)=>{
    console.error(`[worker] job  ${job?.id} failed` , err.message);
});
console.log('Review worker started , waiting for jobs.....');