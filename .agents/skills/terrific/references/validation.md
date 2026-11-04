# Validation

Use this flow when the expected behavior is known and the task is to show whether it holds, or to measure it: latency, streaming, ordering, retries, what a process emits. It uses the same endpoints, telemetry and sessions as the debug workflow in SKILL.md. The difference is that each diagnostic is expected to pass.

## Workflow

1. State the claim in one sentence, and list the cases it covers: inputs, providers, environments. Read the code that produces the behavior.
2. Write 1-3 diagnostics before running anything. Each has a stable slug (`first-output-latency`, `chunked-output`), the metric it measures, and a pass criterion (`first output before 5 s`, `more than 1 chunk`). If the user gave no threshold, ask, or report the measurement without a verdict.
3. Run `terrific ingest list`, then reuse or open the stage endpoint with `terrific ingest up <name>`.
4. Instrument only the points that produce the metrics, following [telemetry.md](telemetry.md).
   - Put the diagnostic slug in `diagnosticSlug` and the case in `data.case`, so every event says which diagnostic and which case it measures.
   - Measure inside the process, with `timestamp` or durations in `data`. Do not time output read through a pipe or a terminal, because both buffer.
   - Keep `source` as the `file:line` of each call, even when a shared helper posts.
5. Probe: run one case, then `terrific ingest tail <name>`. Every instrumented point must appear. Fix the instrumentation before starting a session.
6. Start a session linked to the endpoint, without a browser unless the claim is about UI: `terrific start "<claim>" #<name> --no-browser`. Run every case with the same inputs, and mark each one with `terrific note <id> <case>`.
7. Stop with `terrific stop <id>`. Read `terrific prompt <id>`, then compute the metrics per case from `terrific events <id> --type ingest --json` ([events.md](events.md) lists the fields).
8. Rate each diagnostic per case PASS, FAIL or INCONCLUSIVE. A missing event means INCONCLUSIVE: refine the instrumentation and rerun, do not estimate.
9. If code changes afterwards, rerun the same cases in a new session with the same instrumentation and inputs, and compare it with the baseline session. If a FAIL has no evident cause in the evidence, switch to the debug workflow and use the baseline as the failing session.
10. Remove the instrumentation after the last comparison, unless the user wants to keep it.

## Rules

- Criteria are fixed before the first run. If a threshold turns out to be wrong, say so and report the results against both.
- Validation measures; it does not fix. Propose changes and wait, unless the user asked for the fix.
- A re-measurement the user chose is part of the task. Do not finish without it, or say plainly that it was not done.

## Final answer

Give:

- the claim, and each diagnostic with its criterion;
- a table of cases by diagnostic, with the measured value and PASS, FAIL or INCONCLUSIVE;
- the baseline and comparison session ids, with event times;
- what was run, and whether the instrumentation was removed;
- what the cases did not cover.
