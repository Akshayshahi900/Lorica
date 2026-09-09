import { Queue } from "bullmq";
import { connection } from "@lorica/queue";

const queue = new Queue("code-index", {
    connection,
});

async function main() {
    const job = await queue.add("index-repository", {
        repositoryUrl: "https://github.com/Akshayshahi900/BACKEND_CRUD_03",
        branch: "main",
        commit: "",
    });

    console.log(`Created job: ${job.id}`);

    await queue.close();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});