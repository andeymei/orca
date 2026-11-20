# Qoder as an ACP agent

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

## The handshake test (opt-in)

```bash
# Opt-in: it stays skipped everywhere else, and it spawns `qodercli --acp`.
ORCA_REAL_QODER_CLI_TEST=1 pnpm test src/main/qoder/qoder-acp-session-launch.test.ts --maxWorkers=2
```

## Check the session id against `--resume`

The History row and the terminal-resume guard assume the id the ACP session reports
is the id `qodercli --resume` opens. Run the test with
`ORCA_QODER_PROOF_PATH=/tmp/qoder-acp-proof.json` set, then check that its `sessionId`
opens with `qodercli --resume '<sessionId>'` and names the transcript
`~/.qoder/projects/*/<sessionId>.jsonl` (China build: `~/.qoder-cn/...`). If either
fails, the two ids are different id spaces and a History row would name an id `--resume` cannot open.
