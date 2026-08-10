# FFmpeg Encode Web App

A self-hosted browser dashboard for building and monitoring FFmpeg two-pass H.264 batch encoding jobs. It scans folders, provides an editable queue, calculates target sizes from video duration, streams live progress to the browser, and stores settings and run statistics in SQLite.

## Important Warning

This app can delete original source files when deletion is explicitly selected globally or per file. Deletion happens only after an encoded file is successfully staged and promoted. Empty source subfolders are then pruned up to, but never including, the selected source root.

Test with disposable media and verify all source, staging, and destination paths before using it on valuable files.

## Features

- Recursive video discovery for MP4, MKV, AVI, MOV, WMV, FLV, MPEG, MPG, and M4V files
- Editable queue with folder grouping, selection, removal, drag reordering, and persisted queue plans
- Per-file or per-folder x264 tune, destination folder, and audio language/track selection
- Opt-in source deletion globally or per file, persisted with the queue plan
- Audio stream metadata discovered with `ffprobe`
- Configurable x264 preset, target MB per minute, size rounding, audio bitrate, bitrate floor, overhead, and thread count
- Two-pass H.264 encoding with AAC audio
- Cross-filesystem staging and promotion with live copy progress
- Live file progress, overall progress, speed, ETA, savings, run log, and completed-file panels
- Pause/resume, immediate stop, and stop-after-current controls
- Queue, completed-file, and log lists loaded in batches for large runs
- Persistent user settings, queue plans, sessions, run history, app version, and lifetime statistics in SQLite
- Human-managed app version mirrored to `VERSION` whenever it is saved from the admin panel
- Localhost-only administration dashboard for users, app version, CPU, and memory information
- Server-Sent Events for live browser updates without polling the main run state

## Requirements

- Linux, because pause/resume and process-group control use Unix signals
- Node.js 18 or newer
- `ffmpeg` and `ffprobe` available on `PATH`
- A compiler toolchain may be needed if `better-sqlite3` cannot use a prebuilt binary for your Node.js version

Check the external tools:

```bash
node --version
ffmpeg -version
ffprobe -version
```

## Installation

```bash
git clone https://github.com/koldKat/ffmpeg-encode.git
cd ffmpeg-encode
npm install
npm start
```

The server listens on port `3017` by default:

```text
http://localhost:3017
```

Set a different port with `PORT`:

```bash
PORT=8080 npm start
```

The SQLite database is created automatically as `database.sqlite`. Runtime database files are excluded from Git.

## First Run

1. Open the main app and register the authorized account.
2. Enter a source folder and staging folder.
3. Adjust encoding settings if needed.
4. Select **Load File Queue** to scan and review files.
5. Edit queue order, tune, audio selection, or final save folders.
6. Select **Start Encode Job**.

The current build authorizes only the username `koldKat` for encoding routes. This is controlled by `REMOTE_USERNAME` near the top of `server.js`; change it before deployment if a different account should operate the encoder. Other registered accounts can log in but cannot use the encoding interface.

## Encoding Model

Target output size is based on duration:

```text
raw target MB = duration in minutes * MB/min
final target MB = raw target rounded up to the configured MB/step
```

For each queued file, the server:

1. Checks whether a newer destination should cause a skip.
2. Reads duration, frame, and audio metadata with `ffprobe`.
3. Calculates target size and video bitrate.
4. Runs FFmpeg pass 1.
5. Runs FFmpeg pass 2 with the selected audio stream.
6. Validates the staged output.
7. Promotes it to the configured destination.
8. Deletes the original when the final path differs from the source.

If staging and destination folders are on different filesystems, promotion falls back to copy-then-rename and reports move progress in the dashboard.

## Queue And Persistence

Files directly inside the source root are editable individually. Files in subfolders are grouped into folder units for bulk operations while preserving their internal order.

Settings and queue plans are stored per user and server hostname. Restarting the server restores remaining queue items, order, tune overrides, audio choices, and destination folders. Successfully encoded and skipped files are removed from the saved plan; failed files remain available for retry.

Only one encode batch can run at a time. An active FFmpeg process is stopped when the server receives `SIGINT` or `SIGTERM`.

## Administration

The admin dashboard is available only from the server machine:

```text
http://localhost:3017/admin
```

It can create and remove users, reset passwords, update the displayed app version, and show live process resource statistics. The authorized encoding account is protected from password reset and deletion through the admin interface.

## Security Notes

- Do not expose the app directly to the public internet without a trusted reverse proxy, TLS, and additional access controls.
- The main app uses bearer-token sessions stored in SQLite and browser local storage.
- Sessions expire after seven days of inactivity.
- Passwords are salted and hashed with Node.js `scrypt`.
- The admin interface trusts localhost socket addresses and should remain localhost-only.
- Source paths, queue plans, usernames, password hashes, sessions, and run history are stored in `database.sqlite`; protect and back up that file appropriately.

## Project Structure

```text
server.js          HTTP server, API, queue runner, FFmpeg orchestration
server/db.js       SQLite schema, authentication, settings, and statistics
public/            Main and admin browser interfaces
docs/USER-GUIDE.md Detailed operator guide
docs/TECH.md       Architecture, API, and persistence documentation
```

## Documentation

- [User guide](docs/USER-GUIDE.md)
- [Technical documentation](docs/TECH.md)

When behavior, UI workflows, API routes, persistence, queue handling, encoding flow, or deployment assumptions change, update the relevant document in `docs/` with the code change.
