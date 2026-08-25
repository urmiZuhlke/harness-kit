---
description: 'Apply to every agent interaction. Describes the local machine profile file: what it contains, how to interpret it, and what to do when it is absent.'
applyTo: '**'
---

# Local Machine Profile — `.local-env.json`

## What it is

`.local-env.json` is a **machine-local, gitignored** file written by the project's setup command
at the repo root. It records the developer's machine facts so AI agents can tailor
their commands without asking. Its absence signals the dev environment has not been
bootstrapped.

## MANDATORY — read it before issuing any terminal command

Before writing or running any terminal command, read `.local-env.json` and apply the
`os` and `shell` values. Do not rely on OS hints from the conversation or assumptions.

The `shell` field is **binding**, not a hint:

| `shell` value                          | Required syntax                                  | Forbidden syntax                                      |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `"powershell"`                         | `$env:VAR = "value"`, `;` to chain, `\` path sep | `export VAR=value`, `&&` chaining, `$(cmd)` subshells |
| `"cmd"`                                | `set VAR=value`, `&` to chain                    | `$env:`, `export`, `&&`                               |
| `"bash"` / `"zsh"` / `"sh"` / `"fish"` | `export VAR=value`, `&&` chaining                | `$env:`, PowerShell cmdlets                           |

## Schema (example)

```jsonc
{
  "os": "macos", // "windows" | "macos" | "linux"
  "arch": "arm64",
  "shell": "zsh", // binding
  "node": "22.0.0",
  "npm": "10.9.2",
  "containerRuntime": "podman", // "podman" | "docker" | null
  "setupCompleted": true,
  "setupVersion": "1",
}
```

## Rules for agents

- **If the file does not exist:** tell the developer the environment needs
  bootstrapping (the project's setup command, or the OS bootstrap script for a brand-new machine)
  before suggesting dev-server or database commands.
- **If `setupCompleted` is false or `setupVersion` is stale:** tell them to re-run
  the setup command with its force/reset flag.
- **Container runtime:** always use the detected runtime. If `podman`, never suggest
  `docker`. If `null`, direct them to install the preferred runtime.
- **Node/npm:** warn if the installed version is below the `engines` requirement.

## Container runtime preference

This kit prefers **Podman**, with Docker as fallback. Adapt to whatever the profile
reports.
