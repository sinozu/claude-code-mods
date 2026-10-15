# claude-code-mods

Claude Code の mod（hooks module plugin）置き場。

## Mods

### session-prs

セッション中に `gh pr create` で作った PR の一覧と CI 状況を、プロンプト直上の帯とサイドバー（Pane）に表示する。

- 帯は常に 1 行。`▌ PRs [n] │ ✓ 成功 ✗ 失敗 ◌ 実行中 │ [ Panel ○ ]`。ボタンでサイドバーの on / off を切り替える
- サイドバーは PR ごとのカード。状態チップ（OPEN / MERGED / CLOSED / DRAFT）、`+追加 −削除`、ブランチ → base、チェックごとの結果、レビュー判定、マージ可否、PR へのリンク、最終取得からの経過時間。上部に全体の比率バー
- CI 状況は `gh pr view --json` で 60 秒ごとに更新。サイドバーの `[ Refresh ]` で即時更新
- `/prs` でもサイドバーを開閉できる
- 一覧と開閉状態はセッション ID をキーに保存するので、`/tui` での再起動後も残る

注意:

- 通常表示（`/tui default`）ではターミナルがマウスを Claude Code に渡さないため、ボタンはクリックできない。`/tui fullscreen` にするか、`/prs` を使う。帯にフォーカス（ctrl+x tab）したときは `p`、サイドバーでは `r` が更新、`q` が閉じる
- `gh` が認証済みであること

### review-requests

自分がレビュアーに指定されている open な PR の一覧と CI 状況を、帯とサイドバーに表示する。

- `gh search prs --review-requested=@me --state=open` で最大 30 件取り、各 PR の CI・差分量・レビュー状態を `gh pr view` で補う
- 自分が approve 済み、または PR 全体が approve 済みのものは出さない
- 帯は 1 行。`▌ Reviews [n] │ ✗ k with failing CI │ [ Panel ○ ]`。失敗 CI が無ければ `CI green on all`
- サイドバーは PR ごとのカード。`repo #番号`、DRAFT チップ、`+追加 −削除`、タイトル、`@作者`、レビュー状態、更新からの経過、チェック内訳と失敗したチェック名、リンク。更新が新しい順
- 起動時と 5 分ごとに自動更新。`[ Refresh ]` で即時更新。`/reviews` でサイドバーを開閉
- 帯にフォーカスしたときは `v` で開閉、サイドバーでは `r` が更新、`q` が閉じる

session-prs と同時に入れると、帯は 2 段になる（各 mod が自分の行を描き、下の mod の行を重ねる）。

## Install

ターミナルのセッションのプロンプトで:

```
/plugin install session-prs --marketplace sinozu/claude-code-mods
/plugin install review-requests --marketplace sinozu/claude-code-mods
```

シェルから:

```
claude plugin install session-prs --marketplace sinozu/claude-code-mods
claude plugin install review-requests --marketplace sinozu/claude-code-mods
```

デスクトップアプリでは、プロンプト横の + から Plugins → Add marketplace に `sinozu/claude-code-mods` を入れ、Add plugin で入れたい mod を選ぶ。

## Development

```
claude --plugin-dir ./mods/session-prs --plugin-dir ./mods/review-requests
claude plugin validate ./mods/<mod>
claude plugin test ./mods/<mod>
```
