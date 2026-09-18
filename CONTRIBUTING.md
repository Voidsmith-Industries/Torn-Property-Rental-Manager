# Contributing

Contributions are welcome through GitHub pull requests.

## Workflow

1. Fork the repository.
2. Branch from the current `main`.
3. Keep the change focused.
4. Add or update tests for behavior changes.
5. Run the full verification commands.
6. Open a pull request against `main` with a concise explanation and evidence.

## Verification

```bash
npm ci --no-audit --no-fund
npm run verify
```

## Security and privacy

Do not commit Torn API keys, cookies, tokens, personal data, private infrastructure information, or other secrets. Preserve owner verification, rate limits, cancellable scans, fail-closed behavior, and deliberate native action boundaries.

Security concerns should follow `SECURITY.md`, not a public issue.

## Generated userscript

When source changes affect the bundled userscript, run `npm run build` and commit the resulting userscript. CI verifies that generated output is current.
