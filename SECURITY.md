# Security Policy

## Supported Versions

Security fixes are handled on the default branch until the first stable versioned release.

## Reporting a Vulnerability

Do not open a public issue for secrets exposure, token leakage, unsafe file handling or media-processing vulnerabilities.

Report security issues privately to the maintainer through GitHub.

Include:

- affected files or configuration;
- what an attacker can do;
- whether secrets or local files can be exposed;
- a minimal reproduction if possible.

## Local Safety

Run the app only on trusted machines and trusted networks.

Keep `OPENAI_API_KEY` in `.env` or your local environment. Do not commit `.env`, uploaded media, generated transcripts or private meeting recordings.

The backend accepts local media uploads and stores them under `artifacts/`. Review files before sharing logs, screenshots or archives.
