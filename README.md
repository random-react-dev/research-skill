# Research skill

Install the published skill:

    npx skills add random-react-dev/research-skill

Ask your agent to use it for a public research question. The agent starts a
separate background worker and retrieves the cited result. Ordinary agent
configuration stays unchanged. The main agent still uses its own coordination
tokens. Coverage can be partial; source access and service budgets are finite.

## Release 0.5.0

New jobs connect the native worker directly to the gateway's HTTP MCP. They use
managed execution. On first use the background worker connects to the gateway,
sets up the server-distributed helper after startup authorization, and research
is admitted automatically once the scheduler callback is verified. Returning
installations reuse their approval. Service availability and lifetime usage
allowances still apply. Existing saved jobs retain their original transport.

Managed mode adds server research coordination, durable recovery, installation
status, event uploads and dashboard support jobs. The background worker can run
commands and access files with your user account’s permissions. Normal agent
settings remain unchanged. Installing the skill alone runs no code or startup task.

Public enrollment uses verified helper setup instead of manual PC allowlisting.
The public dashboard is status-only; operator controls remain private.
The operator can supply per-PC instructions that the server model uses to direct local work.
Questions, worker tool exchanges and bounded diagnostic events can reach the
server. Do not provide confidential research input. Private server instructions
and server-distributed artifacts are not included in this client repository;
a client-only audit cannot establish their behavior or safety.

## Verified scope

Automatic enrollment fixtures use actual Codex and Claude workers with a mock
model and scheduler: helper download, hash verification, installation callback
and research-after-approval passed. A live first-use/reboot test of this release
is still required. No new paid model test was run for this release.

The earlier direct-MCP release was verified on macOS with Node 24.1.0 and Node 26.0.0. Direct MCP submission
fixtures passed with Codex 0.133.0, Codex 0.147.0 and Claude Code 2.1.294.
Both current native CLIs also retrieved their task-bound status through the live
public gateway using a fixture model, with no paid model calls.

A live Codex job submitted successfully and returned a cited PARTIAL report
with truncated source coverage. A live Claude job exposed post-submission polling
and ended with an unknown outcome after five model requests. The client now
ends the worker locally after confirmed submission; both native-worker fixtures
verify this handoff without another paid turn. A new paid Claude run and physical
reboot test of this exact release remain outstanding. Recovery,
Stop, stale-runner and installation fixtures passed. Windows is not qualified.


The private package flag prevents accidental npm publication. Installation uses
GitHub through the skills CLI, not an npm install hook.

## Commands

Use `scripts/run-research.mjs` relative to the installed skill directory:

- `check WORKER ABSOLUTE_CLI_PATH`
- `start WORKER ABSOLUTE_CLI_PATH` with question JSON on stdin
- `authorize-startup JOB_ID` after device-owner authorization
- `status JOB_ID` and `result JOB_ID`
- `cancel JOB_ID`, `pause JOB_ID`, `resume JOB_ID`

`WORKER` is `codex` or `claude-code`. Keep the same job identity through recovery.
A start receipt is not a completed report. Unknown operations are not retried
blindly. Completed results remain available through the commands above;
automatic delivery to the originating chat is outside this release scope.

Access is established on first use through the existing gateway. No provider
key or manual token copying is required. Access failure does not reset identity
or budgets. Installing the skill alone does not start research.

See [the client contract](references/contract.md) for bounded profiles and
compatibility behavior. No unlimited service or guaranteed savings are promised.

First-use setup may take longer than the initial 30-second status check. The helper
reconnects after login; it cannot run while the PC is powered off. macOS is the
currently qualified runtime; Windows enrollment is not enabled. A scheduler
callback verifies setup, not a real reboot test or tamper-proof device identity.
