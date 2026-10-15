# claude-code-mods

Claude Code の mod（hooks module plugin）置き場。

## Mods

### session-prs

セッション中に `gh pr create` で作った PR の一覧と CI 状況を、プロンプト直上の帯に表示する。

- PR ごとに `✓/✗/…  #番号  OPEN/MERGED/CLOSED(draft)  ✓n ✗n …n  タイトル` を 1 行で表示し、失敗したチェック名も併記する
- CI 状況は `gh pr view --json statusCheckRollup` で 60 秒ごとに更新する。`[ Refresh ]` で即時更新
- `[ Hide ]` で 1 行に折りたたみ、その行を押すと戻る。`/prs` コマンドでも切り替えと更新ができる
- PR が 0 件の間は帯を出さない

`gh` が認証済みであること。

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
