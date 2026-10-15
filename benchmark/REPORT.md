# Lorica benchmark

Run 2026-10-15 with model `nvidia/nemotron-3-ultra-550b-a55b:free` and the `chill` profile. 27 real bugs from 7 open-source repositories. Reproduce with `pnpm benchmark collect && pnpm benchmark run && pnpm benchmark judge`; add `pnpm benchmark index` and `--graph` for the graph comparison.

## Results (diff only)

| Metric | Value |
| --- | --- |
| Real bugs identified (finding describes the fixed defect) | **22 / 27 (81%)** |
| Real bugs flagged (finding within 3 lines of the defect) | 26 / 27 (96%) |
| Valid structured responses | 27 / 27 (100%) |
| Review time, median | 32.7s |
| Review time, p90 | 109.9s |
| Findings per review, mean | 1.4 |
| Prompt tokens removed by file filtering | 24% (116,471 → 88,443 est. tokens over 40 PRs; 12 PRs had files filtered) |

## Method

- **Cases:** merged PRs with "fix" in the title, touching 1–3 source files (no examples or docs) and 2–60 changed lines, at most 15 per repository, from sveltejs/svelte, vuejs/core, nestjs/nest, vitejs/vite, TanStack/query, colinhacks/zod, remix-run/react-router. Each patch is reversed so the diff reintroduces the bug the maintainers fixed. The title is replaced, and the description and test changes are withheld.
- **Flagged:** any finding points within 3 lines of a reintroduced change. On small diffs this is loose, so it is an upper bound.
- **Identified:** a judge model, given the real fix's title and patch, says a flagged finding describes the same defect. This is the headline number. 1 verdict was made by hand after the judge hit a rate limit (marked in the results files).
- **Graph context:** the production indexer builds the code graph of the fix PR's base commit (the code with the bug) in Neo4j, and the review receives the same one-hop traces it would in production.
- **Caveats:** a "fix" PR is not always a bug, LLM judging can err in either direction, and public repositories may be in the model's training data. Every case is listed below so each verdict can be checked.
- **Filtering:** the most recent merged PRs from the same repositories, estimated at ~3 characters per token, before and after the built-in filter (lockfiles, generated, vendored, assets, docs, deletions).
- **Not measured:** false-positive rate (findings away from the bug may still be valid).

## Cases

| # | PR | Diff only | With graph | Time | Nearest finding (diff only) |
| --- | --- | --- | --- | --- | --- |
| 1 | [fix: `devalue` link in `hydratable_serialization_failed` err](https://github.com/sveltejs/svelte/pull/18999) | identified | – | 9.7s | medium bug: The URL was changed from `https://npmjs.com/package/devalue` to `https://npmjs.com/package/uneval`. However, `uneval` is a function exported |
| 2 | [fix(runtime-vapor): push warning context during render effec](https://github.com/vuejs/core/pull/15874) | identified | – | 19.6s | medium correctness: The call to `pushWarningContext(instance)` was removed from the render effect's run method. This function establishes the component instance |
| 3 | [fix(common): call `stringifyReplacer` with the logger as `th](https://github.com/nestjs/nest/pull/18146) | flagged | – | 33.8s | high bug: The change from `this.stringifyReplacer.bind(this)` to `this.stringifyReplacer` combined with calling it via `replacer.call(this, key, value |
| 4 | [fix(common): detect stacks whose error message spans several](https://github.com/nestjs/nest/pull/18145) | identified | – | 69.4s | high security: The new regex reintroduces a catastrophic backtracking (ReDoS) vulnerability that the previous code explicitly avoided. The old comment warn |
| 5 | [fix(common): parse `error()` calls with a lone or an undefin](https://github.com/nestjs/nest/pull/18144) | flagged | – | 11.7s | high bug: The handling for `args.length === 1` was removed entirely. When a single argument is passed, the function no longer returns the result from  |
| 6 | [fix(optimizer): scan `oxc.jsxInject` imports](https://github.com/vitejs/vite/pull/23758) | missed | – | 31.1s |  |
| 7 | [fix(core): key the handler metadata cache by class, not clas](https://github.com/nestjs/nest/pull/18143) | identified | – | 43.7s | critical bug: The getMetadataKey method receives a controller class constructor (TKey extends Type<unknown>) but treats it as a Controller instance. It ac |
| 8 | [fix(runtime-vapor): remove block node from its actual parent](https://github.com/vuejs/core/pull/15867) | identified | – | 37.6s | high bug: The condition changed from `else if (parent)` to `else`, and the implementation changed from using `block.parentNode` (the actual DOM parent |
| 9 | [fix(runtime-vapor): defer interop fragment removal until lea](https://github.com/vuejs/core/pull/15866) | identified | – | 49.6s | high correctness: The transition leave logic for vapor components inside fragments is broken. The old code had special handling to call `getTransitionElement` |
| 10 | [fix(runtime-vapor): render nothing for an invalid v-for rang](https://github.com/vuejs/core/pull/15863) | identified | – | 30.5s | high correctness: The validation for v-for range input (non-integer or negative numbers) is now only executed in development mode (__DEV__). In production, in |
| 11 | [fix(core): release the throwaway wrapper of each create() ca](https://github.com/nestjs/nest/pull/18137) | identified | – | 18.8s | high bug: The `finally` block that called `wrapper.detachFromDependencies()` was removed. This method cleaned up dependency tree references (via `depe |
| 12 | [fix(microservices): match empty mqtt topic levels](https://github.com/nestjs/nest/pull/18127) | identified | – | 79.4s | high bug: The change from `isUndefined(currentTopic)` to `!currentTopic` incorrectly treats empty string topic segments as missing. In MQTT, topics li |
| 13 | [fix(microservices): ignore a redis server's own replies unde](https://github.com/nestjs/nest/pull/18125) | identified | – | 9.8s | high correctness: The PR removed the guard that prevents the server from processing its own reply messages when wildcard subscriptions are enabled. Previously |
| 14 | [Fix/angular devtools lifecycle](https://github.com/TanStack/query/pull/11999) | flagged | – | 63.1s | high bug: The cleanup that resets `devtoolsProvided.isProvided = false` on component destruction was removed. This flag is checked at line 70 (`if (de |
| 15 | [fix(v4): report a union option that only checks rejected](https://github.com/colinhacks/zod/pull/6662) | flagged | – | 20.8s | high correctness: The change removes the fallback logic that handled cases where all union members produce errors but exactly one member produces only 'contin |
| 16 | [fix(v4): run a record's key schema on an own __proto__ key](https://github.com/colinhacks/zod/pull/6660) | identified | – | 232.6s | critical security: In loose mode, when key validation fails for a '__proto__' key, this code writes the unvalidated value to output['__proto__'], which mutates |
| 17 | [fix(core): keep route options when the route triggered hook ](https://github.com/nestjs/nest/pull/18121) | identified | – | 14.9s | high correctness: The change removes Object.assign and copyMetadataToCallback which were copying route metadata (e.g., version) from the original handler to t |
| 18 | [fix(express): guard async request hook completion](https://github.com/nestjs/nest/pull/18110) | identified | – | 27.3s | high bug: The onRequestHook type signature declares the third parameter as `done: () => void` (no arguments), but at line 94 the code passes `next` (E |
| 19 | [fix(fastify): answer the shutdown hooks 503 with fastify's j](https://github.com/nestjs/nest/pull/18109) | identified | – | 40.8s | high correctness: Changed the 503 response during shutdown from JSON format (matching Fastify's native 503 response) to plain text. The removed comment explic |
| 20 | [fix(core): fail at startup for request-scoped class global e](https://github.com/nestjs/nest/pull/18104) | identified | – | 198.4s | high bug: The condition changed from `!instanceWrapper.isDependencyTreeStatic()` to `isNil(instanceWrapper.instance) && !instanceWrapper.isDependencyT |
| 21 | [fix(runtime-vapor): start a vapor slot vnode in a vdom outle](https://github.com/vuejs/core/pull/15850) | identified | – | 109.9s | high bug: This change makes n2.el and n2.anchor point to the same node (selfAnchor). Previously, n2.el was a newly created text node and n2.anchor was |
| 22 | [fix(fastify): honor `return503OnClosing` during the shutdown](https://github.com/nestjs/nest/pull/18101) | identified | – | 14.4s | high correctness: The `beforeClose()` method and the `onRequest` hook that returns 503 during shutdown have been removed. Previously, `beforeClose()` would se |
| 23 | [fix(microservices): default server options like the client f](https://github.com/nestjs/nest/pull/18100) | identified | – | 16.7s | high bug: Removed the default value `= {}` for `options` destructuring. If `microserviceOptions` does not include an `options` property (which is vali |
| 24 | [fix(microservices): fail mqtt requests whose publish fails](https://github.com/nestjs/nest/pull/18095) | identified | – | 32.7s | high bug: The error-handling callback was removed from the method call. The original callback checked for errors and if the client wasn't torn down, i |
| 25 | [fix(node): write file sessions atomically](https://github.com/remix-run/react-router/pull/15620) | identified | – | 8.9s | high correctness: The atomic write pattern has been removed. The original code wrote to a temporary file and used rename() to atomically replace the session f |
| 26 | [fix(runtime-vapor): finish a deactivation leave where the el](https://github.com/vuejs/core/pull/15846) | identified | – | 33.1s | high bug: The condition `!anchor \|\| anchor.parentNode === parent` was removed. This condition guarded against inserting a block before an anchor tha |
| 27 | [fix(runtime-vapor): render the deferred out-in branch where ](https://github.com/vuejs/core/pull/15844) | identified | – | 54.0s | high bug: The check `if (isTransitionEnabled && (block as DynamicFragment).leaving) return` was removed from the move() function. This check prevented |
