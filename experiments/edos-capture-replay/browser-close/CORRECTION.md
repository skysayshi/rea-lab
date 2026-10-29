# One setup correction, declared before attempt 02

Attempt 01 stopped after no-context: original close fulfilled in 7722.089146 ms;
release remained UNKNOWN because the sampler rejected command changes without
recording process state. That record remains unchanged.

The initial preflight failed on 13 removed prior snapshot files, and the shell
incorrectly continued into the native run. No complete pre-execution binding is
claimed for attempt 01. Its source snapshot is explicitly post-execution.

One owned delayed-reap process probe subsequently demonstrated a local S-to-Z
command change to `<defunct>` at the same PID/start. This confirms a sampler
defect, not that attempt 01 Chrome took this path. The corrected sampler records
process state, retains known zombies until absence, excludes them from discovery
and signal authority, and preserves non-zombie identity mismatch errors.

The corrected preflight binds the 1802 still available earlier build inputs and
reports the 13 removed snapshot copies separately. It must exit successfully
before launch. Runtime, package and product bytes remain fixed.

Execute the four originally declared cells once in a new output directory as the
single permitted setup correction. Repeated no-context is another attempt, not
an independent replication. No further setup or behavioral retry is planned.
The 10-second FAIL criterion and 45-second observation ceiling remain unchanged.
