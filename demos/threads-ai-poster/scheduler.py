"""
scheduler.py - スケジュール投稿管理モジュール

投稿の予約・時間帯制御・下書き管理を担当。
外部送信: なし（ローカルファイルのみ）
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------
# 定数
# ---------------------------------------------------------
SCHEDULE_FILE = Path(__file__).parent / ".logs" / "schedule.jsonl"
LOGS_DIR = Path(__file__).parent / ".logs"

# 投稿可能な時間帯（JST時間: 7-22時）
ALLOWED_HOURS_JST = list(range(7, 23))

# 1日の最大投稿数
MAX_POSTS_PER_DAY = 3

# 投稿間隔（最低 n 時間）
MIN_INTERVAL_HOURS = 4


# ---------------------------------------------------------
# スケジュールエントリの構造
# ---------------------------------------------------------
# {
#   "id": str (uuid),
#   "text": str,
#   "image_url": str | null,
#   "scheduled_at": str (ISO8601 UTC),
#   "status": "pending" | "approved" | "posted" | "cancelled",
#   "created_at": str,
#   "posted_at": str | null,
#   "metadata": dict,
# }


# ---------------------------------------------------------
# スケジューラークラス
# ---------------------------------------------------------
class Scheduler:
    """下書き管理・スケジュール投稿クラス"""

    def __init__(self):
        LOGS_DIR.mkdir(exist_ok=True)

    # --------------------------------------------------
    # 登録・更新
    # --------------------------------------------------
    def add_draft(
        self,
        text: str,
        scheduled_at: Optional[datetime] = None,
        image_url: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        投稿を下書きとしてスケジュールに追加する。

        Parameters
        ----------
        text         : 投稿本文
        scheduled_at : 投稿予定日時（UTC）。None の場合は次の推奨時間を自動設定
        image_url    : 画像URL（任意）
        metadata     : 生成メタデータ（任意）

        Returns
        -------
        dict: 追加したエントリ
        """
        if scheduled_at is None:
            scheduled_at = self._next_recommended_slot()

        entry = {
            "id": str(uuid.uuid4())[:8],
            "text": text,
            "image_url": image_url,
            "scheduled_at": scheduled_at.isoformat(),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "posted_at": None,
            "metadata": metadata or {},
        }
        self._append(entry)
        return entry

    def approve(self, entry_id: str) -> dict:
        """指定 ID の下書きを承認済みに変更する"""
        return self._update_status(entry_id, "approved")

    def reject(self, entry_id: str) -> dict:
        """指定 ID の下書きをキャンセル（却下）する"""
        return self._update_status(entry_id, "cancelled")

    def mark_posted(self, entry_id: str) -> dict:
        """投稿完了をマークする"""
        entries = self._load_all()
        updated = None
        for e in entries:
            if e["id"] == entry_id:
                e["status"] = "posted"
                e["posted_at"] = datetime.now(timezone.utc).isoformat()
                updated = e
        if updated is None:
            raise KeyError(f"エントリ ID '{entry_id}' が見つかりません")
        self._save_all(entries)
        return updated

    # --------------------------------------------------
    # 取得
    # --------------------------------------------------
    def get_pending(self) -> list[dict]:
        """承認待ち（pending）の投稿一覧を返す"""
        return [e for e in self._load_all() if e["status"] == "pending"]

    def get_approved(self) -> list[dict]:
        """承認済み（approved）で未投稿の投稿を投稿時刻順に返す"""
        now = datetime.now(timezone.utc)
        approved = [
            e for e in self._load_all()
            if e["status"] == "approved" and _parse_dt(e["scheduled_at"]) <= now
        ]
        return sorted(approved, key=lambda e: e["scheduled_at"])

    def get_all(self, status: Optional[str] = None) -> list[dict]:
        """全エントリを返す（status で絞り込み可能）"""
        entries = self._load_all()
        if status:
            entries = [e for e in entries if e["status"] == status]
        return sorted(entries, key=lambda e: e.get("scheduled_at", ""))

    def today_posted_count(self) -> int:
        """今日の投稿済み数を返す"""
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(
            1 for e in self._load_all()
            if e["status"] == "posted"
            and (e.get("posted_at") or "").startswith(today_str)
        )

    # --------------------------------------------------
    # 時間帯制御
    # --------------------------------------------------
    def _next_recommended_slot(self) -> datetime:
        """
        次に投稿すべき推奨時間枠を計算。
        - 許可時間帯（7-22時 JST）
        - 直近投稿から最低 MIN_INTERVAL_HOURS 時間後
        - 本日上限 MAX_POSTS_PER_DAY 以内
        """
        JST = timezone(timedelta(hours=9))
        now_jst = datetime.now(JST)

        # 最後の投稿時刻を取得
        entries = self._load_all()
        posted_times = sorted([
            _parse_dt(e["scheduled_at"])
            for e in entries
            if e["status"] in ("pending", "approved", "posted")
        ])

        # 最低インターバル後の時刻
        if posted_times:
            last = posted_times[-1].astimezone(JST)
            candidate = last + timedelta(hours=MIN_INTERVAL_HOURS)
        else:
            candidate = now_jst + timedelta(hours=1)

        # 許可時間帯に収める（JST 7-22時）
        if candidate.hour < ALLOWED_HOURS_JST[0]:
            candidate = candidate.replace(
                hour=ALLOWED_HOURS_JST[0], minute=0, second=0, microsecond=0
            )
        elif candidate.hour > ALLOWED_HOURS_JST[-1]:
            # 翌朝 7 時にずらす
            candidate = (candidate + timedelta(days=1)).replace(
                hour=ALLOWED_HOURS_JST[0], minute=0, second=0, microsecond=0
            )

        return candidate.astimezone(timezone.utc)

    def check_posting_rules(self) -> dict:
        """
        現時点で投稿可能かどうかチェック。
        戻り値: {"can_post": bool, "reason": str}
        """
        JST = timezone(timedelta(hours=9))
        now_jst = datetime.now(JST)

        if now_jst.hour not in ALLOWED_HOURS_JST:
            return {"can_post": False, "reason": f"投稿禁止時間帯（JST {now_jst.hour}時）"}

        count = self.today_posted_count()
        if count >= MAX_POSTS_PER_DAY:
            return {"can_post": False, "reason": f"本日の上限({MAX_POSTS_PER_DAY}件)に達しています"}

        return {"can_post": True, "reason": "投稿可能"}

    # --------------------------------------------------
    # ファイル I/O（内部）
    # --------------------------------------------------
    def _load_all(self) -> list[dict]:
        if not SCHEDULE_FILE.exists():
            return []
        entries = []
        with SCHEDULE_FILE.open(encoding="utf-8") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return entries

    def _save_all(self, entries: list[dict]) -> None:
        with SCHEDULE_FILE.open("w", encoding="utf-8") as f:
            for e in entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")

    def _append(self, entry: dict) -> None:
        SCHEDULE_FILE.parent.mkdir(exist_ok=True)
        with SCHEDULE_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _update_status(self, entry_id: str, new_status: str) -> dict:
        entries = self._load_all()
        updated = None
        for e in entries:
            if e["id"] == entry_id:
                e["status"] = new_status
                updated = e
        if updated is None:
            raise KeyError(f"エントリ ID '{entry_id}' が見つかりません")
        self._save_all(entries)
        return updated


# ---------------------------------------------------------
# ユーティリティ
# ---------------------------------------------------------
def _parse_dt(s: str) -> datetime:
    """ISO8601 文字列を datetime(UTC) に変換"""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------
# 単体テスト
# ---------------------------------------------------------
if __name__ == "__main__":
    print("=== scheduler.py 単体テスト ===")
    sched = Scheduler()

    # 下書き追加
    entry = sched.add_draft(
        text="テスト投稿：スケジューラー動作確認 #テスト",
        metadata={"theme": "テスト"},
    )
    print(f"追加: {entry}")

    # 承認
    approved = sched.approve(entry["id"])
    print(f"承認: {approved}")

    # 投稿可否チェック
    rules = sched.check_posting_rules()
    print(f"投稿ルールチェック: {rules}")

    # 承認済み一覧
    approved_list = sched.get_approved()
    print(f"承認済み件数: {len(approved_list)}")
