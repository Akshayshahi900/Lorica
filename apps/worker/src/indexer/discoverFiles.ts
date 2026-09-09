import {readdir} from "fs/promises";
import path from "path";

const SUPPORTED_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
]);

const IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
]);

export async function discoverSourceFiles(
    rootDir: string
): Promise<string[]> {

    const files: string[] = [];

    async function walk(directory: string) {
        
        const entries = await readdir(directory, {
            withFileTypes: true,
        });

        for (const entry of entries) {
            const fullPath = path.join(
                directory,
                entry.name
            );

            if (entry.isDirectory()) {
                if (IGNORED_DIRECTORIES.has(entry.name)) {
                    continue;
                }

                await walk(fullPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const extension = path.extname(entry.name);

            if (SUPPORTED_EXTENSIONS.has(extension)) {
                files.push(fullPath);
            }
        }
    }

    await walk(rootDir);

    return files;
}