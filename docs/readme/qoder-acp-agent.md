# Qoder as an ACP agent

> **Not yet verified against a real Qoder CLI.** The harness is proved on every machine — a
> non-opt-in test drives it against the repo's own scripted ACP CLI — but no machine this feature
> was written on has Qoder installed, so the live handshake and the session-id check below have
> never been performed. Green tests do not mean the feature works. Run the two steps here and
> record the outcome before relying on it.

## Install and sign in

```bash
npm install -g @qoder-ai/qodercli        # global build, command: qodercli
npm install -g @qodercn-ai/qoderclicn    # China build, command: qoderclicn
qodercli login                           # qoderclicn login for the China build
```

There is no device-code flow. On a remote host, in a container or in CI the CLI
cannot open a browser: it prints the login URL and waits, so open that URL on your
own machine. There is no invisible prompt to wait on. The browserless alternative
is a personal access token in `QODER_PERSONAL_ACCESS_TOKEN`.

The two builds keep separate accounts and config homes: the global build reads
`QODER_CONFIG_DIR` (default `~/.qoder`), the China build reads `QODERCN_CONFIG_DIR`
(default `~/.qoder-cn`). Sign in to each one separately.

## Use it

Orca drives Qoder CLI over ACP: the CLI serves ACP on stdio and the chat is the client.
Pick **Qoder CLI** in a chat's agent picker; it answers in native chat, not in a pane.

To confirm the ACP chat is the one talking: the chat's agent is the **Qoder CLI** entry
(or **Qoder CLI China**), and the session shows up in the AI Vault's History rows under
that agent. An ACP session never opens a terminal pane; a pane is the terminal Qoder
agent.

## The handshake test (opt-in)

```bash
# Opt-in: it stays skipped everywhere else, and it spawns `qodercli --acp`.
ORCA_REAL_QODER_CLI_TEST=1 pnpm test src/main/qoder/qoder-acp-session-launch.test.ts --maxWorkers=2
```

Every build whose binary is installed is proved; the build that is not installed is
skipped. The suite fails when no build is installed, and when an installed build
cannot sign in.

The switch also enables the older `src/main/qoder/real-cli.test.ts`, which drives the
real CLI through a full managed task. Name the single file above unless you want that
too.

## Check the session id against `--resume`

The History row and the terminal-resume guard assume the id the ACP session reports
is the id `qodercli --resume` opens. Run the test with both variables set:

```bash
ORCA_REAL_QODER_CLI_TEST=1 ORCA_QODER_PROOF_PATH=/tmp/qoder-acp-proof.json \
  pnpm test src/main/qoder/qoder-acp-session-launch.test.ts --maxWorkers=2
```

Then check the `sessionId` of the build you installed in the proof file's `builds`
array: it must open with `qodercli --resume '<sessionId>'` and name the transcript
`~/.qoder/projects/*/<sessionId>.jsonl` (China build: `~/.qoder-cn/...`).

If no proof file appears, the suite skipped: `ORCA_REAL_QODER_CLI_TEST=1` was missing,
so the run did nothing at all. Run the command above exactly as written. If the suite
ran and failed instead, the CLI is not signed in — sign in with `qodercli login` and
run it again.

If either id check fails, the two ids are different id spaces: the ACP session id
cannot be used to resume from a terminal, so a History row would name an id `--resume`
cannot open. Nothing else changes that — repeat this manual step once a newer CLI
release is installed, and report the mismatch if it survives the upgrade.
