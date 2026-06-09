"""
threads_client.py - Threads Graph API クライアント

実際の投稿は人の承認後のみ実行。
APIキー: 環境変数 THREADS_ACCESS_TOKEN / THREADS_USER_ID から取得
外部送信: 本番時のみ（デモモードでは実通信なし）
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import urllib.request
import urllib.parse
import urllib.error

# ---------------------------------------------------------
# 定数
# ---------------------------------------------------------
THREADS_API_BASE = "https://graph.threads.net/v1.0"

# ログ保存先
LOGS_DIR = Path(__file__).parent / ".logs"
POST_LOG = LOGS_DIR / "posted.jsonl"


# ---------------------------------------------------------
# Threads Graph API クライアント
# ---------------------------------------------------------
class ThreadsClient:
    """
    Threads Graph API への投稿クライアント。

    デモモード（DRY_RUN=True）では実際の通信は行わず、
    ログファイルへの書き込みのみ実施。
    """

    def __init__(self, dry_run: bool = True):
        """
        Parameters
        ----------
        dry_run : True の場合はAPI呼び出しを行わずログのみ記録（デフォルト: True）
        """
        self.dry_run = dry_run
        self.access_token = os.environ.get("THREADS_ACCESS_TOKEN", "")
        self.user_id = os.environ.get("THREADS_USER_ID", "")
        LOGS_DIR.mkdir(exist_ok=True)

        if not dry_run and (not self.access_token or not self.user_id):
            raise EnvironmentError(
                "本番モードには環境変数 THREADS_ACCESS_TOKEN と "
                "THREADS_USER_ID が必要です。"
            )

    # --------------------------------------------------
    # 公開メソッド
    # --------------------------------------------------
    def post(self, text: str, image_url: Optional[str] = None) -> dict:
        """
        テキスト（任意で画像付き）を Threads に投稿する。

        Parameters
        ----------
        text      : 投稿本文
        image_url : 画像URL（任意）

        Returns
        -------
        dict: {"success": bool, "post_id": str|None, "error": str|None}
        """
        if self.dry_run:
            return self._dry_run_post(text, image_url)

        try:
            # Step 1: メディアコンテナを作成
            container_id = self._create_container(text, image_url)

            # Step 2: 公開（コンテナ作成後に少し待機）
            time.sleep(2)
            post_id = self._publish_container(container_id)

            result = {
                "success": True,
                "post_id": post_id,
                "error": None,
                "posted_at": datetime.now(timezone.utc).isoformat(),
            }
            self._log_post(text, result)
            return result

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            result = {
                "success": False,
                "post_id": None,
                "error": f"HTTP {e.code}: {body}",
                "posted_at": None,
            }
            self._log_post(text, result)
            return result
        except Exception as e:
            result = {
                "success": False,
                "post_id": None,
                "error": str(e),
                "posted_at": None,
            }
            self._log_post(text, result)
            return result

    def get_posts(self, limit: int = 10) -> list[dict]:
        """
        投稿済み一覧を返す（ドライランでも過去ログから返せる）。
        """
        posts = []
        if POST_LOG.exists():
            with POST_LOG.open(encoding="utf-8") as f:
                for line in f:
                    try:
                        posts.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return posts[-limit:]

    # --------------------------------------------------
    # 内部メソッド
    # --------------------------------------------------
    def _create_container(self, text: str, image_url: Optional[str]) -> str:
        """Step 1: Threads メディアコンテナを作成して container_id を返す"""
        endpoint = f"{THREADS_API_BASE}/{self.user_id}/threads"
        params: dict = {
            "access_token": self.access_token,
            "text": text,
        }
        if image_url:
            params["media_type"] = "IMAGE"
            params["image_url"] = image_url
        else:
            params["media_type"] = "TEXT"

        data = urllib.parse.urlencode(params).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, method="POST")
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["id"]

    def _publish_container(self, container_id: str) -> str:
        """Step 2: コンテナを公開して post_id を返す"""
        endpoint = f"{THREADS_API_BASE}/{self.user_id}/threads_publish"
        params = {
            "access_token": self.access_token,
            "creation_id": container_id,
        }
        data = urllib.parse.urlencode(params).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, method="POST")
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["id"]

    def _dry_run_post(self, text: str, image_url: Optional[str]) -> dict:
        """ドライラン: ログ書き込みのみで実API呼び出しなし"""
        dummy_id = f"dry_{int(time.time())}"
        result = {
            "success": True,
            "post_id": dummy_id,
            "error": None,
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "dry_run": True,
        }
        self._log_post(text, result, image_url)
        return result

    def _log_post(
        self,
        text: str,
        result: dict,
        image_url: Optional[str] = None,
    ) -> None:
        """投稿結果をログファイルに追記"""
        record = {
            "text_preview": text[:50] + "..." if len(text) > 50 else text,
            "image_url": image_url,
            **result,
        }
        LOGS_DIR.mkdir(exist_ok=True)
        with POST_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ---------------------------------------------------------
# エントリーポイント（単体テスト）
# ---------------------------------------------------------
if __name__ == "__main__":
    print("=== threads_client.py 単体テスト（ドライラン） ===")
    client = ThreadsClient(dry_run=True)
    result = client.post(
        text="これはテスト投稿です。Threads API デモ動作確認 #テスト",
    )
    print(f"結果: {result}")
    print(f"ログ保存先: {POST_LOG}")
