# Technical Documentation

## Stack

- Node.js HTTP server in `server.js`
- Static frontend in `public/`
- SQLite via `better-sqlite3` in `server/db.js`
- Server-Sent Events for live updates
- ffmpeg and ffprobe from the system

## High-Level Architecture

### Backend
`server.js` is a single-process Node server that:
- serves static assets
- handles auth and JSON API routes
- manages one active encode run at a time
- spawns ffmpeg child processes
- pushes live state over SSE
- persists run history and machine-scoped user settings into SQLite

### Frontend
`public/js/app.js` is a plain browser client that:
- handles login and registration
- loads persisted config
- scans and edits the queue before start
- opens an SSE stream for live state updates
- renders batch stats, current file, queue preview, recent completions, and logs

### Database
`server/db.js` owns schema creation and persistence helpers.

## Important Runtime State

The in-memory `state` object in `server.js` contains:
- app metadata
- current status and message
- active config
- scan info
- current file metrics
- queue and queue preview metadata
- recent completed files
- recent events
- run counts, totals, progress
- lifetime stats snapshot
- current viewer info

`clonePublicState()` produces the public payload sent to `/api/state` and SSE clients.

During an active run, public queue data is filtered to remaining items only, then reduced to a preview limited by `QUEUE_PREVIEW_LIMIT`.

## Authentication And Access Control

Tables:
- `users`
- `sessions`
- `user_settings`
- `user_queue_plans`
- `job_runs`
- `app_meta`

`user_settings` and `user_queue_plans` are scoped by `user_id + machine_name`, where `machine_name` is detected automatically from `os.hostname()` on the server.

Auth model:
- passwords are hashed with `crypto.scrypt`
- session tokens are random 32-byte hex strings
- requests authenticate with `Authorization: Bearer <token>` or SSE query token

Access rule:
- only username `koldKat` is authorized for app functionality
- other users can register and log in but are blocked from encode routes
- localhost-only admin routes bypass app auth but are restricted by socket address

## Queue Model

Queue items include:
- `index`
- `name`
- `path`
- `fullPath`
- `status`
- `tune`
- `saveTo`
- `audioTrack`

Before a run:
- the frontend may load and edit the full queue
- root-level files are selectable individually
- subfolder files are selectable as grouped folder units
- bulk edits and queue reorders are sent to the server through `/api/queue`
- file and grouped-folder queue cards can be removed from the editable queue through `/api/queue` without touching the filesystem
- the edited queue plan, including file order, is persisted per user and per machine in SQLite
- rescans merge saved overrides back onto matching discovered files instead of resetting them to defaults

During a run:
- the server works from the queue item metadata already loaded into memory
- per-file tune, audio track, and save destination are respected
- the persisted queue plan is updated as files are encoded, skipped, fail, or disappear from disk

## Encoding Flow

Per file, `encodeFile()` does the following:
1. Resolve effective tune, audio track, and save destination.
2. Skip if a newer destination file already exists.
3. Probe metadata with ffprobe.
4. Compute target size from duration using configurable `mbPerMin` and `mbStep`.
5. Compute target video bitrate with audio bitrate and overhead deduction.
6. Run ffmpeg pass 1.
7. Run ffmpeg pass 2 with the selected zero-based queue audio track mapped directly to ffmpeg's audio stream selector.

## Target Size Rule

`computeTargetSizeMb(durationSeconds, config)` uses:
- `config.mbPerMin`, default `10`
- `config.mbStep`, default `50`

Formula:
- raw target MB = `(durationSeconds / 60) * mbPerMin`
- final target MB = round raw target up to the next `mbStep`
8. Validate staged output.
9. Promote the staged file into its final location.
10. Delete the original source file if the final path differs from the source.
11. Prune empty source subfolders upward until the selected source root.
12. Update in-memory state and persist the run snapshot.

## Cross-Filesystem Promotion

`promoteStageFile()` first tries `rename()`.

If that fails with `EXDEV`, it falls back to:
- copy staged file to a temp file on the destination filesystem
- rename temp file into place
- remove the staged file
- publish byte-based move progress into the current-file progress bar while the copy is running

This is required because the staging root and final destination may be on different filesystems.

## Stop And Shutdown Handling

The active ffmpeg child is spawned detached so it has its own process group.

Stop paths:
- pause/resume via `/api/pause-toggle`
- manual stop via `/api/stop`
- server shutdown via `SIGINT` or `SIGTERM`

The server tries to stop the active ffmpeg process group with `SIGINT`, then escalates to `SIGKILL` if needed.
Pause uses `SIGSTOP` on the active ffmpeg process group and resume uses `SIGCONT`.

When ffmpeg exits non-zero because of a user stop, the run is treated as `stopped`, not as a failed file.

## API Routes

Public static:
- `GET /`
- `GET /admin` localhost-only
- static files under `public/`

Auth:
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`

App routes:
- `GET /api/state`
- `GET /api/events`
- `GET /api/path-suggest`
- `POST /api/vacuum`
- `POST /api/scan`
- `GET /api/queue`
- `POST /api/queue`
- `POST /api/start`
- `POST /api/pause-toggle`
- `POST /api/stop`

Admin routes, localhost-only:
- `GET /api/admin/state`
- `POST /api/admin/users`
- `POST /api/admin/users/password`
- `POST /api/admin/users/delete`
- `POST /api/admin/version`

## Database Schema Summary

### users
Stores username and password hash material.

### sessions
Stores bearer tokens mapped to users.

### user_settings
Stores persisted job setup JSON per user and per machine.

### user_queue_plans
Stores the editable per-user, per-machine queue plan, including source root, remaining file list, queue order, per-file tune overrides, per-file audio track choices, and per-file save destinations.

### job_runs
Stores historical run snapshots and timestamps for lifetime stats.

Important columns:
- `status`
- `source_root`
- `out_root`
- `total_files`
- `encoded`
- `skipped`
- `failed`
- `source_bytes`
- `output_bytes`
- `savings_bytes`
- `encode_seconds`
- `video_seconds`
- `started_at`
- `finished_at`
- `updated_at`

### app_meta
Stores small global key/value settings such as the displayed app version.

## Lifetime Stats

`getLifetimeStats()` aggregates from `job_runs` and reports:
- runs total / done / stopped / error
- encoded / skipped / failed totals
- processed total
- source, output, and savings bytes
- savings percent
- average savings per encoded file
- completed speed
- average bitrate
- average files per run, counting only runs that processed at least one file
- first started timestamp
- last activity timestamp
- SQLite database size

## Documentation Maintenance Rule

When any change affects behavior, UI, queue semantics, API routes, persistence, or deployment assumptions, update `docs/USER-GUIDE.md` and/or `docs/TECH.md` in the same change.

## Path Suggestions

The frontend requests live directory suggestions for path-entry fields from `GET /api/path-suggest?q=...`.

Behavior:
- authenticated and app-authorized only
- directories only
- matches are read from the filesystem live
- suggestions are returned relative to the user's typed style when possible, including `~/...` for home-relative input
- currently used by `Source root`, `Staging root`, and `Apply save folder`

## Vacuum

The frontend exposes a small `Vacuum Database` button under the `Database Size` stat card. It calls `POST /api/vacuum`.

Behavior:
- authenticated and app-authorized only
- disabled while a job is running
- runs SQLite `VACUUM` to compact the database file on disk
- refreshes lifetime stats afterward
