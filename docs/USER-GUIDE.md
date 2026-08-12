# User Guide

## What This App Does

FFmpeg Webapp is a browser UI for the two-pass batch encode workflow. It scans a source folder for video files, lets you review and edit the queue before starting, then runs live ffmpeg encoding with progress, logs, recent completions, and lifetime stats stored in SQLite.

## Access

- You must register or log in.
- Only the username `koldKat` is allowed to use the application.
- Other accounts can exist, but they are blocked from the encode UI.

## Start The App

```bash
git clone https://github.com/koldKat/ffmpeg-encode.git
cd ffmpeg-encode
npm install
npm start
```

Open `http://<machine>:3017`.

Local admin:
- open `http://localhost:3017/admin` on the machine running the server
- `/admin` is localhost-only
- the main app remains reachable remotely

## Job Setup

Main fields:
- `Source root`: folder to scan for video files.
- `Staging root`: temporary output area used during encoding before the final file is promoted.
- `Tune`: default x264 tune.
- `Preset`: ffmpeg/x264 preset.
- `MB/min`: target-size rate before step rounding. Default `10`.
- `MB/step`: target-size rounding step in MB. Default `50`.
- `Audio kbps`: AAC audio bitrate.
- `Min video kbps`: minimum allowed video bitrate floor.
- `Overhead %`: bitrate safety margin.
- `Threads`: optional encoder thread count. `0` means ffmpeg default behavior.

Target size is calculated as:
- `duration_minutes * MB/min`
- then rounded up to the next `MB/step`

Example:
- `22:45` at `10 MB/min` with `50 MB/step` -> `250 MB`
- `22:45` at `10 MB/min` with `10 MB/step` -> `230 MB`

Path inputs use live directory suggestions from disk while you type. This is available for `Source root`, `Staging root`, and the bulk `Apply save folder` field.

These settings are stored in the database per machine for the logged-in user. The server detects the current machine automatically from its hostname. The editable queue plan is also persisted per machine, so after a restart your per-file or per-folder tune, audio-track, save-folder, and source-deletion assignments, plus the queue order you arranged, come back on that same machine unless the source files have already been removed.

`Delete all source files after successful encode` is off by default. Turning it on selects source deletion for every queued file. Clearing any individual file automatically clears the global checkbox; selecting every individual file automatically selects it again.

## Queue Editing Before Start

Press `Load File Queue` after setting the source root.

Selection behavior:
- Files directly inside the selected source root are selectable one by one.
- Files inside subfolders are grouped by subfolder for bulk selection.
- `Select All` selects every visible selection unit.
- `Clear` removes the current selection.

Bulk actions:
- Root-level files can be dragged individually to reorder the batch before start.
- Subfolders are dragged as a single unit, while the files inside that subfolder keep their existing internal order.
- The queue auto-scrolls while dragging near the top or bottom edge, so long moves do not require step-by-step repositioning.
- Queue cards stay compact by hiding the source path until you hover the file or folder name.
- `Apply Tune` sets a tune for all selected files.
- `Apply Audio` accepts either a language shown from the files' probed metadata or a zero-based audio stream number. Track `0` is the first audio stream, track `1` is the second, and so on.
- Language suggestions are derived from the loaded files; languages are not hardcoded. The server resolves the requested language separately for each selected file.
- If a requested language is missing from a particular file, that file falls back to audio track `0`.
- `Apply Save Folder` sets the final destination folder for all selected files.
- `Delete source` is independent per file. Root-level files show it directly. Grouped folders provide a compact expandable list so every file can be changed separately without ungrouping the queue.
- The `X` button on each queue card removes that file or grouped subfolder from the editable queue only. It does not delete anything from disk.

This allows mixed batches, for example:
- 200 files saved to one folder with `animation`
- 20 files saved to another folder with `film`
- root-level files handled one by one

Queue plan persistence:
- loaded queue assignments are stored in SQLite per machine
- the current machine is detected automatically from the server hostname
- restarting the server reloads the remaining queue plan for that machine
- pressing `Load File Queue` preserves saved per-file tune, audio-track, save-folder, source-deletion assignments, and queue order for matching files
- saved queue order is preserved for matching files on that machine
- successfully encoded or skipped files are removed from the saved plan
- failed files remain in the saved plan
- if source subfolders become empty and are removed, the saved plan is cleaned up to match

## Adding Files During A Run

While a batch is active, the Queue card shows an append panel. Enter a supported video file or a folder inside the active source root, then press `Inspect`. A folder is scanned recursively and its new supported files are probed before anything is added.

Inspection opens a queue-editor dialog matching the main Queue panel, with one selectable row per discovered file. In that dialog you can:
- select any individual files, or use `Select All` and `Clear`
- apply `Tune`, audio language/track, and save destination to the selected rows with the same bulk toolbar used by the main Queue panel
- choose `Delete source` independently for every inspected file before adding it
- choose audio suggestions derived only from the inspected files' metadata
- remove files you do not want to append
- drag files into their initial processing order

Press `Add to Queue` to append the remaining configured rows in their displayed order. Inspections expire after ten minutes and are single-use.

- Existing queue paths are ignored, so the same file is not added twice.
- The staging folder and paths outside the active source root are rejected.
- Blank settings fall back to the active batch tune, audio track `0`, and each file's source folder.
- Added files are persisted immediately with the remaining queue and survive a server restart.
- The batch total, overall progress, and ETA are recalculated as soon as files are added. The percentage may decrease because the batch now contains more work.
- During encoding, the current file is locked in place but every visible pending file can be dragged into a new order. Loaded pending entries are reordered without moving unseen entries ahead of them.
- Tune, audio, destination, and removal remain locked for files already in the active queue. Source deletion can still be changed for pending files, but is locked for the file currently encoding.
- If `Stop After Current File` is enabled, the current file still finishes and the newly added files remain saved for a later run.

## What Happens During Encoding

For each file:
- ffprobe is used to read duration and frame metadata.
- Target size is computed from `MB/min` and rounded up to the next `MB/step`.
- A two-pass H.264 encode is run.
- Output is staged under the staging root.
- The staged file is then promoted into the file's configured final save folder.

If `Delete source` is selected for a file and the final save succeeds:
- the original source file is deleted when the output path differs
- a same-path MP4 is replaced by its completed encode
- now-empty source subfolders are removed upward until the selected source root is reached

If `Delete source` is not selected, the original remains untouched. When an MP4 would otherwise overwrite itself in its source folder, the output is named `<name>.encoded.mp4` instead. The same safe name is used if the normal output would overwrite a different queued source with the same basename, even when deletion is selected. If that fallback is also a queued source, numbered names such as `<name>.encoded-2.mp4` are used. These generated suffixes are excluded from later scans and active-run inspection so they are not encoded repeatedly.

The selected source root itself is not removed.

The output keeps the first video stream and one selected audio stream. Audio is encoded as AAC stereo. Subtitles, chapters, attachments, source metadata, extra video streams, and additional audio streams are not copied.

## Skip Behavior

A file is skipped when:
- the destination file already exists and is newer than the source file
- ffprobe cannot read a usable duration

Skipped files remain reflected in counts and lifetime stats because they represent deliberate non-encodes with a concrete reason. Failed files are reserved for genuine encode or promotion errors.

## Stop Behavior

Press `Stop` to stop the active ffmpeg job immediately.

Use `Pause` in the Current File header to suspend the active ffmpeg job mid-file. Press `Resume` to continue from that point.

Use `Stop After Current File` in the Current File header and press `Enable` to let the current file finish completely before the batch halts. Press `Disable` to cancel that request. If the file is on pass 1, the app waits for pass 2 and final file promotion as well.

The server sends stop signals to the running ffmpeg process group for immediate stops. Server shutdown also attempts to stop the active ffmpeg process so the encoder is less likely to remain running in the background.

User-initiated stops are tracked as `stopped`, not as failed files.

Pause state and partial FFmpeg passes do not survive a server restart. Server shutdown attempts to stop FFmpeg, and the remaining queue plan is retained. Starting again processes the unfinished file from the beginning; it does not resume the interrupted pass.

When ffmpeg finishes and the output is being copied to its final destination on another filesystem, the Current File progress bar switches to `Move progress` and shows the file-transfer percentage until promotion completes.

## Dashboard Sections

### Batch Summary
- Current counts
- Current savings
- Current speed, based on completed file results for the current batch
- Current ETA, estimated from completed file results for the current batch
- Overall progress bar

### All-Time Summary
- Successful files processed
- Lifetime savings
- Lifetime speed
- Database size
- Last activity timestamp

You can also use the `Vacuum Database` button under `Database Size` when no job is running to compact the SQLite file on disk.

### Current File
Shows the active file, pass, speed, frame rate, frames, ETA/finish time, size, and bitrate estimates.

### Queue
- Before start: editable queue with selection controls
- During run: live remaining queue with the current encode locked, pending-file drag reorder, and a modal editor for new files
- The browser renders 50 entries initially and appends 50 more for each separate scroll to the bottom.

### Latest Completed
Shows successful files from the current or retained last run, newest first. It renders 50 initially and appends 50 more when you scroll to the bottom.

### Run Log
Shows current-batch events, including scans, starts, skips, failures, stops, and completion messages. It renders the newest 50 initially and appends 50 more when you scroll to the bottom. Individual messages are shortened to 420 characters.

## Admin Panel

The localhost-only admin panel at `/admin` can:
- create users
- reset passwords for users other than `koldKat`
- delete users other than `koldKat`
- update the app version shown in the dashboard header
- show hostname, user/session counts, RSS, heap memory, and current Node-plus-FFmpeg CPU usage

`koldKat` is intentionally protected in the admin UI and admin API.

Saving the app version remains a manual admin action. The same submitted value is stored in SQLite and mirrored to the repository-root `VERSION` file. There is no automatic version increment. On a fresh database only, the initial `app_version` value is seeded by reading `VERSION`; an existing database value always wins on boot.

Admin resource cards refresh every second. CPU percentage is normalized to the full machine capacity, so it remains in the human-readable `0-100%` range.

## Notes

- The active queue API and browser use 50-item pages so large batches do not flood every live update.
- The editable queue is fetched in full because folder grouping and exact drag reordering require the whole order, but only 50 queue cards are rendered initially.
- Database size is based on the SQLite file size reported from SQLite page statistics.
