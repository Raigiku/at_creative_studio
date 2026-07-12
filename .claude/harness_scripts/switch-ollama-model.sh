#!/usr/bin/env bash
# switch-ollama-model.sh — pick an installed Ollama model and rewrite the four
# ANTHROPIC_*_MODEL slots in .claude/settings.json to point at it. Also sets
# CLAUDE_CODE_AUTO_COMPACT_WINDOW to 95% of the model's context length so the
# auto-compact threshold is appropriate for whichever model is active.
#
# Usage:  ./harness-scripts/switch-ollama-model.sh [--window N]
#         --window N    override the auto-compact window. Default is 95% of
#                       the selected model's context length. Floor is 100,000
#                       per the client schema
#                       (https://github.com/anthropics/claude-code/issues/54819).
# Env:    OLLAMA_URL  override the Ollama base URL (default: http://localhost:11434)
#         SETTINGS    override the settings.json path
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS="${SETTINGS:-${ROOT}/.claude/settings.json}"
BAK="${SETTINGS}.bak"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

# Schema floor: client enforces minimum 100,000 tokens on autoCompactWindow.
WINDOW_FLOOR=100000
WINDOW_HEADROOM_PCT=95   # use 95% of model context as the default window

# --- flags --------------------------------------------------------------------
WINDOW_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --window)
      WINDOW_OVERRIDE="${2:-}"
      shift 2
      ;;
    --window=*)
      WINDOW_OVERRIDE="${1#--window=}"
      shift
      ;;
    -h|--help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument '$1' (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ -n "$WINDOW_OVERRIDE" ]; then
  if ! [[ "$WINDOW_OVERRIDE" =~ ^[0-9]+$ ]] || [ "$WINDOW_OVERRIDE" -lt "$WINDOW_FLOOR" ]; then
    echo "error: --window must be an integer >= $WINDOW_FLOOR (got '$WINDOW_OVERRIDE')" >&2
    exit 1
  fi
fi

# --- sanity checks -----------------------------------------------------------
if [ ! -f "$SETTINGS" ]; then
  echo "error: settings.json not found at $SETTINGS" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required (used for JSON parsing)" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

# --- fetch live model list ---------------------------------------------------
echo "Fetching model list from ${OLLAMA_URL} ..."
if ! models_json=$(curl -sf "${OLLAMA_URL}/api/tags"); then
  echo "error: could not reach Ollama at ${OLLAMA_URL}" >&2
  exit 1
fi

# Build a TSV: family<TAB>modified_at<TAB>name<TAB>context_length<TAB>parameter_size<TAB>capabilities_csv
# Sorted by (family asc, modified_at asc) — within a family, oldest first.
# Empty fields are emitted as '-' so bash's `read` doesn't collapse them when
# consecutive tabs appear.
tsv=$(printf '%s' "$models_json" | python3 -c "
import json, sys

def cell(v):
    return str(v) if v else '-'

def fmt_int(v):
    # Group digits with thin spaces (U+2009) for readability: 1048576 -> 1 048 576.
    s = str(v)
    if not s.isdigit():
        return s
    out, sign = [], '' if not s.startswith('-') else '-'
    digits = s[1:] if sign else s
    while len(digits) > 3:
        out.insert(0, digits[-3:])
        digits = digits[:-3]
    out.insert(0, digits)
    return sign + ' '.join(out)

def name_family(name):
    # Strip the ':tag' suffix, then take the leading alphabetic prefix.
    # qwen3.5:397b-cloud -> qwen; deepseek-v4-pro:cloud -> deepseek; kimi-k2.7-code:cloud -> kimi.
    base = name.split(':', 1)[0]
    out = []
    for ch in base:
        if ch.isalpha():
            out.append(ch)
        else:
            break
    return ''.join(out) or base

models = json.load(sys.stdin)['models']
models.sort(key=lambda m: (m.get('details', {}).get('family') or name_family(m['name']),
                           m.get('modified_at', '')))
for m in models:
    det = m.get('details', {})
    raw_family = det.get('family') or name_family(m['name'])
    raw_ctx = det.get('context_length')
    caps = ','.join(sorted(m.get('capabilities', [])))
    # TSV columns: family, modified_at, name, ctx_display, ctx_raw, params, caps.
    # ctx_display is for the menu; ctx_raw is for arithmetic.
    print('\t'.join([
        cell(raw_family),
        cell(m.get('modified_at')),
        cell(m['name']),
        cell(fmt_int(raw_ctx)),
        cell(raw_ctx),
        cell(det.get('parameter_size')),
        cell(caps),
    ]))
")

if [ -z "$tsv" ]; then
  echo "error: no models returned by Ollama" >&2
  exit 1
fi

# --- read current selection + current window from settings.json -------------
read_current() {
  python3 - "$SETTINGS" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
env = d.get("env", {})
print(env.get("ANTHROPIC_MODEL", ""))
print(env.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW", ""))
PY
}
mapfile -t current_state < <(read_current)
current="${current_state[0]}"
current_window="${current_state[1]}"

# --- print menu --------------------------------------------------------------
printf '\nCurrently active model: %s\n\n' "$current"
# Header columns sized exactly like data columns so labels line up with values.
#   #  FAMILY      NAME                            MODIFIED    CTX       PARAMS  CAPABILITIES
#   --- ---------- ------------------------------ ---------- ---------- ------- -----------
#   1  deepseek    deepseek-v4-flash:cloud         2026-04-25  1 048 576  -       completion,thinking,tools
printf '  %3s  %-10s  %-30s  %-10s  %10s  %-7s  %s\n' \
  '# ' 'FAMILY    ' 'NAME                         ' 'MODIFIED  ' '       CTX' 'PARAMS ' 'CAPABILITIES'
printf '  %3s  %-10s  %-30s  %-10s  %10s  %-7s  %s\n' \
  '---' '----------' '------------------------------' '----------' '----------' '-------' '-----------'

i=1
while IFS=$'\t' read -r family modified name ctx ctx_raw params caps; do
  # ctx_raw is the unformatted context (for arithmetic); not displayed.
  # Truncate modified_at to date only (first 10 chars: YYYY-MM-DD).
  modified_short="${modified:0:10}"
  # Mark the active model with a leading '*' on the row number.
  if [ "$name" = "$current" ]; then
    printf '  *%2d  %-10s  %-30s  %-10s  %10s  %-7s  %s\n' \
      "$i" "$family" "$name" "$modified_short" "$ctx" "$params" "$caps"
  else
    printf '  %3d  %-10s  %-30s  %-10s  %10s  %-7s  %s\n' \
      "$i" "$family" "$name" "$modified_short" "$ctx" "$params" "$caps"
  fi
  i=$((i+1))
done <<< "$tsv"

# --- read + validate choice --------------------------------------------------
# Use parallel arrays so we can look up ctx by name after the user picks.
# contexts[] holds the raw integer (for arithmetic), not the formatted string.
names=()
contexts=()
while IFS=$'\t' read -r _ _ name _ ctx _ _; do
  names+=("$name")
  contexts+=("$ctx")
done <<< "$tsv"
total=${#names[@]}

resolved=""
resolved_ctx=""
while [ -z "$resolved" ]; do
  read -rp $'\nSelect model [1-'"$total"' or exact name, q to quit]: ' choice
  case "$choice" in
    q|Q) echo "aborted."; exit 0 ;;
    "")
      echo "  ! no selection, try again."
      ;;
    *)
      if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$total" ]; then
        resolved="${names[$((choice-1))]}"
        resolved_ctx="${contexts[$((choice-1))]}"
      else
        # exact name match
        for idx in "${!names[@]}"; do
          if [ "${names[$idx]}" = "$choice" ]; then
            resolved="${names[$idx]}"
            resolved_ctx="${contexts[$idx]}"
            break
          fi
        done
        [ -z "$resolved" ] && echo "  ! '$choice' is not in the list, try again."
      fi
      ;;
  esac
done

# --- derive the autoCompactWindow from the model's context length -------------
# If the user passed --window, use that. Otherwise derive 95% of the model's
# context length, clamped to the schema floor of WINDOW_FLOOR.
if [ -n "$WINDOW_OVERRIDE" ]; then
  window_value="$WINDOW_OVERRIDE"
  window_source="user"
else
  if [ "$resolved_ctx" = "?" ] || [ "$resolved_ctx" = "-" ] || [ -z "$resolved_ctx" ]; then
    echo "warning: selected model has no context_length in /api/tags; not setting CLAUDE_CODE_AUTO_COMPACT_WINDOW" >&2
    window_value=""
    window_source=""
  else
    derived=$(( resolved_ctx * WINDOW_HEADROOM_PCT / 100 ))
    if [ "$derived" -lt "$WINDOW_FLOOR" ]; then
      echo "warning: derived window $derived is below the $WINDOW_FLOOR schema floor; clamping" >&2
      derived="$WINDOW_FLOOR"
    fi
    window_value="$derived"
    window_source="derived"
  fi
fi

# --- decide what to write ---------------------------------------------------
# Rules:
#   - The model is always written (that is the point of the script).
#   - The window is written when:
#       (a) the user passed --window explicitly, OR
#       (b) the user did not pass --window AND the model changed AND the
#           derived window differs from the current value.
#     If the user did not pass --window AND the model is the same, the existing
#     window is preserved (no accidental clobbering of a custom value).
write_window=""
if [ -n "$WINDOW_OVERRIDE" ]; then
  write_window="$WINDOW_OVERRIDE"
elif [ "$resolved" != "$current" ] && [ -n "$window_value" ] && [ "$window_value" != "$current_window" ]; then
  write_window="$window_value"
fi

if [ "$resolved" = "$current" ] && [ -z "$write_window" ]; then
  printf '\n%s is already the active model and the auto-compact window is unchanged — nothing to do.\n' "$resolved"
  exit 0
fi

# --- backup once -------------------------------------------------------------
if [ ! -f "$BAK" ]; then
  cp "$SETTINGS" "$BAK"
  echo "backup created: $BAK"
fi

# --- rewrite the four model slots (and the window) in place -----------------
python3 - "$SETTINGS" "$resolved" "$write_window" <<'PY'
import json, sys
path, model, window = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)
env = data.setdefault("env", {})
model_keys = (
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
)
for k in model_keys:
    env[k] = model
if window:
    env["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] = window
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

printf '\nupdated 4 model slots -> %s\n' "$resolved"
if [ -n "$write_window" ]; then
  printf 'set CLAUDE_CODE_AUTO_COMPACT_WINDOW=%s  (%s from %s ctx %s)\n' \
    "$write_window" "$window_source" "$resolved" "$resolved_ctx"
fi
printf 'restart Claude Code (or open a new shell) to pick up the new model.\n'
