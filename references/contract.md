# Client contract

New starts use direct-mcp-v1: the native CLI connects to the existing HTTPS MCP
endpoint with private per-worker configuration. research_task is bound to the
admitted task and coordinator generation through HTTP headers and the existing
authenticated installation. Model arguments cannot replace this context. The
coordinator uses research_managed_request for admission, API relay and lifecycle.
Direct tool discovery is checked before paid inference. Submission and support
completion are reconciled from authoritative server state.

Saved jobs without this transport field keep their previous implementation.
Their v1 compatibility contract appears below. No global agent configuration is
changed. Native requests carry the isolated worker conversation and tools;
do not send confidential material as a public research question.

The managed default profile is 24 hours, 20 model requests, 1 MiB prompt bytes,
64 KiB report, 3072 output tokens per turn, and a 400000 microUSD estimated cost
gate. X collection allows 30 counted physical requests and four result pages, including cold-start setup; at most 32 source excerpts are retained. These are requested ceilings, not a funding grant or guaranteed invoice cap.
Server policy may deny them. Results preserve partial coverage and unknown usage.

## v1 compatibility boundaries

One server tool: research_worker_request(request), protocol research-worker-v1.
The task contains protocol_version, UUIDv4 task_id, public question <=2048 UTF-8
bytes and a finite profile. The supervisor owns the frozen task. No CLI system
prompt, workspace, arbitrary tools or private history is forwarded. HTTPS endpoint
and redirects remain restricted; fixture override is localhost-only.

Operations: turn (zero-based, below profile.model_requests, previous_response_id,
tool_outputs), read-evidence (call_id), status/result/cancel and pause/resume.
Evidence tool kinds: web, article, x_search, x_replies, video. Article accepts a
server-known source_id or public url, optional static/auto/crawl/playwright mode.
Web accepts recency_days; X replies accepts post_id. Owned pagination uses
{kind,child_job_id}. Evidence receipts include sources, coverage,
complete_source_coverage:false and children with continuation_available.

The local evidence MCP response is only {protocol_version,task_id,call_id,
evidence_sha256}, at most 512 UTF-8 bytes. The hash covers the canonical complete
evidence envelope held in the supervisor. The client compares this decoded
receipt exactly against its expected task/call/evidence identity. Full evidence
stays on the server and supervisor; no extra file tool or output limit is needed. Its canonical continuation sends {call_id,output:{evidence_ref:call_id}}
to avoid echoing large excerpts through the unchanged 48 KiB request boundary.
The server accepts this reference only for owned, durably known pending evidence;
legacy exact evidence echo remains compatible. It uses its own stored evidence.
Identical native requests reuse known transport replies, and concurrent evidence
calls share one promise. Pending/unknown server operations stop; no blind replay.

Default profile remains the historical small fixture profile (300 execution
seconds, 3 model requests, 32 KiB prompt/report, estimated cost gate 20000 microUSD;
collection 180 seconds, 900 resume seconds, 40 records, one article URL, 1 MiB,
90 request seconds, zero retries, 64 KiB output; web requests/pages 2, other
providers 1). These defaults are not product maximums. Optional evidence_rounds,
output_tokens, evidence_sources and excerpt_chars request larger finite values.
Server defaults are model_requests-1 (minimum 1), legacy per-phase output caps,
16 sources and 1500 excerpt characters. Server operator ceilings decide admission;
client profile edits never increase server/service allowances or funded access.

Client hard transport safety limits: canonical request 49152 bytes, remote
response 16 MiB, report at most 8 MiB; actual edge/server ceilings can be lower.
Task deadline defaults to execution_seconds plus 60 seconds and cannot exceed
Node's finite timer range. Cleanup has one 10-second deadline. Local request and
stream limits scale with task turns/report size; evidence-MCP input has a finite
16 MiB/100000-message process cap. Native CLI output and report validation use
the requested report bound. Larger limits have not been qualified against live
CLIs or the deployed edge.

STARTING/RUNNING are local process states. pause writes a private marker; the
runner asks the server only at a safe between-operation boundary after admission.
It reports PAUSED only on the server's confirmed PAUSED receipt. Resume requires
local PAUSED, retains task/job identity and reads the server resume snapshot:
RUNNING, next_turn, response_id, pending {call_id,arguments,evidence}. It validates
that snapshot, reconstructs only public protocol fields, and gives a fresh task-
isolated CLI the known pending call before permitting the next canonical turn.
Known evidence is reused. No private history/provider call ID enters the CLI.
Server expiry and all cumulative allowances are unchanged. Busy, lost, or
unconfirmed pause/resume outcomes are INTERRUPTED_UNKNOWN, never auto-retried.

COMPLETED/PARTIAL/FAILED/CANCELLED_LOCAL/CANCEL_PENDING/INTERRUPTED_UNKNOWN/PAUSED
and STALE retain distinct meanings. Server report/usage remains authoritative.
A local failure may retain a validated server result. Local cancellation or
process shutdown does not prove billing stopped. Stale processes are never
signalled via saved PIDs or automatically readmitted.

Only a one-task localhost capability enters child environment. Bearer/provider
credentials, proxies, NODE_OPTIONS, shell hooks and normal agent settings are
not inherited. Native protocol token placeholders are not provider billing.
Automatic first use preserves the existing trusted-device token when present;
otherwise it generates/persists one install capability and posts only {token}
to the fixed HTTPS origin /bootstrap, without redirects. The server returns
only {owner,expires_at,scope:"public-worker"}; the locally held capability is the
bearer for the same /mcp. Atomic nonempty-directory publication makes concurrent
first uses share one capability. Unsafe/malformed state fails closed. A private confirmed owner/scope/expiry receipt avoids bootstrap while valid.
Retry or expired-grant renewal reuses identity; a revoked credential is never automatically replaced.
Bootstrap replies are bounded to 4096 bytes. No account store or provider key is
read, and no access operation occurs merely by installing the skill.
The first public research job performs one-time service enrollment inside the
worker with startup authorization recorded at admission; research submits after
the scheduler receipt verifies the helper. Existing helper installations remain
compatible. Usage budgets are not reset.
Public dashboards expose status only; owner control remains private.
See README for the current release and test limitations.

Worker query strings have schema maxLength 2048 and a stricter runtime 2048
UTF-8-byte limit before trimming. Trim uses the union of ECMAScript and Python whitespace, including
U+FEFF, U+0085 and U+001C–U+001F; empty normalized queries are rejected. The server
emits normalized model decision arguments. Legacy collector behavior is unchanged.

Public access objects retain a same-capability resolver across in-process spread
into running and cleanup MCP clients. Before each MCP RPC dispatch, the resolver
checks the confirmed grant and renews only if expired, using the current client's
signal. Renewal must preserve the original endpoint, capability and owner. Lost
or changed active-task credential files fail closed; this path cannot enroll a
new identity. Legacy trusted access and JSON-persisted explicit fixture access
stay unchanged. No failed/ambiguous model or evidence dispatch is retried by this
resolver; renewal happens only before a requested dispatch.
