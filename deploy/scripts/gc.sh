#!/usr/bin/env bash
# Removes build folders nothing can still need. Dry run unless --apply.
#
#   deploy/scripts/gc.sh            # show what would be removed
#   deploy/scripts/gc.sh --apply
#
# A folder is KEPT when any of these is true:
#   - one of the last $KEEP_RELEASES releases references it (rollback targets);
#   - AuthService lists it as live, or as superseded within $KEEP_DAYS days (an open tab may still be
#     running it — a user who loaded Lead 1.0.0 yesterday and never reloaded keeps fetching its chunks);
#   - it was added within $KEEP_DAYS days.
# Deleting a folder a live tab still uses breaks that tab with "Failed to fetch dynamically imported
# module", which is why the rules err towards keeping.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

KEEP_RELEASES="${KEEP_RELEASES:-10}"
KEEP_DAYS="${KEEP_DAYS:-30}"
APPLY=false; [[ "${1:-}" == --apply ]] && APPLY=true

declare -A KEEP=()

# Recent releases.
for release in $(ls -1 "$RELEASE_ROOT/releases" | sort -r | head -n "$KEEP_RELEASES"); do
  m="$RELEASE_ROOT/releases/$release/release-manifest.json"
  KEEP["host/$(jq -r .host.version "$m")"]=1
  for key in $(jq -r '.remotes | keys[]' "$m"); do KEEP["modules/$key/$(jq -r ".remotes[\"$key\"].version" "$m")"]=1; done
done

# What AuthService says is live or recently was.
cutoff="$(date -u -d "-$KEEP_DAYS days" +%Y-%m-%dT%H:%M:%S)"
while IFS=$'\t' read -r key version status promoted; do
  if [[ "$status" == Live || ( "$status" == Superseded && "$promoted" > "$cutoff" ) ]]; then
    [[ "$key" == host ]] && KEEP["host/$version"]=1 || KEEP["modules/$key/$version"]=1
  fi
done < <(release_api GET | jq -r '.[] | [.key, .version, .status, (.promotedAt // "")] | @tsv')

removed=0
while IFS= read -r dir; do
  rel="${dir#"$RELEASE_ROOT"/}"
  [[ -n "${KEEP[$rel]:-}" ]] && continue
  if [[ -n "$(find "$dir" -maxdepth 0 -mtime "-$KEEP_DAYS")" ]]; then continue; fi
  if $APPLY; then rm -rf "$dir" "$RELEASE_ROOT/.checksums/${rel//\//__}"; ok "removed $rel"; else log "would remove $rel"; fi
  removed=$((removed + 1))
done < <(find "$RELEASE_ROOT/host" -mindepth 1 -maxdepth 1 -type d; find "$RELEASE_ROOT/modules" -mindepth 2 -maxdepth 2 -type d)

$APPLY || log "Dry run: $removed folder(s) would be removed. Re-run with --apply."
