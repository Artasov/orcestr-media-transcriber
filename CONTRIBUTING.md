# Contributing

Thanks for considering a contribution.

Orcestr Media Transcriber is a small local app. Keep changes focused, easy to review and safe for private audio/video files.

## Development

Install backend dependencies:

```bash
cd backend
uv sync --extra dev
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Before opening a pull request, run:

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run mypy

cd ../frontend
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Pull Requests

Use a concise title and explain:

- what changed;
- why it is needed;
- how it was tested;
- whether it affects API keys, uploaded media, transcript storage or local filesystem access.

Do not include real API keys, private recordings, generated transcripts from private calls or private repository data in issues, pull requests or logs.
