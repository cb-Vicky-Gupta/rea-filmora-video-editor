# Contributing to ReaCut

Thanks for taking the time to contribute! 🎉 This guide explains how to get set up and how we work.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- 🐛 **Report bugs** — [open a bug report](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/issues/new?template=bug_report.yml)
- 💡 **Suggest features** — [open a feature request](https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor/issues/new?template=feature_request.yml)
- 📝 **Improve docs** — typos, clarifications and examples are always welcome
- 🧑‍💻 **Write code** — pick an issue labelled `good first issue` or `help wanted`

Before starting on a larger change, please open (or comment on) an issue so we can agree on the approach first.

## Development setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/rea-filmora-video-editor.git
cd rea-filmora-video-editor

# 2. Add the upstream remote
git remote add upstream https://github.com/cb-Vicky-Gupta/rea-filmora-video-editor.git

# 3. Install dependencies (Node 20.19+; `nvm use` picks the right version)
npm install

# 4. Start the desktop app with hot reload (or `npm run dev:android` for the Android UI in a browser)
npm run dev
```

## Making changes

1. Sync with upstream and create a branch from `main`:
   ```bash
   git checkout main && git pull upstream main
   git checkout -b feat/split-clip
   ```
   Branch prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.
2. Make your change. Keep pull requests focused — one feature or fix per PR.
3. Add or update tests for logic changes (`*.test.mjs` / `*.test.js` next to the source file).
4. Run the checks locally — CI runs the same ones:
   ```bash
   npm run lint
   npm test
   npm run format:check
   npm run build
   ```

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add split-at-playhead action
fix(timeline): clamp out-point to clip duration
docs: explain export browser support
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`.

## Pull requests

- Fill in the pull request template and link the issue (`Closes #123`).
- Include screenshots or a short GIF for UI changes.
- Make sure CI is green.
- A maintainer will review your PR; please respond to feedback and push follow-up commits to the same branch.

## Code style

- Function components and hooks only.
- Formatting is handled by Prettier (`npm run format`) — don't hand-format.
- Timeline, color and export rules live in `shared/` and are used by both the preview and the export (desktop and Android); keep them pure so they can be unit tested, and change both sides together.
- Platform code goes in `electron/` (desktop) or `src/platform/web/` (Android); the UI only talks to `window.api`.

## Reporting security issues

Please **do not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
