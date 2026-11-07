# Lorica benchmark

Run 2026-11-07 with model `nvidia/nemotron-3-ultra-550b-a55b:free` and the `chill` profile. 43 of 97 real bugs from 8 open-source repositories reviewed with diff + code-graph context, as in production. Reproduce with `pnpm benchmark run`.

## Results (diff + code graph)

| Metric | Value |
| --- | --- |
| Real bugs identified (finding describes the fixed defect) | not judged yet (0 / 43 judged) |
| Real bugs flagged (finding within 3 lines of the defect) | 41 / 43 (95%) |
| Valid structured responses | 43 / 43 (100%) |
| Review time, median | 22.4s |
| Review time, p90 | 667.2s |
| Findings per review, mean | 1.4 |
| Graph traces per review | median 27, max 33 |
| Indexing the buggy commit (clone, parse, persist to Neo4j), median | 26.5s over 97 commits |
| Prompt tokens removed by file filtering | 24% (116,471 → 88,443 est. tokens over 40 PRs; 12 PRs had files filtered) |

## Comparison: with graph vs diff only

The 27 cases reviewed both with graph context and with the diff alone, without code-graph evidence.

| Metric | With graph | Diff only |
| --- | --- | --- |
| Real bugs identified | not judged yet (0 / 27 judged) | **22 / 27 (81%)** |
| Real bugs flagged | 26 / 27 (96%) | 26 / 27 (96%) |
| Review time, median | 23.0s | 32.7s |
| Findings per review, mean | 1.5 | 1.4 |

## Method

- **Cases:** merged PRs with "fix" in the title, touching 1–3 source files (no examples or docs) and 2–60 changed lines, at most 15 per repository, from sveltejs/svelte, vuejs/core, nestjs/nest, vitejs/vite, TanStack/query, colinhacks/zod, remix-run/react-router, honojs/hono. Each patch is reversed so the diff reintroduces the bug the maintainers fixed. The title is replaced, and the description and test changes are withheld.
- **Graph context:** the production indexer builds the code graph of the fix PR's base commit (the code with the bug) in Neo4j, and the review receives the same one-hop traces it would in production.
- **Flagged:** any finding points within 3 lines of a reintroduced change. On small diffs this is loose, so it is an upper bound.
- **Identified:** a judge model, given the real fix's title and patch, says a flagged finding describes the same defect. This is the headline number. 1 verdict was made by hand after the judge hit a rate limit (marked in the results files).
- **Caveats:** a "fix" PR is not always a bug, LLM judging can err in either direction, and public repositories may be in the model's training data. Every case is listed below so each verdict can be checked.
- **Filtering:** the most recent merged PRs from the same repositories, estimated at ~3 characters per token, before and after the built-in filter (lockfiles, generated, vendored, assets, docs, deletions).
- **Not measured:** false-positive rate (findings away from the bug may still be valid).

## Cases

| # | PR | With graph | Diff only | Time (graph) | Nearest finding (with graph) |
| --- | --- | --- | --- | --- | --- |
| 1 | [fix: `devalue` link in `hydratable_serialization_failed` err](https://github.com/sveltejs/svelte/pull/18999) | missed | identified | 5.4s |  |
| 2 | [fix(runtime-vapor): push warning context during render effec](https://github.com/vuejs/core/pull/15874) | flagged | identified | 10.4s | medium correctness: The pushWarningContext(instance) call was removed from before startMeasure. This function sets up the warning context so that any warnings/e |
| 3 | [fix(common): call `stringifyReplacer` with the logger as `th](https://github.com/nestjs/nest/pull/18146) | flagged | flagged | 20.2s | high bug: The `this` context for `stringifyReplacer` has changed. Originally, `this.stringifyReplacer.bind(this)` bound the method to the ConsoleLogge |
| 4 | [fix(common): detect stacks whose error message spans several](https://github.com/nestjs/nest/pull/18145) | flagged | identified | 10.9s | high security: The new regex reintroduces a ReDoS vulnerability. The original code used `[ \t]+` instead of `\s+` specifically to avoid matching newlines,  |
| 5 | [fix(common): parse `error()` calls with a lone or an undefin](https://github.com/nestjs/nest/pull/18144) | flagged | flagged | 33.2s | high correctness: The handling for args.length === 1 was removed entirely. When error() is called with a single argument (just a message), the method now fall |
| 6 | [fix(optimizer): scan `oxc.jsxInject` imports](https://github.com/vitejs/vite/pull/23758) | flagged | missed | 24.2s | high correctness: The code now only checks for `environment.config.esbuild.jsxInject` but no longer falls back to `environment.config.oxc.jsxInject`. Users wh |
| 7 | [fix(core): key the handler metadata cache by class, not clas](https://github.com/nestjs/nest/pull/18143) | flagged | identified | 9.9s | high correctness: The metadata key is now a simple string concatenation of controllerKey and methodName. If two different controller classes have the same nam |
| 8 | [fix(runtime-vapor): remove block node from its actual parent](https://github.com/vuejs/core/pull/15867) | flagged | identified | 667.2s | high bug: The code uses the parent parameter directly instead of block.parentNode. The parent parameter may not be the actual DOM parent of block, cau |
| 9 | [fix(runtime-vapor): defer interop fragment removal until lea](https://github.com/vuejs/core/pull/15866) | flagged | identified | 57.4s | high bug: The transition leave logic for vapor components inside VDOM fragments is broken. The old code detected vapor components in fragments (isFrag |
| 10 | [fix(runtime-vapor): render nothing for an invalid v-for rang](https://github.com/vuejs/core/pull/15863) | flagged | identified | 9.7s | high correctness: The validation for numeric v-for source is now only performed in development mode (__DEV__). In production, negative numbers or non-integers |
| 11 | [fix(core): release the throwaway wrapper of each create() ca](https://github.com/nestjs/nest/pull/18137) | flagged | identified | 15.4s | high bug: The finally block that called wrapper.detachFromDependencies() was removed. This method cleaned up dependencyTreeParents references and remo |
| 12 | [fix(microservices): match empty mqtt topic levels](https://github.com/nestjs/nest/pull/18127) | flagged | identified | 23.8s | high bug: The change from `isUndefined(currentTopic)` to `!currentTopic` incorrectly treats empty string topic segments as missing segments. In MQTT,  |
| 13 | [fix(microservices): ignore a redis server's own replies unde](https://github.com/nestjs/nest/pull/18125) | flagged | identified | 22.3s | high correctness: The PR removed a critical check that prevented the server from processing its own reply messages when wildcard subscriptions are enabled. Pr |
| 14 | [Fix/angular devtools lifecycle](https://github.com/TanStack/query/pull/11999) | flagged | flagged | 42.0s | high bug: The flag `devtoolsProvided.isProvided` is set to `true` but the cleanup that resets it to `false` on destroy was removed. Previously, `destr |
| 15 | [fix(v4): report a union option that only checks rejected](https://github.com/colinhacks/zod/pull/6662) | flagged | flagged | 747.2s | high correctness: The PR removes a critical fallback branch that handled union parsing when all members produce 'continuable' errors (issues with continue !== |
| 16 | [fix(v4): run a record's key schema on an own __proto__ key](https://github.com/colinhacks/zod/pull/6660) | flagged | identified | 37.3s | high security: In loose record mode, when the key schema rejects the input key "__proto__", outKeyVar becomes INVALID. The loose branch copies accessor["__ |
| 17 | [fix(core): keep route options when the route triggered hook ](https://github.com/nestjs/nest/pull/18121) | flagged | identified | 25.3s | high correctness: The original code used Object.assign to copy properties from routeHandler to the wrapper function, and called copyMetadataToCallback. The co |
| 18 | [fix(express): guard async request hook completion](https://github.com/nestjs/nest/pull/18110) | flagged | identified | 37.9s | high bug: The `done` callback no longer accepts an error parameter. Previously, hooks could call `done(err)` to signal errors to Express's error-handl |
| 19 | [fix(fastify): answer the shutdown hooks 503 with fastify's j](https://github.com/nestjs/nest/pull/18109) | flagged | identified | 1540.4s | high correctness: The shutdown 503 response was changed from a structured JSON object ({error, message, statusCode}) to a plain text string. This breaks API c |
| 20 | [fix(core): fail at startup for request-scoped class global e](https://github.com/nestjs/nest/pull/18104) | flagged | identified | 34.7s | high bug: The condition `isNil(instanceWrapper.instance) && !instanceWrapper.isDependencyTreeStatic()` only catches aliases and factories (which have  |
| 21 | [fix(runtime-vapor): start a vapor slot vnode in a vdom outle](https://github.com/vuejs/core/pull/15850) | flagged | identified | 19.5s | high bug: This change collapses vnode.el and vnode.anchor to the same node (selfAnchor). Previously, two separate text nodes were created: one for el  |
| 22 | [fix(fastify): honor `return503OnClosing` during the shutdown](https://github.com/nestjs/nest/pull/18101) | flagged | identified | 12.5s | high correctness: The `return503OnClosing` option (previously set at line 777) is no longer honored. Users who configured `return503OnClosing: true` in NestAp |
| 23 | [fix(microservices): default server options like the client f](https://github.com/nestjs/nest/pull/18100) | flagged | identified | 23.0s | high bug: Removed the default value `= {}` for `options` in the destructuring. If `microserviceOptions` does not include an `options` property (which  |
| 24 | [fix(microservices): fail mqtt requests whose publish fails](https://github.com/nestjs/nest/pull/18095) | flagged | identified | 1300.4s | high bug: The error callback argument was removed from the MQTT client method call (likely publish/subscribe). This callback handled asynchronous erro |
| 25 | [fix(node): write file sessions atomically](https://github.com/remix-run/react-router/pull/15620) | flagged | identified | 9.7s | high correctness: The atomic write pattern was replaced with a direct write. The original code wrote to a temporary file, preserved existing file permissions, |
| 26 | [fix(runtime-vapor): finish a deactivation leave where the el](https://github.com/vuejs/core/pull/15846) | flagged | identified | 12.8s | high bug: The else block now unconditionally calls `parent.insertBefore(block, anchor)` without checking if `anchor` is still a child of `parent`. The |
| 27 | [fix(runtime-vapor): render the deferred out-in branch where ](https://github.com/vuejs/core/pull/15844) | flagged | identified | 21.6s | high bug: Changed from `liveParent` to `parent` when calling `renderBranch`. The `liveParent` variable was computed as `frag.anchor.parentNode` to han |
| 28 | [fix(core): treat fastify validation errors as http errors](https://github.com/nestjs/nest/pull/18154) | flagged | – | 22.4s | high bug: The condition was changed to only check for `err.constructor?.name === 'FastifyError'`, removing the `err.code === 'FST_ERR_VALIDATION'` che |
| 29 | [fix(server): handle socket errors on upgrade requests not ta](https://github.com/vitejs/vite/pull/23728) | flagged | – | 12.4s | high bug: The removed else block added a noop error handler to sockets for non-HMR upgrade requests. The comment explains: 'Node.js detaches its own s |
| 30 | [fix(runtime-vapor): support hasOwnProperty on props, attrs a](https://github.com/vuejs/core/pull/15841) | flagged | – | 12.1s | high bug: Removed the fallback to Object.prototype that made `props.hasOwnProperty()` work like vdom. Now accessing a non-existent prop returns undefi |
| 31 | [fix(reg-exp-router): support line terminators in route paths](https://github.com/honojs/hono/pull/5547) | flagged | – | 110.1s | medium bug: Changed ONLY_WILDCARD_REG_EXP_STR from '[^]*' to '.*' and TAIL_WILDCARD_REG_EXP_STR (line 6) from '(?:\|/[^]*)' to '(?:\|/.*)'. Both now use |
| 32 | [fix(vapor): read unknown identifiers from props in templates](https://github.com/vuejs/core/pull/15839) | flagged | – | 52.5s | high bug: The getter is now called without arguments, but the removed comment explicitly states: 'the compiled getter reads identifiers the compiler c |
| 33 | [fix(runtime-vapor): support hasOwnProperty on the slots obje](https://github.com/vuejs/core/pull/15835) | flagged | – | 749.2s | high correctness: The get handler no longer falls back to Object.prototype for keys not found in slots. This breaks access to built-in methods like hasOwnProp |
| 34 | [fix(mutation-observer): snapshot mutateOptions before dispat](https://github.com/TanStack/query/pull/11945) | flagged | – | 41.6s | high bug: The PR removes the snapshot of `mutateOptions` before dispatching callbacks. The removed comment explicitly documents the reentrancy hazard: |
| 35 | [fix(compiler-vapor): wrap unref in parentheses for new expre](https://github.com/vuejs/core/pull/15834) | flagged | – | 13.3s | high correctness: The `unref` function no longer wraps the call in parentheses when the identifier appears in a `new` expression context. The old code checked |
| 36 | [fix(bundled-dev): include user `import.meta.env.*` defines i](https://github.com/vitejs/vite/pull/23713) | flagged | – | 25.2s | high correctness: Changed condition from `isBundled` to `isBuild`. These flags have different meanings: `isBuild` is true for any `vite build` command, while  |
| 37 | [fix(runtime-vapor): stringify symbol input values like vdom](https://github.com/vuejs/core/pull/15830) | flagged | – | 15.6s | high bug: Removing String() conversion breaks value comparison and attribute setting. oldValue is always a string (from el.getAttribute('value') or el |
| 38 | [fix(compiler-vapor): prefix cached expression names that sta](https://github.com/vuejs/core/pull/15828) | flagged | – | 17.4s | high correctness: The line `.replace(/^\d/, '_$&')` was removed, which previously ensured generated variable names don't start with a digit. JavaScript identi |
| 39 | [fix(compiler-vapor): map only declared identifiers in destru](https://github.com/vuejs/core/pull/15826) | flagged | – | 44.7s | high correctness: The old code explicitly collected only declared bindings from function parameters (via walkFunctionParams), which correctly excludes identif |
| 40 | [fix(runtime-vapor): preserve v-model branch scopes during mo](https://github.com/vuejs/core/pull/15822) | flagged | – | 15.8s | high correctness: The old implementation captured the current effect scope via getCurrentScope() and only executed the deferred callback if that scope was sti |
| 41 | [fix(query-core): preserve union narrowing in setQueryData up](https://github.com/TanStack/query/pull/11935) | flagged | – | 20.6s | high correctness: The updater parameter type was changed from InferDataFromTag<NoInfer<TQueryFnData>, TTaggedQueryKey> to NoInfer<TInferredQueryFnData>. This  |
| 42 | [Fix RSC external redirect tests after example.com page chang](https://github.com/remix-run/react-router/pull/15600) | missed | – | 13.3s |  |
| 43 | [fix(build): correct preloads when chunkImportMap is enabled ](https://github.com/vitejs/vite/pull/23698) | flagged | – | 23.0s | high bug: The fallback base URL changed from `options.base` (Vite's resolved base URL) to hardcoded `'/'`. The old comment explicitly states: 'Vite ov |
