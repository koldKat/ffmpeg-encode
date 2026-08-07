# Technical Documentation

This document describes the current implementation, runtime contracts, persistence model, and operational limitations. It is intended for maintainers, reviewers, and operators debugging a running installation.

## System Summary

FFmpeg Encode Web App is a single-process Node.js service with a framework-free browser client. It manages one global encode batch at a time, persists configuration and queue plans in SQLite, launches `ffprobe` and `ffmpeg` child processes, and sends live state snapshots to authenticated browsers with Server-Sent Events (SSE).

| Component | Responsibility |
| --- | --- |
| `server.js` | HTTP routing, auth gates, global run state, queue orchestration, FFmpeg execution, progress, file promotion, and SSE |
| `server/db.js` | SQLite schema, migrations, users, sessions, settings, queue plans, run snapshots, metadata, and lifetime aggregates |
| `public/js/app.js` | Login, setup form, queue editor, lazy list rendering, SSE client, and main dashboard |
| `public/js/admin.js` | Local admin dashboard, one-second resource refresh, user management, and version editing |
| `public/index.html` | Main application markup |
| `public/admin.html` | Local admin markup |
| `public/css/style.css` | Shared responsive presentation |

There is no application framework, build step, worker queue, or external API service.

## Runtime Dependencies

- Linux or another Unix-like system with process-group signals
- Node.js 18 or newer
- `ffmpeg` with `libx264` and AAC support
- `ffprobe`
- `better-sqlite3`

The service reads `PORT`; the default is `3017`. SQLite is fixed to `database.sqlite` in the repository root. `ffmpeg` and `ffprobe` are resolved from `PATH`.

## Process And Concurrency Model

The Node process owns one module-level `state` object and one possible `runnerPromise`. This is a single-run architecture, not a per-user job system.

- `state.active` indicates whether a batch is active.
- `runnerPromise` blocks conflicting operations during run startup and teardown races.
- `activeUserId` identifies the user whose SSE clients receive active-run publications.
- `currentChild` points to the active FFmpeg child.
- `activeRunId` points to the `job_runs` row being updated.
- `stopRequested`, `stopAfterCurrentRequested`, and `pauseRequested` are process-local controls.
- `lastBatchSummary` retains final batch UI data until another run begins.

Only one batch can run across the whole server. Media probing during an editable scan uses up to four asynchronous workers. File encoding is sequential, with one FFmpeg process intentionally active at a time.

## Configuration Model

`normalizeConfig()` merges submitted values with these defaults:

| Field | Default | Meaning |
| --- | ---: | --- |
| `sourceRoot` | `.` | Folder recursively scanned for source videos |
| `outRoot` | `~/Videos` | Staging tree used before final promotion |
| `tune` | `film` | x264 tune |
| `preset` | `slow` | x264 preset |
| `mbPerMin` | `10` | Raw target megabytes per video minute |
| `mbStep` | `50` | Target-size rounding step in decimal MB |
| `audioKbit` | `192` | AAC audio bitrate in kbit/s |
| `minVideoKbit` | `300` | Minimum calculated video bitrate |
| `overheadPct` | `1` | Safety deduction from calculated video bitrate |
| `ffmpegLoglevel` | `error` | FFmpeg log level |
| `x264Profile` | `high` | H.264 profile |
| `x264Level` | `4.1` | H.264 level |
| `encThreads` | `0` | Explicit FFmpeg threads; zero leaves it unset |

`sourceRoot`, `outRoot`, and per-item `saveTo` expand a leading `~` against the server process home. These are server filesystem paths even when the browser is remote.

Settings are keyed by `(user_id, machine_name)`, where `machine_name` is `os.hostname()`. One database can therefore retain different setup values for different hosts.

## Public State Contract

`createState()` defines canonical in-memory state. `clonePublicState()` derives JSON returned by state, queue, and control endpoints and sent over SSE.

| Field | Purpose |
| --- | --- |
| `app` | Name, persisted display version, protected username, hostname, CPU count, memory, and CPU usage |
| `status` | `idle`, `scanning`, `running`, `paused`, `done`, `stopped`, or `error` |
| `message` | Latest user-facing state message |
| `config` | Effective normalized configuration |
| `startedAt`, `finishedAt` | ISO run timestamps |
| `active` | Whether a run owns the encoder |
| `stopRequested`, `stopAfterCurrent`, `paused` | Control flags |
| `scan` | Source path, staging path, and discovered count |
| `currentFile` | File, pass, phase, progress, speed, ETA, sizes, tune, destination, and audio choice |
| `queue` | Public queue preview, not always the complete internal queue |
| `queueInfo` | Public total, visible, and hidden counts |
| `recentCompleted` | Successful filenames for the run |
| `recentEvents` | Timestamped `info`, `warn`, `error`, and `success` events |
| `counts` | Total, encoded, skipped, failed, and completed counts |
| `totals` | Bytes, savings, timing, speed, and bitrate |
| `progress` | Overall percentage, remaining seconds, and ETA timestamp |
| `lifetime` | Fresh aggregate from all `job_runs` rows |
| `viewer` | Added by authenticated state/event handlers |

Every public clone refreshes resource statistics and lifetime aggregates. Event messages are collapsed to one line and truncated to 420 characters.

### Last-run overlay

When a run reaches `done`, `stopped`, or `error` after processing at least one file, `captureLastBatchSummary()` copies its counts, totals, progress, completed filenames, and events. While idle, `clonePublicState()` overlays those values onto hydrated idle state. This lets an editable queue coexist with the previous batch report.

The overlay is process memory only and does not survive restart. Lifetime aggregates survive in SQLite.

## Queue Data Model

An internal queue item resembles:

```json
{
  "index": 1,
  "name": "episode.mkv",
  "path": "/media/show",
  "fullPath": "/media/show/episode.mkv",
  "status": "pending",
  "tune": "animation",
  "saveTo": "/media/encoded/show",
  "audioTrack": 1,
  "audioTracks": [
    {
      "index": 0,
      "streamIndex": 1,
      "language": "eng",
      "codec": "aac",
      "channels": 2,
      "title": ""
    }
  ]
}
```

`audioTrack` is an index within audio streams, not an absolute FFmpeg stream index. Pass 2 maps it as `0:a:N?`; the optional marker makes missing audio non-fatal. Queue statuses are `pending`, `running`, `encoded`, `skipped`, `failed`, and `stopped`.

### Discovery and merge

`walkFiles()` recursively includes `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.mpeg`, `.mpg`, and `.m4v`, case-insensitively.

A manual scan:

1. Discovers and lexically sorts paths.
2. Loads the persisted plan for the user and hostname.
3. Keeps persisted items still present below the selected source root.
4. Preserves their order and overrides.
5. Appends newly discovered paths.
6. Probes audio metadata with four workers.
7. Replaces idle state and persists the merged queue.

Persisted entries whose files no longer exist are cleaned when the plan is loaded.

### Browser grouping

Folder grouping is frontend presentation only. Root-level files are individual selection units. Deeper files are grouped by relative directory. Bulk operations send every underlying file path; the server stores individual queue items.

### Queue persistence

Serialized plans store only existing paths and exclude `encoded` and `skipped`. Failed items remain marked `failed`; other unfinished states normalize to `pending`. Full path, tune, destination, audio index, and audio metadata are retained.

The runner saves the plan after skips, failures, successful encodes, edits, and run termination. It preserves remaining work, not pass-level execution state.

### Public queue and paging

During a run, terminal items are removed from the public queue. `clonePublicState()` includes at most 50 preview entries, prioritizing running and remaining files.

`GET /api/queue?offset=N&limit=M` returns a page. Offset is at least zero; limit is clamped to `1..200`. Omitting `limit` returns the complete public queue, which the editable client needs for grouping and exact reorder validation.

The browser initially creates 50 DOM rows for Queue, Latest Completed, and Run Log. One distinct bottom-scroll gesture appends 50 more. That DOM limit is separate from arrays retained by the server and, for editable queues, by the browser.

## Authentication And Authorization

Passwords use asynchronous `crypto.scrypt`, a random 16-byte salt, and a 64-byte derived hash. Session tokens are random 32-byte values represented as hex.

Sessions expire after seven days of inactivity. Authenticated requests refresh `last_seen_at`; expired sessions are purged during lookup, user listing, and startup.

Normal API requests use:

```http
Authorization: Bearer <token>
```

SSE uses `?token=<token>` because browser `EventSource` cannot set that header. Tokens can therefore appear in proxy access logs.

`authorizeApp()` permits only the exact `REMOTE_USERNAME`, currently `koldKat`. Other accounts may authenticate but receive `403` from app routes.

### Local admin boundary

Admin routes do not use sessions. They accept only socket addresses `127.0.0.1`, `::1`, and `::ffff:127.0.0.1`. This is a network-origin check, not admin authentication.

A reverse proxy connecting from localhost can unintentionally make remote requests appear local. Do not proxy `/admin`, `/admin.html`, or `/api/admin/*` without a stronger auth boundary.

## Run Lifecycle

### Starting

`POST /api/start` validates source access, saves settings, and chooses work in this order:

1. Non-empty persisted queue plan.
2. Current idle queue when its source root matches.
3. Fresh recursive discovery inside `runJob()`.

`runJob()` clears the last-summary overlay, resets runtime state, creates a `job_runs` row, marks the run `scanning`, and publishes. It loads and saves the queue, changes to `running`, and processes files sequentially.

### Per-file encoding

`encodeFile()`:

1. Resolves tune, destination, and numeric audio index.
2. Builds a staging `.mp4` path mirroring the source-relative directory under `outRoot`.
3. Builds the final `.mp4` under the item's `saveTo`.
4. Skips a final file newer than the source.
5. Probes duration, frames, and audio streams.
6. Fails on probe errors; skips unusable duration.
7. Calculates target size and bitrate.
8. Creates a unique pass-log name under `os.tmpdir()`.
9. Runs pass 1 and pass 2.
10. Requires a non-empty staged output.
11. Promotes output to final path.
12. Deletes the source when final and source differ.
13. Prunes empty source directories up to the root boundary.
14. Updates totals, plan, run snapshot, completed list, and log.
15. Removes pass logs in `finally`.

Per-file failures are recorded and processing continues. Immediate stop exits the file and whole run.

### FFmpeg behavior

Both passes overwrite output, map only the first video stream, remove metadata and chapters, discard subtitles, encode `libx264`, apply configured x264 values, and report progress through `pipe:1`.

Pass 1 has no audio and writes MP4 output to `/dev/null`. Pass 2 optionally maps one audio stream, encodes AAC at the configured bitrate, forces two channels with `-ac 2`, and uses `+faststart`.

The app does not preserve subtitles, chapters, attachments, source metadata, additional video streams, or multiple audio streams. Multichannel audio is downmixed to stereo.

FFmpeg is detached for process-group signaling. Stderr retains only the final 12,000 characters. Recognized malformed-H.264 errors are summarized as input corruption; other failures use the last useful stderr line.

## Size And Bitrate Calculations

Target size uses decimal megabytes:

```text
rawTargetMb = max(durationSeconds, 0) / 60 * mbPerMin
targetSizeMb = max(1 step, ceil(rawTargetMb / mbStep)) * mbStep
```

The implementation keeps three decimal places during step rounding to reduce floating-point boundary errors.

Video bitrate is:

```text
totalBits = targetSizeMb * 1,000,000 * 8
averageTotalBps = floor(totalBits / durationSeconds)
videoBpsBeforeOverhead = averageTotalBps - audioKbit * 1,000
videoBps = floor(videoBpsBeforeOverhead * (100 - overheadPct) / 100)
videoKbps = max(floor(videoBps / 1,000), minVideoKbit)
```

The minimum floor can make output exceed the target for short files or aggressive settings.

## Progress, Speed, And ETA

FFmpeg progress provides `out_time_ms`, `speed`, `fps`, and `frame`. Current-pass percentage is output time divided by duration. Speed is exponentially smoothed with 82% prior value and 18% new sample.

Two passes contribute equal halves:

```text
effectiveCompleted = completedFiles + currentFilePassFraction
overallPct = effectiveCompleted / totalFiles * 100
```

The move phase adds no overall fraction, preventing copy progress from inflating batch completion.

ETA rules:

- Before a successful encode provides timing history, non-final batch ETA is unavailable.
- Non-final ETA uses average encode seconds per successful file times remaining effective files.
- Final-file ETA uses live current-pass remaining time plus estimated remaining passes.
- Idle raw state uses zero remaining time; retained summary data may overlay it.

Speed is media duration divided by encode wall time. Average bitrate is output bits divided by encoded media duration.

## Promotion And Destructive Behavior

`promoteStageFile()` first tries `rename()`. On `EXDEV`, it copies to `<final>.part-<pid>-<timestamp>`, reports bytes roughly every 100 ms, renames the complete temporary file, deletes the staged source, and cleans the temporary file after failure.

After successful promotion, the original is deleted whenever `finalPath !== filePath`. Empty source directories are removed only while descendants of `sourceRoot`; the source root is never removed.

An MP4 whose final path exactly equals its source is replaced through staging without a separate source unlink.

## Pause, Stop, Shutdown, And Restart

- Pause sends `SIGSTOP` to the FFmpeg process group.
- Resume sends `SIGCONT`.
- Immediate stop resumes first, sends `SIGINT`, then `SIGKILL` after 1.5 seconds if needed.
- Stop-after-current is checked before and after each file; the current passes and promotion finish first.
- Node `SIGINT`/`SIGTERM` stops the child group, closes HTTP, and forces exit after 2.5 seconds.

Pause and active pass state are memory-only. Restart does not resume a paused process or partial pass. Shutdown attempts to kill FFmpeg, while the persisted plan keeps unfinished files for a later new run.

There is no startup reconciliation for a `job_runs` row left `running` after a crash or forced kill. Such rows can affect lifetime run counts and last activity until manually corrected.

## SSE And Browser Synchronization

`GET /api/events` authenticates the query token, immediately sends one full state event, registers the response, and removes it on close.

`publish()` sends complete snapshots, not patches. During a run, publications are restricted to clients belonging to `activeUserId`. While idle, authorized clients receive publications without that filter.

The client renders state returned directly by command endpoints as well as SSE, avoiding delayed UI changes after start, stop, pause, and graceful-stop commands.

The browser title displays overall percentage during a run. A disconnected stream is closed and reported; the custom error handler does not implement automatic reconnection.

## Frontend State And Rendering

The main client keeps its bearer token in `localStorage` as `ffmpeg_webapp_token`, public state in `lastState`, full editable queue in `fullQueue`, paged active queue in `activeQueue`, selection keys, and independent visible counts for the three long lists.

Path autocomplete queries after 150 ms and supports mouse and keyboard selection. Audio suggestions come from probed metadata. Applying a language sends that language string; the server resolves each file independently and falls back to index `0` if absent.

The admin client polls every second. It preserves a focused password field and does not overwrite a dirty version input.

## HTTP API

Failures return `{ "error": "..." }`. Empty or invalid JSON is treated as `{}`. There is no body-size limit.

### Authentication

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /api/register` | `{ username, password }` | Creates user/session; returns token and authorization flags |
| `POST /api/login` | `{ username, password }` | Returns token and authorization flags |
| `POST /api/logout` | none | Deletes supplied session |
| `GET /api/me` | bearer token | Viewer, persisted config, and queue count |

### Main application

All require authentication and the protected username.

| Method and path | Input | Behavior |
| --- | --- | --- |
| `GET /api/state` | none | Hydrates idle state and returns public snapshot |
| `GET /api/events?token=...` | query token | Opens SSE with immediate snapshot |
| `POST /api/scan` | config object | Discovers, merges, probes, persists, and returns queue/state |
| `GET /api/queue` | optional `offset`, `limit` | Returns full or paged public queue and state |
| `POST /api/queue` | `{ order: [fullPath...] }` | Reorders after exact membership validation |
| `POST /api/queue` | `{ filePaths, remove: true }` | Removes queue entries, not disk files |
| `POST /api/queue` | `{ filePaths, tune }` | Applies tune |
| `POST /api/queue` | `{ filePaths, saveTo }` | Applies expanded destination |
| `POST /api/queue` | `{ filePaths, audioTrack }` | Applies numeric index or resolves language per file |
| `POST /api/start` | config object | Starts asynchronous batch; returns immediate state |
| `POST /api/pause-toggle` | optional `{ enabled }` | Pauses or resumes active FFmpeg |
| `POST /api/stop-after-current` | optional `{ enabled }` | Toggles graceful stop |
| `POST /api/stop` | none | Requests immediate stop |
| `GET /api/path-suggest?q=...` | query | Returns matching child directories |
| `POST /api/vacuum` | none | Runs `VACUUM`; rejected during run |

### Local admin

| Method and path | Body | Behavior |
| --- | --- | --- |
| `GET /admin` | none | Serves localhost-only admin UI |
| `GET /api/admin/state` | none | Resources and users/session counts |
| `POST /api/admin/users` | `{ username, password }` | Creates user |
| `POST /api/admin/users/password` | `{ username, password }` | Resets unprotected user password |
| `POST /api/admin/users/delete` | `{ username }` | Deletes unprotected user and cascaded rows |
| `POST /api/admin/version` | `{ version }` | Persists and publishes display version |

Versions are trimmed, limited to 40 characters, allow Unicode such as `0.2.6.2 α`, and reject control characters and newlines.

## SQLite Persistence

`better-sqlite3` opens `database.sqlite`, enables WAL and foreign keys, and runs schema creation/migrations during module load.

| Table | Key | Contents |
| --- | --- | --- |
| `users` | `id`; unique username | Username, password hash, salt, creation time |
| `sessions` | token | User, creation, last activity |
| `user_settings` | `(user_id, machine_name)` | Config JSON and update time |
| `user_queue_plans` | `(user_id, machine_name)` | Source root, remaining queue JSON, update time |
| `job_runs` | `id` | Status, paths, counts, byte/timing totals, timestamps |
| `app_meta` | key | Global values such as `app_version` |

User foreign keys cascade deletes to sessions, settings, plans, and runs.

### Migrations

Startup currently adds/backfills `job_runs.updated_at`, adds/backfills `sessions.last_seen_at`, and rebuilds legacy settings/plan tables without `machine_name`. There is no migration version table. Back up SQLite before schema changes.

### Run snapshots and lifetime statistics

A run row is inserted before discovery and updated throughout execution. It is a mutable snapshot, not an event ledger. Lifetime aggregates include run status counts, processed files, bytes, savings, media duration, wall time, files per run, bitrate, first run, and last activity. Average files/run excludes zero-processed rows.

Database size is `PRAGMA page_count * page_size`, including allocated free pages until vacuumed.

## Resource Statistics

Memory uses `process.memoryUsage()`: heap used, heap total, and RSS.

CPU combines cumulative Node CPU with `/proc/<pid>/stat` ticks for processes in the FFmpeg process group. Samples use monotonic elapsed time, divide by logical CPU count, and clamp to `0..100%`, representing total machine capacity rather than 100% per core.

This is Linux-specific. `PROC_CLK_TCK` defaults to `100`; set `CLK_TCK` if the host differs.

## Failure Semantics

| Condition | Result |
| --- | --- |
| Newer destination | `skipped` |
| Probe throws | `failed` |
| Unusable duration | `skipped` |
| FFmpeg non-zero | `failed`, except immediate stop |
| Missing/empty staged file | `failed` |
| Promotion, copy, or source deletion failure | `failed` |
| Immediate stop | Current item and run `stopped` |
| Stop-after-current | Current item completes; run `stopped` before next |
| Unexpected runner exception | Run `error` |

Failed files remain in the plan; encoded and skipped files are removed. A run can be `done` with failed files because per-file failures are handled and the loop continues.

## Operations

### Backups

Back up `database.sqlite` with its WAL/SHM files while running, or stop the server before copying the main database. Copying only the main file during WAL writes can be incomplete.

### Reverse proxy requirements

- Preserve long-lived SSE responses and query strings.
- Disable buffering for `text/event-stream`.
- Provide TLS and external access controls.
- Block remote access to all admin paths.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| No files | Path is server-local, readable, and extension is supported |
| Missing language | Stream lacks language tag; use numeric audio index |
| Language chooses track 0 | Language absent for that file; fallback is intentional |
| ETA unavailable | No successful timing yet and no usable live speed |
| CPU unavailable | Linux `/proc` missing or first sample not elapsed |
| Admin `403` | Socket is not a recognized loopback address |
| Browser stops updating | SSE disconnected; refresh reconnects |
| Queue returns after restart | Remaining plan is intentionally persistent |
| Old run stays `running` | Startup reconciliation is not implemented |
| Database stays large | Vacuum while no run is active |

## Known Limitations

- One global batch; no concurrent jobs or per-user runtime isolation
- Protected username is a source constant
- Admin trust is localhost address only
- No TLS, CSRF protection, rate limiting, account lockout, or password policy
- No request-body size limit
- No automatic SSE reconnect after the custom error handler closes it
- No pass resume or interrupted-run reconciliation
- No subtitles, chapters, attachments, metadata, extra video, or multi-audio preservation
- Audio output is always AAC stereo
- Source traversal ignores symbolic-link entries because discovery accepts only direct `Dirent.isDirectory()` and `Dirent.isFile()` results
- Editable queue paging limits DOM rows, but the browser fetches the full queue for grouping and reorder

## Change Checklist

When behavior changes, review queue fields/statuses/paging, defaults and formulas, FFmpeg mapping, destructive promotion, state and ETA, API contracts, schema/migrations, restart controls, security assumptions, `docs/USER-GUIDE.md`, and `README.md`.
