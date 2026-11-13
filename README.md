# Perceptle Tracker

Reads Perceptle scores from the group chat in Messages every night at midnight. It builds a leaderboard for each puzzle and keeps per-player stats for the overall score and each of the 5 categories. The scores page in `web/` reads `data/export.json`, so it shows each new scan on reload.

## How it works

- `bin/perceptle-scan` reads `~/Library/Messages/chat.db` (read-only) for messages in the configured chat newer than the last one it saw (the watermark in `data/perceptle.db`).
- Scores are keyed by **puzzle number**, not by a 24-hour window, so late posts and missed nights land on the right puzzle. Re-running is safe: messages already stored are skipped.
- A message counts only if all of these hold:
  - It starts with `Perceptle #N … - G (overall)`. This also screens out tapbacks such as "Loved “Perceptle…”".
  - The next line has all 5 category scores.
  - The overall equals the rounded average of the 5. This is how doctored posts with a category deleted get rejected.
- If someone posts more than once for the same puzzle, the **first valid post counts**. Later ones are stored as `duplicate`.
- A 🃏 in the header (joker days) is recorded per post. A puzzle is a joker day if any post for it had 🃏. Posts stored before this existed get the flag filled in on the next scan, from the message by rowid.
- Raw message text is never stored. Only the parsed scores are.
- Puzzle dates come from `puzzleAnchor` in `config.json` (#118 = 2026-11-12).

## Commands

| Command | What it does |
| --- | --- |
| `bun run scan` | Scan for new posts, print updated boards and stats, write `data/export.json` |
| `bun run stats` | Player averages: overall and per category, plus best, worst, wins, category leaders |
| `bun run board [N]` | Leaderboard for puzzle N (default: latest) |
| `bun test` | Parser tests |
| `bun run web` | Scores page at http://localhost:4118: averages per game and each player's daily scores. Serves only the page and `data/export.json`, on this Mac only. Game names (Dots, Ball, Angle, Tempo, Cut) are set in `GAME_NAMES` in `web/index.html` |

Running from a terminal needs that terminal to have Full Disk Access. Inside Claude Code it already does.

## Setup on a new machine

1. `cp config.example.json config.json` and fill in the chat GUID, the player handles and names, and category labels. `config.json` is gitignored because it holds phone numbers.
2. `sh scripts/build.sh` compiles `bin/perceptle-scan`.
3. `sh scripts/install-launchd.sh` installs the nightly job at 00:00. If the Mac is asleep at midnight, launchd runs it once on wake. To remove it, run `sh scripts/uninstall-launchd.sh`.
4. Add `bin/perceptle-scan` in **System Settings → Privacy & Security → Full Disk Access**. In the file picker, press ⌘⇧G and paste the full path. Only this file gets access.
5. Check: `launchctl kickstart -k gui/$(id -u)/com.perceptle-tracker.scan`, then `cat logs/scan.log`. If you see `authorization denied`, step 4 hasn't taken effect.

## Full Disk Access and rebuilds

Tested 2026-11-12:
- **Without the grant**, the launchd run fails with `cannot read …/chat.db: authorization denied`. Running it from Claude Code's shell doesn't prove anything, because that shell has its own grant. Always check through `launchctl kickstart`.
- **With the grant**, the launchd run reads the chat and exits 0.
- **Rebuilding unchanged code** produces a byte-identical binary (same CDHash), and the grant keeps working.
- **After a code change** (tested with the attributedBody length fix), the CDHash changed and the launchd run went back to `authorization denied`. **After every code change: rebuild, remove `perceptle-scan` from Full Disk Access (−), add it again (+), then kickstart and check `logs/scan.log`.** The grant is tied to the exact binary, because `bun build --compile` produces an ad-hoc signature.

## Data

- `data/perceptle.db` (SQLite)
  - `posts` table: every Perceptle post seen, with `status` = counted / duplicate / rejected.
  - Views: `daily_board`, `player_stats`, `category_leaders`.
- `data/export.json`: boards, player stats and category leaders. Each puzzle has `joker: true|false`. Names only, no phone numbers.
- Category keys name the emoji (`numbers` 🔢, `target` 🎯, `ruler` 📐, `drum` 🥁, `scissors` ✂️). Set display names in `config.json` → `categoryLabels`.

## Publishing (Vercel)

The scores page is public on Vercel to anyone with the link. It's marked `noindex`, so search engines leave it out, but the link can be passed on. Visitors see first names and scores.

- `sh scripts/deploy.sh` uploads exactly two files, `web/index.html` and `data/export.json`, from a staging folder (`data/site/`). `config.json` and the database never leave the Mac. If neither file changed since the last upload, it skips. `FORCE=1` uploads anyway.
- A second launchd job, `com.perceptle-tracker.deploy`, runs it whenever `data/` changes, which includes every scan rewriting `export.json`: the midnight run, a late run on wake, or a scan you run yourself. The site updates a few seconds after the scan. The job also runs hourly as a backup. Runs with no changes skip without logging anything. The job is kept separate from the scan job so the scanner's Full Disk Access grant is never involved. It writes uploads and errors to `logs/deploy.log`.
- Setup: `npm install -g vercel`, then `vercel login` (once, yourself), then set `vercelProject` in `config.json`, then `sh scripts/deploy.sh`, then `sh scripts/install-deploy-launchd.sh`. If you switch Node versions with nvm, rerun the install script so the job can find `vercel` again.
- To stop updates: `sh scripts/uninstall-deploy-launchd.sh`. The site stays up with its last scores. To take it down, delete the project in the Vercel dashboard. Its name is `vercelProject` in `config.json`, which stays out of git so the public repo doesn't link to the site.
