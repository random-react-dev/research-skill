# Research skill

The main agent starts a short-lived background Codex or Claude Code worker.
Native inference/tool continuations translate to research-worker-v1 through the
existing gateway. Provider credentials, private instructions and authoritative
evidence stay server-side. The supervisor gives the isolated worker only a
one-task localhost capability. Normal agent settings remain unchanged.

## GitHub skill installation

Install the published client:

    npx skills add random-react-dev/research-skill --skill research-skill --agent codex --agent claude-code

The client repository is published. A bounded, operator-funded public pilot was
active as of 2026-10-14 03:25 UTC; availability remains subject to its finite
allowances. Publishing the files alone does not establish broad live research
readiness. The skill uses SKILL.md and bundled scripts/runtime, with no npm
publication/bin, install hook, agent CLI download, daemon or new launch interface.
The existing private package.json is bundle metadata, not an npm distribution plan.

Official skills 1.7.2 was pinned for disposable project-local tests of both
symlink and --copy layouts targeting Codex/Claude. The installer was obtained
from its official npm package with install scripts disabled. Its local-source
install runs had outbound Node network blocked and telemetry disabled. Only
disposable HOME/project directories were touched. Installed modules resolve
relative to SKILL_DIR; loopback dummy first-use tests reuse one capability.
Those historical tests validated local installation mechanics only. Subsequent
clean remote installs from this GitHub repository passed all four combinations
of Codex/Claude and symlink/--copy layouts on 2026-10-13. These install checks do
not establish native research quality or broad source coverage.

Sources: https://github.com/vercel-labs/skills and
https://registry.npmjs.org/skills/1.7.2 (checked 2026-10-13).

## Automatic access on first research run

If the existing trusted-device research-gateway cloud.token is present, it is
used without enrollment. Unsafe/malformed existing credentials fail closed.
Otherwise the supervisor generates 32 random bytes encoded as a URL-safe private
capability, atomically publishes it in ~/.config/research-gateway/public-install,
and POSTs {token: capability} to the fixed HTTPS gateway origin /bootstrap.
Redirects and arbitrary endpoint overrides are denied. The bounded response
contains owner, expiry and fixed public-worker scope; no secret is returned.
The same locally held capability authorizes the existing /mcp endpoint.

Concurrent processes converge on one complete private capability file. A private receipt caches the confirmed owner/scope/expiry. Later research runs
reuse an unexpired capability without bootstrap; expired grants request
authorized renewal with the same capability. Every MCP dispatch rechecks this
access boundary, so expiry during a running task is renewed before evidence,
model or lifecycle dispatch. Cleanup clients use their own fresh abort signal.
Missing/replaced active-task credentials fail closed without creating a new
identity. Ambiguous dispatch failures never trigger automatic replay. A
network error, disabled service or revocation never rotates the capability or
resets budgets. No login, account-store lookup, manual token/provider-key entry
or alternative account is used. Installing the skill alone makes no grant.

The active pilot has finite lifetime ceilings of 100 model calls, 500,000 prompt
bytes, 250,000 reserved output tokens and 100 installation grants, including
prior usage. Grants expire after 24 hours; renewal with the same capability does
not reset cumulative budgets. Exhausted allowances automatically deny further
usage, without automatic charging or replenishment; this is not an invoice-cost
guarantee. SERVICE_NOT_ACTIVATED means access is not enabled;
SERVICE_ACCESS_DENIED means the existing access was refused;
SERVICE_ACCESS_UNAVAILABLE means the gateway/network could not establish access.
Never delete state or change identity to evade a denial or quota. Anonymous
install capabilities do not prove unique people or promise unlimited funding.

## Running research

Use scripts/run-research.mjs: start|run|check WORKER ABSOLUTE_CLI_PATH, with task
JSON on stdin for start/run; status|result|cancel|pause|resume JOB_ID. WORKER is
codex or claude-code. Scripts resolve relative to the installed SKILL_DIR.
Start acknowledges CLI spawn or STARTING; only results establish completion.
Private background receipts live in the skill's task state directory.

Public tools cover web, article modes static/auto/crawl/playwright, X search and
replies, and video, with owned child continuation. Finite task profiles request
turns, evidence rounds, duration and report sizes within operator ceilings.
X search/replies share allowances. Visible replies are subsets, Reddit page
retrieval is not exhaustive comment retrieval, and video data does not guarantee
transcripts. Unsupported, blocked, protected and truncated sources stay explicit.

Intentional pause is checked between operations and reported only after a
confirmed server PAUSED receipt. Resume preserves task identity, original expiry,
cumulative budgets and known evidence. Unknown outcomes stop without inference
replay. Cancel of a paused job does not spawn a new worker. Local shutdown does
not prove remote billing stopped; validated server reports survive local errors.

The native evidence tool returns only a <=512-byte deterministic task/call-bound
SHA-256 receipt. Full evidence remains server/supervisor-side and final citations
remain intact. No file-read tool or increased MCP output cap was added. Worker
queries have a raw 2048 UTF-8-byte bound before shared Unicode whitespace trim;
legacy collector queries retain their existing behavior.

## Qualification and tests

Historical native fixtures covered macOS/Node26/Codex0.147.0/Claude2.1.294.
Accepted client bytes passed six genuine installed native CLI fixtures using
mocked server/provider responses. One server-only DeepSeek configuration request
succeeded. On 2026-10-13 (Codex) and 2026-10-14 (Claude), one genuine live static
Python asyncio article case per agent returned a cited PARTIAL result with explicit
truncation.
This qualifies that narrow path only, not broad source coverage. Production
preflight still permits macOS/Node26 only and does not install another runtime.
Claude non-Claude routing is a custom compatibility path outside
Anthropic-supported gateways:
https://code.claude.com/docs/en/llm-gateway

Cloud Node24 fixtures use synthetic CLI processes and dummy loopback services.
Cross-language tests exercise actual Python server classes with HTTPX/collector
fixtures and outbound Python sockets denied. Model/provider data in these
fixtures is mocked.
Native protocol usage placeholders are not billing receipts; server attempts and
usage remain authoritative, and the main agent still uses its normal tokens.

Run node --test ../client-tests/*.test.mjs from this directory. Cross-language
fixtures use the existing task plan5/implementation/.venv, not a new environment.
Official installer tests run only when RESEARCH_SKILLS_FIXTURE_CLI points to the
reviewed skills1.7.2 bin/cli.mjs; otherwise they are explicitly skipped. No test
automatically installs dependencies, downloads agent CLIs or accesses a real grant.
See references/contract.md for wire and lifecycle boundaries.
