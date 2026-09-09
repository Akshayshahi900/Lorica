import {readFile } from "fs/promises";
import path from "path";

import {parseTypeScript} from "./parser";

export async function parseFiles(
    repoDir:string,
    files:string[]
){
    const results = [];

    for(const filePath of files){
        const source = await readFile(filePath , "utf-8");

        const tree = parseTypeScript(source);

      results.push({
            filePath,
            relativePath: path.relative(repoDir, filePath),
            source,
            tree,
        });
    }

    return results;
}