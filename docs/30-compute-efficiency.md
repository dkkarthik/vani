# Measuring and reducing VANI's reading workload

Broad discovery limits are ceilings, not reading targets. Each stage now runs in
measured waves: **40 D1 calls, 10 D2 calls, 3 D3 calls** by default. Candidate
comparisons and deep readings take priority over additional abstract screening,
so a first wave can produce useful evidence without screening hundreds of papers.
Change wave budgets under **Edit focus and anchors**. Broad retrieval/ranking
ceilings remain unchanged until researcher feedback supports reducing them.

## Controls and diagnostics

The collection's **Compute and reading quality** panel reports model calls,
evidence-valid assessments, validity rate, model minutes, minutes per valid
assessment, output tokens and error codes. Valid evidence is not a claim that the
paper is relevant. Supply candidate feedback to establish that independently.

**Pause reading** stops further calls; an in-flight call may finish. Five consecutive
failures or eight failures in ten attempts pause a stage automatically. Exhausting
a stage's wave budget also pauses the run. Daily scheduling and **Search / resume**
do not release protected pauses. **Start next measured wave** explicitly permits
another wave without erasing failure history or fingerprint gates.

Candidate **Evidence and history → Inspect** loads exact bounded inputs, raw
output, model identity, tokens, timing and each failing rule. Raw/full evidence is
local data, not sent to cloud models. Normal collection lists contain aggregates,
not private packets. Only the latest 20 full packets per candidate are retained;
compact metadata and fingerprint gates remain. Legacy exhausted failures require
an explicit targeted re-read or changed source/focus.

An identical rejected packet is not regenerated automatically. Other model errors
get at most two calls per fingerprint across refreshes. The fingerprint includes
actual evidence, focus, model digest, prompt/schema version and model limits.
Targeted **read** is an explicit one-time override, still subject to batch holds.
New PDFs or other changed inputs become eligible when the next refresh considers
them; a protected hold still requires researcher action.

## Repeatable replay on quasar

Use a clean built checkout (`npm run build`) and an SSH tunnel or run the export on
quasar against its loopback API. Files are created privately and never overwritten.

```bash
# Export a recorded attempt, including its original raw output.
node scripts/debug/replay.mjs export ATTEMPT_UUID /private/path/attempt.json --url=http://127.0.0.1:8080
# Or assemble current local evidence for a candidate without running inference.
node scripts/debug/replay.mjs packet CANDIDATE_UUID /private/path/packet.json --url=http://127.0.0.1:8080
# Revalidate stored output locally, with zero model calls.
node scripts/debug/replay.mjs validate /private/path/attempt.json /private/path/validation.json
```

Stage a packet or JSON array of packets at
`/data/install/vani-debug/replay-input.json`, then use the laptop controller:

```bash
python3 -I scripts/debug.py run --job replay --maintenance
python3 -I scripts/debug.py status
python3 -I scripts/debug.py logs
python3 -I scripts/debug.py fetch
```

This job runs at most five packets with each profile on debug Ollama port 11437:
original settings, then a concise non-thinking profile capped at 3,072 output
tokens. It uses the existing GPU maintenance/recovery protocol. Reports include
model digests, issue details, outputs, timing, tokens and existing human feedback.
A model failure is recorded in the report; job completion alone does not mean
all replayed comparisons passed. No collection membership, production ranking,
model profile or reading budget is changed by replay.

## Tuning loop

1. Freeze a small representative packet set: successful comparisons, each common
   failure class, cross-domain method matches, obvious negatives and missing data.
2. Diagnose exact failures offline; compare original and proposed reader settings
   on the same packets. Do not remove evidence checks to improve pass rates.
3. Have the researcher judge contribution accuracy, relationship, relevance and
   omissions. Keep a separate held-out set of expected relevant papers.
4. Compare useful accepted papers per GPU minute and held-out recall, not only
   JSON validity. Count failed/retried calls in the cost denominator.
5. Change one setting at a time. Reduce reading wave sizes or promote a cheaper
   reader only if scientific quality holds. Reduce discovery ceilings only after
   coverage testing, including uncertain and cross-domain papers.
6. Keep the high-cost baseline and before/after artifacts. Re-run the fixture set
   after model, prompt, evidence extraction or ranking changes.

Automatic relevance-based compute adaptation is deliberately not claimed: the
replay and feedback evidence must establish a reliable policy first.
