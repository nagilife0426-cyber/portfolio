"""
main.py - メインエントリーポイント

生成 → 品質チェック → 下書き保存 → 人の承認 → 投稿 という
フルフローをコマンドラインから操作できる。

使い方:
  python3 main.py generate --theme "副業の始め方" --tone "親しみやすく"
  python3 main.py list
  python3 main.py approve <id>
  python3 main.py post-approved     # 承認済みをまとめて投稿
  python3 main.py samples           # サンプル10件生成（APIキー不要でモック動作）
  python3 main.py status            # スケジュール全件表示

オプション:
  --dry-run   実際のThreads API呼び出しなし（デフォルト: True）
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from generator import generate_post, generate_samples
from threads_client import ThreadsClient
from scheduler import Scheduler


# ---------------------------------------------------------
# カラー出力ユーティリティ（ANSI）
# ---------------------------------------------------------
def _ok(msg: str) -> str:
    return f"\033[32m{msg}\033[0m"

def _warn(msg: str) -> str:
    return f"\033[33m{msg}\033[0m"

def _err(msg: str) -> str:
    return f"\033[31m{msg}\033[0m"

def _bold(msg: str) -> str:
    return f"\033[1m{msg}\033[0m"


# ---------------------------------------------------------
# サブコマンド実装
# ---------------------------------------------------------
def cmd_generate(args: argparse.Namespace, sched: Scheduler) -> None:
    """投稿文を生成して下書きに追加する"""
    print(_bold("=== 投稿文を生成中... ==="))

    result = generate_post(
        theme=args.theme,
        tone=args.tone,
        target=args.target,
        hashtag_policy=args.hashtag_policy,
        extra_instruction=args.extra or "",
    )

    print(f"\n--- 生成結果 ---")
    print(result["text"])
    print(f"\n文字数: {len(result['text'])} / 500")

    quality = result["quality"]
    if quality["passed"]:
        print(_ok("品質チェック: OK"))
    else:
        print(_warn("品質チェック: NG"))
        for check in quality["checks"]:
            if not check["passed"]:
                print(f"  - {check['name']}: {check['message']}")

    # 下書きに追加
    entry = sched.add_draft(
        text=result["text"],
        metadata=result.get("metadata", {}),
    )
    print(f"\n{_ok('下書きに追加しました')} ID: {_bold(entry['id'])}")
    print(f"投稿予定: {entry['scheduled_at']}")
    print(f"\n承認コマンド: python3 main.py approve {entry['id']}")


def cmd_list(args: argparse.Namespace, sched: Scheduler) -> None:
    """全下書きを一覧表示"""
    entries = sched.get_all(status=args.status if hasattr(args, 'status') else None)

    if not entries:
        print("（データなし）")
        return

    print(_bold(f"=== スケジュール一覧 ({len(entries)} 件) ===\n"))
    for e in entries:
        status_label = {
            "pending": _warn("承認待"),
            "approved": _ok("承認済"),
            "posted": "\033[34m投稿済\033[0m",
            "cancelled": "\033[90m却下\033[0m",
        }.get(e["status"], e["status"])

        print(f"[{e['id']}] {status_label} | {e['scheduled_at'][:16]}")
        preview = e["text"][:60].replace("\n", " ")
        print(f"  {preview}...")
        print()


def cmd_approve(args: argparse.Namespace, sched: Scheduler) -> None:
    """指定 ID の下書きを承認する"""
    try:
        entry = sched.approve(args.id)
        print(_ok(f"承認しました: {entry['id']}"))
        print(f"投稿予定: {entry['scheduled_at']}")
    except KeyError as e:
        print(_err(str(e)))
        sys.exit(1)


def cmd_reject(args: argparse.Namespace, sched: Scheduler) -> None:
    """指定 ID の下書きを却下する"""
    try:
        entry = sched.reject(args.id)
        print(_warn(f"却下しました: {entry['id']}"))
    except KeyError as e:
        print(_err(str(e)))
        sys.exit(1)


def cmd_post_approved(args: argparse.Namespace, sched: Scheduler, client: ThreadsClient) -> None:
    """承認済みで投稿時刻が来た投稿をすべて投稿する"""
    # 投稿ルールチェック
    rules = sched.check_posting_rules()
    if not rules["can_post"]:
        print(_warn(f"投稿スキップ: {rules['reason']}"))
        return

    approved = sched.get_approved()
    if not approved:
        print("投稿対象の承認済みエントリがありません")
        return

    print(_bold(f"=== 承認済み投稿を実行 ({len(approved)} 件) ==="))
    for entry in approved:
        print(f"\n投稿: {entry['id']}")
        print(f"  {entry['text'][:60]}...")

        result = client.post(text=entry["text"], image_url=entry.get("image_url"))

        if result["success"]:
            sched.mark_posted(entry["id"])
            label = "(ドライラン)" if result.get("dry_run") else ""
            print(_ok(f"  投稿完了 {label} post_id={result['post_id']}"))
        else:
            print(_err(f"  投稿失敗: {result['error']}"))


def cmd_samples(args: argparse.Namespace) -> None:
    """サンプル投稿10件を生成してファイル保存"""
    print(_bold("=== サンプル生成中... ==="))
    results = generate_samples(count=10)
    print(f"\n{_ok(f'{len(results)} 件のサンプルを生成しました')}")

    samples_dir = Path(__file__).parent / "samples"
    print(f"保存先: {samples_dir}/")

    for r in results:
        sid = r.get("sample_id", "?")
        passed = _ok("OK") if r["quality"]["passed"] else _warn("NG")
        chars = len(r["text"])
        print(f"  {sid}: {passed} {chars}文字 | {r['metadata']['theme']}")


def cmd_status(args: argparse.Namespace, sched: Scheduler) -> None:
    """現在のスケジュール状況とルールを表示"""
    print(_bold("=== 現在のステータス ===\n"))

    rules = sched.check_posting_rules()
    label = _ok("投稿可") if rules["can_post"] else _warn("投稿不可")
    print(f"投稿可否: {label} ({rules['reason']})")
    print(f"本日の投稿済み: {sched.today_posted_count()} / 3 件")

    entries = sched.get_all()
    counts = {"pending": 0, "approved": 0, "posted": 0, "cancelled": 0}
    for e in entries:
        counts[e.get("status", "pending")] = counts.get(e.get("status", "pending"), 0) + 1

    print(f"\nスケジュール件数:")
    print(f"  承認待ち: {counts['pending']} 件")
    print(f"  承認済み: {counts['approved']} 件")
    print(f"  投稿済み: {counts['posted']} 件")
    print(f"  却下済み: {counts['cancelled']} 件")


# ---------------------------------------------------------
# CLI パーサー
# ---------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Threads 自動投稿ツール（Claude API + Threads Graph API）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Threads への実際の投稿をスキップ（デフォルト: True）",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # generate
    gen = sub.add_parser("generate", help="投稿文を生成して下書きに追加")
    gen.add_argument("--theme", required=True, help="投稿テーマ")
    gen.add_argument("--tone", default="親しみやすく・カジュアル", help="文体・トーン")
    gen.add_argument("--target", default="30代の働くビジネスパーソン", help="ターゲット読者")
    gen.add_argument("--hashtag-policy", default="3〜5個", dest="hashtag_policy", help="ハッシュタグ方針")
    gen.add_argument("--extra", help="追加指示（任意）")

    # list
    ls = sub.add_parser("list", help="下書き一覧を表示")
    ls.add_argument("--status", choices=["pending", "approved", "posted", "cancelled"], help="ステータスで絞り込み")

    # approve
    apv = sub.add_parser("approve", help="指定 ID の下書きを承認")
    apv.add_argument("id", help="承認するエントリ ID")

    # reject
    rej = sub.add_parser("reject", help="指定 ID の下書きを却下")
    rej.add_argument("id", help="却下するエントリ ID")

    # post-approved
    sub.add_parser("post-approved", help="承認済みの投稿を実行")

    # samples
    sub.add_parser("samples", help="サンプル投稿10件を生成（APIキー不要でモック動作）")

    # status
    sub.add_parser("status", help="スケジュール状況を表示")

    return parser


# ---------------------------------------------------------
# メイン
# ---------------------------------------------------------
def main():
    parser = build_parser()
    args = parser.parse_args()

    sched = Scheduler()
    client = ThreadsClient(dry_run=args.dry_run if hasattr(args, "dry_run") else True)

    dispatch = {
        "generate": lambda: cmd_generate(args, sched),
        "list": lambda: cmd_list(args, sched),
        "approve": lambda: cmd_approve(args, sched),
        "reject": lambda: cmd_reject(args, sched),
        "post-approved": lambda: cmd_post_approved(args, sched, client),
        "samples": lambda: cmd_samples(args),
        "status": lambda: cmd_status(args, sched),
    }

    handler = dispatch.get(args.command)
    if handler:
        handler()
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
