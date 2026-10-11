import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { indexRepository } from "./indexRepository";

describe("indexRepository fixtures", () => {
  let fixtureDir: string;
  after(async () => {
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  });

  it("indexes declarations and resolves imports, calls, inheritance, and implementations", async () => {
    fixtureDir = await mkdtemp(path.join(os.tmpdir(), "lorica-index-fixture-"));
    await mkdir(path.join(fixtureDir, "src"));
    await mkdir(path.join(fixtureDir, "node_modules", "ignored"), { recursive: true });
    await writeFile(path.join(fixtureDir, "src", "contracts.ts"), `
      export interface Contract {}
      export class Base {}
      export function helper() {}
    `);
    await writeFile(path.join(fixtureDir, "src", "main.ts"), `
      import { Base, Contract, helper } from "./contracts";
      import "external-package";
      export class Child extends Base implements Contract {
        run() { helper(); }
      }
    `);
    await writeFile(path.join(fixtureDir, "node_modules", "ignored", "ignored.ts"), "export const ignored = true;");

    const graph = await indexRepository(fixtureDir, "https://github.com/acme/widget.git", "pull/7", "abc123");
    const types = new Set(graph.relationships.map((edge) => edge.type));
    assert.ok(graph.nodes.some((node) => node.type === "File" && node.properties.path === "src/main.ts"));
    assert.ok(graph.nodes.some((node) => node.type === "ExternalModule" && node.properties.name === "external-package"));
    for (const type of ["IMPORTS", "CALLS", "EXTENDS", "IMPLEMENTS"] as const) {
      assert.ok(types.has(type), `expected ${type} edge`);
    }
    assert.equal(graph.nodes.some((node) => node.properties.path?.includes("node_modules")), false);
    const ids = new Set(graph.nodes.map((node) => node.id));
    assert.ok(graph.relationships.every((edge) => ids.has(edge.from) && ids.has(edge.to)));
  });
});
