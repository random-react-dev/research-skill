# Research skill

Install the published skill:

    npx skills add random-react-dev/research-skill

Ask your agent to use it for a public research question. The agent starts a
separate background worker and retrieves the cited result. Ordinary agent
configuration stays unchanged. The main agent still uses its own coordination
tokens. Coverage can be partial; source access and service budgets are finite.

## Release 0.4.0

New jobs connect the native worker directly to the gateway's HTTP MCP. They use
managed execution and require explicit server admission. There is no silent
fallback to the old evidence bridge. A PC that has not been admitted receives
WORKER_ADMISSION_DISABLED; the operator must admit it before it can test this path.
Existing saved jobs retain their original transport. Lifetime allowances are unchanged.

Managed mode adds server research coordination, durable recovery, installation
status, event uploads and dashboard support jobs. It launches an isolated native
CLI with full current-user tool access: Codex `danger-full-access` or Claude
`bypassPermissions`. It can read, write, delete and execute within that OS user's
permissions; it does not grant root or administrator rights. Normal agent settings
remain unchanged. Installing the skill alone runs no code or startup task.

Managed mode remains an experimental, explicitly admitted test workflow. Its
operator dashboard currently has unauthenticated test controls; do not enable
this mode on additional PCs until dashboard access is protected. The operator
can supply per-PC instructions that the server model uses to direct local work.
Questions, worker tool exchanges and bounded diagnostic events can reach the
server. Do not provide confidential research input. Private server instructions
and server-distributed artifacts are not included in this client repository;
a client-only audit cannot establish their behavior or safety.

## Verified scope

Verified on macOS with Node 24.1.0 and Node 26.0.0. Direct MCP submission
fixtures passed with Codex 0.133.0, Codex 0.147.0 and Claude Code 2.1.294.
Both current native CLIs also retrieved their task-bound status through the live
public gateway using a fixture model, with no paid model calls.

Full live research with the new direct transport has not yet been run. The
previous release has live provider and Mac reboot evidence, but that does not
qualify this release's complete research or physical reboot behavior. Recovery,
Stop, stale-runner and installation fixtures passed. Windows is not qualified.


The private package flag prevents accidental npm publication. Installation uses
GitHub through the skills CLI, not an npm install hook.

## Commands

Use `scripts/run-research.mjs` relative to the installed skill directory:

- `check WORKER ABSOLUTE_CLI_PATH`
- `start WORKER ABSOLUTE_CLI_PATH` with question JSON on stdin
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
