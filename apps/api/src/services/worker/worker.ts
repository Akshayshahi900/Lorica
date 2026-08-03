import {Worker , Job} from 'bullmq';
import {connection , ReviewJobPayload} from '../../queue';
import { prisma } from '../../lib/prisma';
import { fetchPrFiles } from '../../github/fetchDiff';
import { parseFileDiffs } from '../../github/parseDiff';

const worker = new Worker<ReviewJobPayload>(
    'review',
    async(job:Job<ReviewJobPayload>) =>{

        const reviewJob = await prisma.reviewJob.findUniqueOrThrow({
            where: {id: job.data.reviewJobId},
        })
        
        const pullRequestId = reviewJob.pullRequestId;
        
        const pullrequest = await prisma.pullRequest.findUnique({
            where: {githubPrId:pullRequestId}
        });
        
        const {repoName , installationId , repoOwner , prNumber  } = pullrequest;



        const files = await fetchPrFiles(
            installationId,
            repoOwner,
            repoName,
            prNumber
        );

        const parseDiffs = parseFileDiffs(files);
        console.log(`[worker] parsed  ${parseDiffs.length} files for job ${job.id}   ----- ${parseDiffs}`);

        //next step:rag + claude review genreation on parsedDiffs 
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