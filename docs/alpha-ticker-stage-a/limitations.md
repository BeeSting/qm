# Stage A Limitations

Stage A is a local synthetic evaluation, not a security certification or production-readiness claim. The authoritative upstream disclosure is [`SECURITY.md`](../../SECURITY.md).

## Material Upstream Limitations

1. QM is early experimental software and does not provide a formal non-interference proof.
2. Command policy can be bypassed through obfuscation or script creation; it is not a sandbox boundary.
3. Browser actions do not pass through every core command or approval gate. Browser capability is therefore prohibited here.
4. Credentials are plaintext while in use inside a sandbox. Stage A supplies none.
5. Credential purpose text is not enforced authorization after materialization. Stage A supplies no credential.
6. Security screening is heuristic and incomplete across several input and output forms.
7. Audience-floor filtering has known origin-label gaps.
8. Egress enforcement depends on the backend and does not cover every deployment-runtime path. Stage A tools declare no egress.
9. Administrators may read sensitive content where authorized; the read is audited rather than separately consent-gated.
10. Durable data may outlive user expectations, and some artifacts have no expiry or reclamation path.
11. Published-app links are bearer authorization. Published apps and public links are prohibited here.
12. Portal sessions have residual token-lifetime risk. Stage A does not run the portal or auth service.
13. Some model-provider paths bypass the intended gateway. Stage A uses the mock harness and no provider.
14. Several governance, revocation, kill-switch, and file-write secret-scanning controls are incomplete upstream.

## Pilot-Specific Limitations

- Fixtures contain no live market, fundamental, portfolio, transaction, client, partner, or investor data.
- Workflow quality under a real model is not measured.
- Token usage, latency, model cost, and provider retention are not measured.
- Docker dry-run and static planning do not prove hosted cloud behavior.
- The synthetic three-principal test proves the pinned authorization behavior exercised by the test, not every possible route or race condition.
- No conclusion from Stage A authorizes production credentials, confidential data, or direct Alpha Ticker database access.

## Fail-Closed Rule

Any need to weaken the synthetic-data boundary, allowed-tool list, loopback restriction, negative tests, evidence minimization, or teardown proof ends the pilot until Nic explicitly approves a revised plan.
