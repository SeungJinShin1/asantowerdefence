"""동시 접속 스모크 — 부스 리허설용 (docs/05 Phase 6). 같은 PC(IP)에서 N명이 동시에 한 판을 도는 흐름을 흉내 낸다.

흐름(각 플레이어): 세션 생성 → 스테이지 1 시작 → 문제 3개 답변 → 이벤트 1개 → 종료.
요청 제한(IP 기준)에 걸리면 429 를 센다 — 부스에서는 모든 태블릿이 한 공인 IP 를 쓰므로 한도를 확인하는 용도.

사용:  backend/.venv/Scripts/python.exe scripts/smoke_concurrent.py --base http://localhost:8000/api/v1 --players 10
"""

from __future__ import annotations

import argparse
import statistics
import sys
import threading
import time
from collections import Counter

import httpx


def play(base: str, index: int, timeout: float, stats: dict, lock: threading.Lock) -> None:
    codes: Counter[int] = Counter()
    started = time.perf_counter()
    with httpx.Client(base_url=base, timeout=timeout) as client:
        res = client.post("/sessions", json={"nickname": f"테스터{index}"})
        codes[res.status_code] += 1
        if res.status_code != 201:
            _record(stats, lock, codes, time.perf_counter() - started, failed=True)
            return
        sid, token = res.json()["sessionId"], res.json()["token"]
        headers = {"X-Session-Token": token}

        start = client.post(
            f"/sessions/{sid}/stages/1/start", json={"retry": False}, headers=headers
        )
        codes[start.status_code] += 1
        batch = start.json().get("quizBatch", []) if start.status_code == 200 else []
        for item in batch[:3]:
            ans = client.post(
                f"/sessions/{sid}/quiz/answer",
                json={"quizId": item["quizId"], "choiceIndex": 0, "answeredMs": 4000, "wave": 1},
                headers=headers,
            )
            codes[ans.status_code] += 1
        ev = client.post(
            f"/sessions/{sid}/events",
            json={"type": "WAVE_CLEARED", "stageOrder": 1, "wave": 1, "at": "2026-10-01T00:00:00Z"},
            headers=headers,
        )
        codes[ev.status_code] += 1
        fin = client.post(
            f"/sessions/{sid}/finish",
            json={
                "stagesCleared": 0,
                "wavesCleared": 1,
                "livesLeftAtEnd": 10,
                "coinsLeftAtEnd": 50,
                "clientScore": 0,
            },
            headers=headers,
        )
        codes[fin.status_code] += 1
    _record(stats, lock, codes, time.perf_counter() - started, failed=False)


def _record(
    stats: dict, lock: threading.Lock, codes: Counter, elapsed: float, *, failed: bool
) -> None:
    with lock:
        stats["codes"].update(codes)
        stats["elapsed"].append(elapsed)
        if failed:
            stats["failed"] += 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--base", default="http://localhost:8000/api/v1")
    parser.add_argument("--players", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()

    stats: dict = {"codes": Counter(), "elapsed": [], "failed": 0}
    lock = threading.Lock()
    threads = [
        threading.Thread(target=play, args=(args.base, i, args.timeout, stats, lock))
        for i in range(args.players)
    ]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0

    codes = stats["codes"]
    print(f"플레이어 {args.players}명, 총 {wall:.1f}초, 요청 {sum(codes.values())}건")
    print("상태 코드:", dict(sorted(codes.items())))
    if stats["elapsed"]:
        print(
            f"플레이어당 소요: 중앙값 {statistics.median(stats['elapsed']):.2f}초, 최대 {max(stats['elapsed']):.2f}초"
        )
    rate_limited = codes.get(429, 0)
    if rate_limited:
        print(
            f"경고: 429(요청 제한) {rate_limited}건 — 같은 IP 의 동시 인원 대비 한도를 확인하세요(POST /sessions 30/분)."
        )
    errors = sum(v for k, v in codes.items() if k >= 500)
    if errors or stats["failed"]:
        print(f"실패: 5xx {errors}건, 세션 생성 실패 {stats['failed']}명")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
