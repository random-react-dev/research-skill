# Research skill

Install the published skill:

    npx skills add random-react-dev/research-skill

Ask your agent to use it for a public research question. The agent starts a
separate background worker and retrieves the cited result. Ordinary agent
configuration stays unchanged. The main agent still uses its own coordination
tokens. Coverage can be partial; source access and service budgets are finite.

## Release 0.3.0

This release includes the latest client fixes and the managed-worker implementation
for review. Ordinary installation still uses the limited public pilot. Managed
mode requires `RESEARCH_MANAGED_CLIENT=true` and explicit server admission;
setting the variable alone does not grant access. This release does not expand
the public service's finite lifetime allowances.

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

Tested native versions: macOS, Node 26, Codex 0.147.0, Claude Code 2.1.294.
Both native CLIs have passed tool and transport fixtures; separate live provider
checks and one Mac reboot/recovery test were recorded. That reboot test started
the helper and native worker automatically, but its research result was PARTIAL
with no claims after quote validation rejected the report. This is not proof of
complete research quality. A later live support diagnostic returned recorded
scheduler checks. Windows is not qualified. Later runtime changes have fixture
coverage; they have not each received a new physical reboot test.

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
