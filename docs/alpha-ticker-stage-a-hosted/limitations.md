# Alpha Ticker QM Hosted Stage A Limitations

Hosted Stage A is a bounded public-synthetic evaluation. It is not a production-readiness or security certification.

1. **Upstream command-policy limitation.** The upstream command-policy and strict human-approval controls are defense in depth. They do not replace sandbox isolation, egress enforcement, admission controls, or operator review.
2. **Browser limitation.** Browser tooling is prohibited and absent from this pilot. The evaluation does not establish safe browser automation.
3. **Plaintext credential limitation.** QM requires local plaintext credential material in an ignored mode-`0600` `.env` and transfers deployment secrets through operator-controlled tooling. Stage A reduces exposure but does not provide a hardware-backed or end-to-end secretless workflow.
4. **Heuristic screening limitation.** Boundary and evidence scanners use deterministic rules and heuristic screening. Passing them cannot prove the absence of every sensitive string or semantic disclosure.
5. **Retention limitation.** Provider, SMTP, Fly, Managed Postgres, Tigris, and local operational retention remain subject to their respective controls. Retention must be reviewed before activation and minimized evidence is retained only for the decision record.
6. **Budget overshoot limitation.** QM checks recorded spend before a new turn rather than reserving the current turn's maximum cost. One in-flight request can create budget overshoot; the US$45 organization brake and hard US$50 provider exposure leave a US$5 buffer.
7. **Sprite egress proxy limitation.** The dedicated Sprite egress proxy constrains sandbox traffic only. Its signed capability boundary and tokenless denial must be tested live; repository tests alone do not prove deployed behavior.
8. **Unrestricted core egress limitation.** QM core requires outbound access to the dedicated OpenAI project, SMTP relay, Fly control plane, Managed Postgres, and Tigris. Stage A uses dedicated credentials and absent connector credentials but does not claim a network-level allowlist for unrestricted core egress.
9. **Empty allowlist means unrestricted.** In the pinned QM release, an empty sandbox `allowedHosts` list means unrestricted rather than deny-all. The durable allowlist must therefore contain exactly the approved portal control-plane host and must be read back before the first participant turn.
10. **Identity limitation.** Email admission for three work identities is evaluated, but Stage A is not a general enterprise identity, lifecycle, or privileged-access-management assessment.
11. **Synthetic-data limitation.** Only committed fixtures marked synthetic and advisory-only are tested. Results cannot be extrapolated to live Alpha Packets, confidential documents, production portfolios, or customer data.
12. **Model limitation.** Results apply only to `gpt-5.6-terra` through the pinned `pi` harness and deployment revision. There is no automatic fallback and no multi-provider comparison.
13. **Hosting limitation.** Fly is a specialist QM execution layer. Stage A does not migrate, connect to, or validate Alpha Ticker's Vercel, Railway, or Supabase systems.
14. **Teardown limitation.** The automated script destroys only exact captured Fly applications. Cryptographic QM verification and hardened process-group timeouts prevent an unverified local executable or hung provider command from silently widening teardown, but they do not delete Managed Postgres or Tigris. Those resources require separately verified manual deletion before teardown is complete.
15. **Early-stop evidence limitation.** A missing or partial score ledger and partial approved resource inventory are accepted only to preserve non-passing decision evidence after a stop. They can never satisfy the Stage A acceptance gate, and the complete fail-closed H2/H3 status register is still required.
16. **H2 resource-reconciliation limitation.** A failed or interrupted provider query can leave Managed Postgres or Tigris existence ambiguous even when their inventory fields are `null`. The lifecycle marker therefore remains `unresolved` and refuses final teardown success until exact provider state is reconciled and the inventory transitions atomically to `complete`.

A successful result supports only a decision to stop, repeat the synthetic evaluation, or design a separately approved Stage B.
