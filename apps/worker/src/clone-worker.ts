import { CloneRepoJob } from "@lorica/types";
import {Worker, Job }from "bullmq";
import {connection} from "@lorica/queue";

const worker = new Worker(
    "code-index",
    async(job :Job<CloneRepoJob>) => {
      //clone repo here
    },{
        connection,
    }
);
