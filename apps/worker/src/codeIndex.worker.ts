import { CloneRepoJob, CodeGraph } from "@lorica/types";
import {Worker, Job }from "bullmq";
import {connection} from "@lorica/queue";
import {execFile} from "child_process";
import {promisify} from 'util';
import {mkdtemp , readFile, rm } from "fs/promises";
import {tmpdir} from "os";
import path from "path";
import { discoverSourceFiles } from "./indexer/discoverFiles";
import { parseTypeScript } from "./indexer/parser";
import { extractFile } from "./indexer/extractFile";

const execFileAsync = promisify(execFile);
const indexQueueName = process.env.INDEX_QUEUE_NAME ?? "code-index";



export const indexWorker = new Worker(
    indexQueueName,
    async(job :Job<CloneRepoJob>) => {
      const {repositoryUrl , branch , commit} = job.data;

      // creating a isolated temp directory
      const repoDir = await mkdtemp(
       path.join(tmpdir(), "lorica-") 
      );

      try{
        console.log(`Cloning ${repositoryUrl}`);
        console.log(`Working directory: ${repoDir}`);

        // clone repo
        const cloneArgs = [
            "clone",
            "--depth",
            "1",
        ];
        if(branch){
            cloneArgs.push("--branch", branch);
        }
         cloneArgs.push(repositoryUrl , repoDir);
         await execFileAsync("git" , cloneArgs);

         console.log(`Repository cloned successfully`);

         // index repo ast

         const graph = await indexRepository(repoDir, repositoryUrl , branch , commit);
         console.log(`Repository indexed successfully`);

         return {
            success:true,
            graph,
         }
      }
      catch(error){
        console.error(`Failed to process ${repositoryUrl}`, error);
        throw error; 
      }
      finally{
        await rm(repoDir, {
            recursive:true,
            force:true,
        });

        console.log(`Cleaned up ${repoDir}`);
      }
    },{
        connection,
        concurrency:2,
        limiter:{
            max:5,
            duration:60_000,
        }
    }
);

async function indexRepository(repoDir:string , repositoryUrl:string , branch:string , commit:string): Promise<CodeGraph>{
    // discover all files
    const files = await discoverSourceFiles(repoDir);

    const graph:CodeGraph = {
        nodes:[],
        relationships:[],
    };
    const logDetails = process.env.LOG_INDEX_DETAILS === "true";
    const logAst = process.env.LOG_INDEX_AST === "true";
    console.log(`Found ${files.length} source files`);
    for(const filePath of files ){
        const source = await readFile(filePath, "utf-8");
        
        const tree = parseTypeScript(source);
        const relativePath = path.relative(repoDir , filePath);

        if (logAst) {
            console.log(`\n[ast] ${relativePath}\n${tree.rootNode.toString()}`);
        }

        const fileGraph = extractFile(
            tree , 
            relativePath,
    );

        if (logDetails) {
            const symbols = fileGraph.nodes
                .filter((node) => node.type !== "File")
                .map((node) => `${node.type}:${node.properties.name ?? node.id}`);
            console.log(
                `[index] ${relativePath} | read + parsed | ` +
                `${fileGraph.nodes.length} nodes, ${fileGraph.relationships.length} relationships` +
                (symbols.length ? ` | ${symbols.join(", ")}` : ""),
            );
        }


        graph.nodes.push(...fileGraph.nodes);
        graph.relationships.push(...fileGraph.relationships);
    }

    console.log(
        `Nodes: ${graph.nodes.length}`
    )
    console.log(
        `Relationships: ${graph.relationships.length}`
    );

    if (process.env.LOG_CODE_GRAPH === "true") {
        console.dir(graph, { depth: null });
    }

    return graph;
}
