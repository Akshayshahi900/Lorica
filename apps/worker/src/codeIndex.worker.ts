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



const worker = new Worker(
    "code-index",
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

         await indexRepository(repoDir, repositoryUrl , branch , commit);
         console.log(`Repository indexed successfully`);

         return {
            success:true,
            repoDir,
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

async function indexRepository(repoDir:string , repositoryUrl:string , branch:string , commit:string){
    // discover all files
    const files = await discoverSourceFiles(repoDir);

    const graph:CodeGraph = {
        nodes:[],
        relationships:[],
    };




    console.log(`Found ${files.length} source files`);
    for(const filePath of files ){
        const source = await readFile(filePath, "utf-8");
        
        const tree = parseTypeScript(source);
        const fileGraph = extractFile(
            tree , 
            path.relative(repoDir , filePath)
        );


        graph.nodes.push(...fileGraph.nodes);
        graph.relationships.push(...fileGraph.relationships);
    }

    console.log(
        `Nodes: ${graph.relationships.length}`
    )
    console.log(
        `Relationships: ${graph.relationships.length}`
    );

    //neo4j part 
}