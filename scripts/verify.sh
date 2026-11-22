#!/usr/bin/env bash
# verify.sh — 单一验证入口。任何「完成」声明都必须由它证明。
#
#   bash scripts/verify.sh            # fast：类型、lint、单测
#   bash scripts/verify.sh --full     # fast + 构建/冒烟
#   bash scripts/verify.sh --ci       # full + 第二遍（抓 flaky）+ 非交互
#   bash scripts/verify.sh --dry-run  # 只打印将执行的命令
#
# 退出码：0 通过 / 1 有命令失败 / 2 用法错误 / 3 仓库没有可用验证器
#
# 自动探测：package.json（pnpm/yarn/npm 的 typecheck/lint/test/build）、
# Makefile 的 verify 目标、pyproject、go.mod、Cargo.toml。
# 探测不到时返回 3，而不是假装通过。
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || { echo "verify: 无法进入仓库根目录" >&2; exit 2; }

STAGE=fast
TWICE=0
DRY=0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --full) STAGE=full ;;
    --ci) STAGE=ci; TWICE=1 ;;
    --twice) TWICE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage ;;
    *) echo "verify: 未知参数 $1" >&2; usage ;;
  esac
  shift
done

now_ms() {
  local t
  t=$(date +%s%3N 2>/dev/null)
  case "$t" in
    ""|*N*|*[!0-9]*) date +%s | awk '{printf "%d", $1 * 1000}' ;;
    *) printf '%s' "$t" ;;
  esac
}

jesc() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r//g' \
    | LC_ALL=C tr -d '\000-\010\013\014\016-\037'
}

# ---------- 探测 ----------
FAST_CMDS=()
FULL_CMDS=()
DETECTED="none"

has_script() {
  [ -f package.json ] || return 1
  if command -v node >/dev/null 2>&1; then
    node -e 'const s=require("./package.json").scripts||{};process.exit(s[process.argv[1]]?0:1)' "$1" 2>/dev/null
  else
    grep -q "\"$1\"[[:space:]]*:" package.json
  fi
}

CONF=".dsh/verify.conf"
if [ -f "$CONF" ]; then
  DETECTED=".dsh/verify.conf"
  while IFS= read -r line; do
    if [ -z "$line" ]; then continue; fi
    if [ "${line#\#}" != "$line" ]; then continue; fi
    stage=${line%%$'\t'*}
    cmd=${line#*$'\t'}
    if [ "$stage" = "$cmd" ]; then continue; fi
    if [ "$stage" = "fast" ]; then
      FAST_CMDS+=("$cmd")
    elif [ "$stage" = "full" ]; then
      FULL_CMDS+=("$cmd")
    fi
  done < "$CONF"
  if [ ${#FAST_CMDS[@]} -eq 0 ] && [ ${#FULL_CMDS[@]} -eq 0 ]; then
    echo "verify: $CONF 没有可执行命令，回退到自动探测" >&2
    DETECTED="none"
  fi
fi

if [ ${#FAST_CMDS[@]} -eq 0 ] && [ ${#FULL_CMDS[@]} -eq 0 ] && [ -f package.json ]; then
  PM=npm
  [ -f pnpm-lock.yaml ] && PM=pnpm
  [ -f yarn.lock ] && PM=yarn
  DETECTED="package.json ($PM)"
  has_script typecheck && FAST_CMDS+=("$PM run typecheck")
  has_script lint && FAST_CMDS+=("$PM run lint")
  has_script test && FAST_CMDS+=("$PM run test")
  has_script build && FULL_CMDS+=("$PM run build")
fi

if [ ${#FAST_CMDS[@]} -eq 0 ] && [ -f Makefile ] && grep -Eq '^verify[[:space:]]*:' Makefile; then
  DETECTED="Makefile (verify)"
  FULL_CMDS+=("make verify")
fi

if [ ${#FAST_CMDS[@]} -eq 0 ] && [ ${#FULL_CMDS[@]} -eq 0 ]; then
  if { [ -f pyproject.toml ] || [ -f setup.py ]; } && python3 -c 'import pytest' >/dev/null 2>&1; then
    DETECTED="python (pytest)"
    FAST_CMDS+=("python3 -m pytest -q")
  elif [ -f go.mod ]; then
    DETECTED="go (go test)"
    FAST_CMDS+=("go test ./...")
  elif [ -f Cargo.toml ]; then
    DETECTED="rust (cargo test)"
    FAST_CMDS+=("cargo test --quiet")
  fi
fi

if [ "$STAGE" = "fast" ]; then CMDS=("${FAST_CMDS[@]+"${FAST_CMDS[@]}"}"); else CMDS=("${FAST_CMDS[@]+"${FAST_CMDS[@]}"}" "${FULL_CMDS[@]+"${FULL_CMDS[@]}"}"); fi

if [ ${#CMDS[@]} -eq 0 ] && [ "$DRY" -eq 0 ]; then
  echo "verify: no verifier configured（未探测到可执行检查）" >&2
  echo "verify: 先添加 typecheck/lint/test 脚本，或写一个 Makefile 的 verify 目标" >&2
  exit 3
fi

if [ "$DRY" -eq 1 ]; then
  if [ ${#CMDS[@]} -eq 0 ]; then
    echo "verify: no verifier configured（未探测到可执行检查）" >&2
    exit 3
  fi
  echo "verifier: $DETECTED"
  echo "stage:    $STAGE"
  for c in "${CMDS[@]+"${CMDS[@]}"}"; do echo "  $c"; done
  exit 0
fi

# ---------- 证据目录 ----------
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
DIRTY=$(git status --porcelain -- . ':(exclude).dsh' 2>/dev/null | wc -l | tr -d ' ')
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${SHA}-${STAGE}"
EVID=".dsh/evidence/${RUN_ID}"
mkdir -p "$EVID"
CMDS_LOG="${EVID}/commands.log"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_MS=$(now_ms)

TOTAL=0
PASSED=0
FAILED=0
ENTRIES=()

run_one() {
  local pass="$1" idx="$2" cmd="$3"
  local name log s e rc dur
  name="p${pass}-${idx}"
  log="${EVID}/${name}.log"
  TOTAL=$((TOTAL + 1))
  printf '\n$ %s\n' "$cmd"
  s=$(now_ms)
  CI=true bash -c "$cmd" >"$log" 2>&1
  rc=$?
  e=$(now_ms)
  dur=$((e - s))
  sed -n '1,80p' "$log"
  if [ "$rc" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    printf '  -> 0 (%sms)\n' "$dur"
  else
    FAILED=$((FAILED + 1))
    printf '  -> %s (%sms)  见 %s\n' "$rc" "$dur" "$log"
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$rc" "$dur" "$cmd" >>"$CMDS_LOG"
  ENTRIES+=("$(printf '    { "name": "%s", "cmd": "%s", "exit": %s, "duration_ms": %s, "log": "%s" }' \
    "$name" "$(jesc "$cmd")" "$rc" "$dur" "$(jesc "$log")")")
}

run_pass() {
  local pass="$1" idx=0 c
  shift
  for c in "$@"; do
    idx=$((idx + 1))
    run_one "$pass" "$idx" "$c"
  done
}

run_pass 1 "${CMDS[@]}"
if [ "$TWICE" -eq 1 ]; then
  echo
  echo "verify: 第二遍（检测 flaky / 非确定性）"
  run_pass 2 "${CMDS[@]}"
fi

END_MS=$(now_ms)
DUR=$((END_MS - START_MS))
FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$FAILED" -eq 0 ]; then RESULT=pass; else RESULT=fail; fi

{
  printf '{\n'
  printf '  "schema": 1,\n'
  printf '  "run_id": "%s",\n' "$(jesc "$RUN_ID")"
  printf '  "stage": "%s",\n' "$STAGE"
  printf '  "result": "%s",\n' "$RESULT"
  printf '  "verifier": "%s",\n' "$(jesc "$DETECTED")"
  printf '  "commit": "%s",\n' "$(jesc "$SHA")"
  printf '  "dirty": %s,\n' "${DIRTY:-0}"
  printf '  "started_at": "%s",\n' "$STARTED_AT"
  printf '  "finished_at": "%s",\n' "$FINISHED_AT"
  printf '  "duration_ms": %s,\n' "$DUR"
  printf '  "commands": [\n'
  i=0
  for entry in "${ENTRIES[@]+"${ENTRIES[@]}"}"; do
    i=$((i + 1))
    if [ "$i" -lt "${#ENTRIES[@]}" ]; then printf '%s,\n' "$entry"; else printf '%s\n' "$entry"; fi
  done
  printf '  ],\n'
  printf '  "failed": %s,\n' "$FAILED"
  printf '  "uncovered": []\n'
  printf '}\n'
} >"$EVID/summary.json"

echo
if [ "$RESULT" = "pass" ]; then
  printf 'verify: PASS (%s) %s commands, 0 failed\n' "$STAGE" "$TOTAL"
else
  printf 'verify: FAIL (%s) %s commands, %s failed\n' "$STAGE" "$TOTAL" "$FAILED"
fi
printf 'evidence: %s/summary.json\n' "$EVID"

[ "$RESULT" = "pass" ] || exit 1
exit 0
