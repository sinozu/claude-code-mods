# claude-code-mods

Mods for Claude Code: hooks-module plugins that add live panels and controls to the terminal UI.

## Mods

### session-prs

Shows the PRs created in the current session, with their CI status, in a band above the prompt and in a side panel.

- The band is a single row: `▌ PRs [n] │ ✓ passed ✗ failed ◌ running │ [ Panel ○ ]`. The button toggles the panel on and off.
- The panel draws one card per PR: state chips (OPEN / MERGED / CLOSED / DRAFT), `+added −deleted`, branch → base, every check with its result, review decision, merge state, a link to the PR, and the time since the last fetch. A proportional bar at the top sums up all checks.
- A PR is picked up from the output of any `gh pr create` the session runs through the Bash tool, including those run by subagents.
- CI status comes from `gh pr view --json` and refreshes every 60 seconds; `[ Refresh ]` fetches at once.
- `/prs` also toggles the panel.
- The list and the panel state are stored under the session id, so they survive a `/tui` relaunch.

### review-requests

Shows the open PRs where you are a requested reviewer, with their CI status, in a band and a side panel.

- Fetches up to 30 PRs with `gh search prs --review-requested=@me --state=open`, then adds CI, diff size and review state from `gh pr view`.
- Hides PRs you have already approved, and PRs approved as a whole.
- The band is a single row: `▌ Reviews [n] │ ✗ k with failing CI │ [ Panel ○ ]`, or `CI green on all` when nothing fails.
- The panel draws one card per PR: `repo #number`, a DRAFT chip, `+added −deleted`, title, `@author`, review state, time since the last update, the check counts with the names of failing checks, and a link. Newest update first.
- Refreshes at start and every 5 minutes; `[ Refresh ]` fetches at once. `/reviews` toggles the panel.

With both mods installed the band has two rows: each mod draws its own row and stacks the row of the mod beneath it.

## Notes

- Mouse clicks reach the buttons only under the fullscreen renderer. Switch with `/tui fullscreen` (`/tui default` switches back). On the classic renderer use `/prs` and `/reviews`, or focus the band with `ctrl+x tab`: `p` toggles the PR panel, `v` the review panel; inside a panel `r` refreshes and `q` closes it.
- `gh` must be installed and signed in.
- The refresh interval of each mod is the `REFRESH_MS` constant at the top of its `hooks/register.tsx`.

## Install

At the prompt of a terminal session:

```
/plugin install session-prs --marketplace sinozu/claude-code-mods
/plugin install review-requests --marketplace sinozu/claude-code-mods
```

From a shell:

```
claude plugin install session-prs --marketplace sinozu/claude-code-mods
claude plugin install review-requests --marketplace sinozu/claude-code-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `sinozu/claude-code-mods`, then Add plugin and pick the mod.

## Development

```
claude --plugin-dir ./mods/session-prs --plugin-dir ./mods/review-requests
claude plugin validate ./mods/<mod>
claude plugin test ./mods/<mod>
```
