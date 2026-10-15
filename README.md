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

## Install

ターミナルのセッションのプロンプトで:

```
/plugin install session-prs --marketplace sinozu/claude-code-mods
```

シェルから:

```
claude plugin install session-prs --marketplace sinozu/claude-code-mods
```

デスクトップアプリでは、プロンプト横の + から Plugins → Add marketplace に `sinozu/claude-code-mods` を入れ、Add plugin で `session-prs` を選ぶ。

## Development

```
claude --plugin-dir ./mods/session-prs
claude plugin validate ./mods/session-prs
claude plugin test ./mods/session-prs
```
