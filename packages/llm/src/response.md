```
cache bypass, force executing 6205c85dbe57f60f

> api@1.0.0 dev:worker /home/akshay/Code/projects/Lorica/apps/api
> tsx watch --env-file=.env src/services/worker/worker.ts

◇ injected env (0) from .env // tip: ⌘ enable debugging { debug: true }
Review worker started , waiting for jobs.....
prisma:query SELECT "public"."ReviewJob"."id", "public"."ReviewJob"."pullRequestId", "public"."ReviewJob"."status"::text, "public"."ReviewJob"."createdAt" FROM "public"."ReviewJob" WHERE ("public"."ReviewJob"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
prisma:query SELECT "public"."PullRequest"."id", "public"."PullRequest"."githubPrId", "public"."PullRequest"."prNumber", "public"."PullRequest"."repoName", "public"."PullRequest"."headSha", "public"."PullRequest"."status"::text, "public"."PullRequest"."action", "public"."PullRequest"."installationId", "public"."PullRequest"."repoOwner", "public"."PullRequest"."repositoryId", "public"."PullRequest"."createdAt", "public"."PullRequest"."updatedAt" FROM "public"."PullRequest" WHERE ("public"."PullRequest"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
[worker] parsed 1 files for job 17
========== DIFF SENT TO LLM ==========
diff --git a/src/server.ts b/src/server.ts
@@ -12,6 +12,13 @@ dotenv.config();

 const PORT = process.env.PORT || 5000;
 console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
+console.log("This is the test commit given to the LLM to check whether it can pass the diff of the PR on now");
 app.use("/user", authRoutes);
 app.use("/api/expense", authMiddleware, expenseRoutes);
 app.use("/api", authMiddleware, rolesRoutes);
======================================
```

LLM RESPONSE:

```json
{
  "file_diff": "-12,6 +12,13 @@ dotenv.config();\n\n const PORT = process.env.PORT || 5000;\n- console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n app.use(\"/user\", authRoutes);\n app.use(\"/api/expense\", authMiddleware, expenseRoutes);\n app.use(\"/api\", authMiddleware, rolesRoutes);",
  "file_path": "src/server.ts"
}
```

========================Printing the LLM RESULT to the CONSOLE=====================

```json
{
  "file_diff": "-12,6 +12,13 @@ dotenv.config();\n\n const PORT = process.env.PORT || 5000;\n- console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n+ console.log(\"This is the test commit given to the LLM to check whether it can pass the diff of the PR on now\");\n app.use(\"/user\", authRoutes);\n app.use(\"/api/expense\", authMiddleware, expenseRoutes);\n app.use(\"/api\", authMiddleware, rolesRoutes);",
  "file_path": "src/server.ts"
}
```

[worker] job 17 completed
