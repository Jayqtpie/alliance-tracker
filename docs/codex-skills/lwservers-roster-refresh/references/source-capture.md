# Source capture details

These selectors were verified on the signed-in LWServers home page on 6 September 2026. Inspect the live DOM before using them. Read only rendered page data; do not invoke hidden application state or guessed network endpoints.

## Roster

After **Alliance → Roster**, rows were `.hm-mem[data-uid]`:

| Field | Observed element |
| --- | --- |
| UID | Row `data-uid` attribute |
| Exact name | First text node of `.hm-mem-name` (exclude nested rank and “you” badges) |
| Alliance rank | `.hm-rk` text |
| Sort position | `.hm-mem-rk` text |
| FSP estimate and basis | `.hm-mem-pw` text, e.g. `67.9M FSP est` or `56.2M FSP assumed` |
| Avatar URL | Row `img` `src` |
| Open profile | `.hm-mem-name` button within that UID's row |

Retain exact Unicode and internal whitespace in names. UI labels may collapse repeated spaces; extract the name text itself. Two similar Chinese names in the roster are distinct UIDs and must stay separate.

## Each profile

Opening a row displayed `#pmOverlay`, a modal with a button named **Close**. Read one profile at a time, verify it belongs to the clicked row, collect its fields, and close it before opening the next. Use bounded batches so a failure does not lose completed readings. Wait for the profile to finish loading rather than recording placeholders or the previous modal's contents.

| Field | Observed element |
| --- | --- |
| Name (cross-check) | `#pmName` |
| Alliance (cross-check) | `#pmAlliance` |
| Hero power | `#pmHero` |
| Total power | `#pmPower` |
| Kills | `#pmKills` |
| Profile FSP (cross-check) | `#pmFsp` |
| Activity date | `.pm-daily-date` under the Gained today section, when present |
| Last seen | Labeled row under `#pmDetails` |
| Profile avatar URL | `#pmAvatar img` `src` |

Profile names may have a country flag or globe prefix added by the UI. Cross-check the roster name rather than saving the UI decoration as part of the player name. Do not broadly strip non-Latin characters or genuine name symbols. If roster and profile names disagree beyond display decoration, retain both readings and reconcile the UID/source discrepancy before applying.

Normalize the literal LEGACY marker to the capture format expected by `parseDisplayedPower` without changing its meaning. Preserve display precision. A missing kills reading is null, never zero. A Gained today date is source activity context; it is not the refresh date or proof every field was measured on that day.

## Assets and durable export

The browser's `pageAssets` capability supported `list()` followed by `bundle({ inventoryId, assetIds })` for observed images. Read its documentation before use. Select the roster/profile avatar URLs, then use the returned manifest's URL-to-local-file mapping to associate exported images with UIDs. Prefer the profile image when it is available and corroborates the player. One successful run exported 100 usable current avatars despite three unused older-image URLs failing.

Persist a normalized capture outside the conversation as soon as the complete source read is available. Use supported exports or transfer the returned structured data to a repository-local ignored staging file such as `.data/lwservers-refresh-<date>.json`. Preserve rows already read if an intermediate batch fails. Never re-use the previous week's statistics as a substitute for unread current profiles.

If transferring records through tool output, verify that the staged representation exactly matches the browser readings before generating the capture. A deterministic checksum plus row/UID counts catches transcription loss. The previous run used UTF-16 FNV-1a over normalized lines; any reliable exact comparison or checksum is suitable. Avoid huge full-page accessibility dumps: use targeted DOM reads for the roster and current profile.

Review the existing dated capture for required field names. At creation time it contained source/alliance metadata, capture/export dates, member/leader/officer/FSP counts, notes, UID-based changes, and members with:

`position`, `uid`, `name`, `rank`, `displayedFspMillions`, `fspBasis`, `avatarUrl`, `avatarFile`, image dimensions, and a `profile` object containing source, capturedOn, heroPowerDisplay, powerDisplay, killsDisplay, killsApproximate, killsStatus, lastSeenDisplay and activityDate.

Keep source exports and historical ranking snapshots distinct. The roster import updates member profiles; the published score entries remain attached to their existing tracker member IDs.
