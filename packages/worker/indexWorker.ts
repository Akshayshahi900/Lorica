import { CloneRepoJob } from "../types/types";
// await codeReviewQueue.add(
//   "clone-repo",
//   {
//     reviewId,
//     repositoryUrl,
//     commitSha,
//     baseCommitSha,
//     branch,
//   },
//   {
//     jobId: `review:${reviewId}`,
//   }
// );


import {Worker }from "bullmq";
import {redis} from "../lib/redis";

const worker = new Worker(
    "code-index",
    async(job) => {
        console.log("Received job:" , job.name);
        console.log("Repo:", job.data.repoUrl);

        //clone repo here
    },{
        connection:redis,
    }
);
