# Native Talk recovery

Talk capture now writes an origin-bound session manifest before opening a segment.
Each segment has its own index/start-time metadata and headerless 16 kHz mono,
16-bit little-endian PCM file in Application Support. The raw stream can be read
without an AAC container being finalized. Capture stops and releases the
microphone when storage fails.

On startup, `TalkOutbox` reconciles interrupted outbox renames and capture journals.
It wraps complete PCM samples in a WAV header, keeps the original server,
recording ID, session ID and segment index, and commits outbox metadata/audio
before acknowledging or removing capture files. Upload remains idempotent by
session/index. An interrupted acknowledgement is retried without duplicating the
queued segment. Finishing waits for both the durable queue and journal to clear.
Missing files and rejected uploads remain blocked rather than being counted as
successfully delivered.

Settings → Audio recovery provides Retry and file exports. Pre-journal temporary
captures and files without valid metadata are preserved without assigning them a
server or recording. Unidentified outbox/journal audio holds automatic finishing;
export does not silently waive that barrier. After review, each row offers an
explicitly confirmed “Discard local copy…” action. It removes only that phone
copy and its blocking metadata, and may permit finishing without that audio.
Missing-file rows can likewise discard their metadata. Active captures and paths
outside the owned recovery directories are protected. Recovering the original
destination requires human review because missing identity cannot be inferred safely.
Existing queued legacy segments with intact metadata still use the separate,
explicit “Resume older uploads” server confirmation.

PCM/WAV uses 32 KB per second (about 1.28 MB per normal 40-second segment,
115 MB/hour offline), approximately eight times the previous 32 kbps AAC.
Transient handoff can hold both raw and queued copies. Recovery rejects automatic
conversion above 5.12 MB per segment and preserves the source for export. The
server already accepts `audio/wav`; the native player chooses a WAV temporary
extension when decoding it.

Tests use real files, interrupted staging layouts, metadata faults, fresh outbox
instances, and Core Audio WAV decoding with sample-value assertions. They also
check that missing/unknown audio blocks finishing and that legacy origins stay
unknown. These tests do not establish real-device microphone performance,
force-quit behavior, background suspension, route changes, or power-loss
resilience. Those need a physical-device recording/kill/relaunch exercise.
Voice chat uses speech recognition rather than these audio files; its immutable
client already retains the starting server.
