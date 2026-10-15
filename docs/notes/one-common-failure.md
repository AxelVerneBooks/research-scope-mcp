# The one common failure: the report passes with a stale registry

This is the failure we see in ~all early usage, and the short the kit's workflow
guards against:

## Symptom

`check_report` returns `pass: true`, but a citation later dead-links, because the
source moved (404) *after* it was scored. The registry stores the score from the
fetch at scoring time; it does not silently re-fetch.

## Why it happens

`check_report` deliberately reads the registry rather than re-fetching, so a report
check is reproducible against the exact evidence that produced it. The cost: a source
can age out between `fetch_and_score` and publication.

## Fix (30 seconds)

Re-run `fetch_and_score` on every source the morning the report is being finalized,
then `check_report` again. A source that now scores `http-404` drops to 0/D and shows
`dead-link` with an HTTP status in its flags — remove it or replace it, then re-check.

## Variant: timeouts

`fetch_and_score` aborts at 15s. Slow-but-valid sources (large PDFs, heavily
scripted pages behind bot walls) may need a second attempt after the first thread.
If a source consistently times out, score it as **unusable** — don't cite what your
reader can't load either.
