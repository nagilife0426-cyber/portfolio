"""
runner.py
---------
企業名リスト（CSV）を読み込み、スクレイピングを実行して結果CSVを出力する。

機能:
- 途中保存（progress.json）で中断再開が可能
- 1件ごとに results/output.csv へ追記
- 取得失敗・要確認分を results/manual_check.csv に分離
- ログを results/run.log に記録
- 処理件数・スコア別集計をコンソール表示

使用例:
    python runner.py --input companies.csv --col 企業名 --limit 10
    python runner.py --input companies.csv --col 0 --resume
"""

import argparse
import csv
import json
import logging
import os
import sys
import time
from pathlib import Path

import requests

# プロジェクト内モジュール
from scraper import get_company_html
from extractor import extract_from_html, ExtractedInfo

# ────────────────────────────────────────────────────────────────
# 定数
# ────────────────────────────────────────────────────────────────

RESULTS_DIR = Path(__file__).parent / "results"
OUTPUT_CSV = RESULTS_DIR / "output.csv"
MANUAL_CSV = RESULTS_DIR / "manual_check.csv"
PROGRESS_FILE = RESULTS_DIR / "progress.json"
LOG_FILE = RESULTS_DIR / "run.log"

CSV_HEADER = ["企業名", "郵便番号", "住所", "代表者名", "URL", "スコア", "備考"]


# ────────────────────────────────────────────────────────────────
# ロギング設定
# ────────────────────────────────────────────────────────────────

def setup_logging() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    fmt = "%(asctime)s [%(levelname)s] %(message)s"
    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ]
    logging.basicConfig(level=logging.INFO, format=fmt, handlers=handlers)


# ────────────────────────────────────────────────────────────────
# 進捗管理（再開用）
# ────────────────────────────────────────────────────────────────

def load_progress() -> set[str]:
    """処理済み企業名の集合を返す。"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return set(data.get("done", []))
    return set()


def save_progress(done: set[str]) -> None:
    """処理済み企業名を progress.json に保存する。"""
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump({"done": sorted(done)}, f, ensure_ascii=False, indent=2)


# ────────────────────────────────────────────────────────────────
# CSV 入出力
# ────────────────────────────────────────────────────────────────

def read_company_names(csv_path: str, col: str) -> list[str]:
    """
    入力CSVから企業名リストを読み込む。
    col が数値文字列の場合は列インデックスとして扱い、
    それ以外はヘッダ名として扱う。
    """
    names = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        # ヘッダあり・なし両対応
        sample = f.read(1024)
        f.seek(0)
        has_header = csv.Sniffer().has_header(sample)
        reader = csv.reader(f)

        if has_header:
            header = next(reader)
            # col が列インデックスか列名かを判定
            if col.isdigit():
                idx = int(col)
            else:
                try:
                    idx = header.index(col)
                except ValueError:
                    raise ValueError(
                        f"列名 '{col}' が見つかりません。"
                        f"ヘッダ: {header}"
                    )
        else:
            idx = int(col) if col.isdigit() else 0

        for row in reader:
            if row and len(row) > idx:
                name = row[idx].strip()
                if name:
                    names.append(name)

    return names


def append_result(path: Path, info: ExtractedInfo) -> None:
    """結果1件をCSVに追記する。"""
    write_header = not path.exists()
    with open(path, "a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADER)
        if write_header:
            writer.writeheader()
        writer.writerow(info.as_dict())


# ────────────────────────────────────────────────────────────────
# メイン処理
# ────────────────────────────────────────────────────────────────

def run(
    csv_path: str,
    col: str = "企業名",
    limit: Optional[int] = None,
    resume: bool = False,
    dry_run: bool = False,
) -> None:
    """
    メイン処理。企業名リストを読み込み、1件ずつスクレイピングして結果を保存する。

    Parameters
    ----------
    csv_path : 入力CSVパス
    col      : 企業名が入っている列名または列インデックス（文字列）
    limit    : 処理上限件数（デバッグ用）
    resume   : True のとき progress.json に記録済みの企業をスキップ
    dry_run  : True のとき実際のHTTPリクエストは行わずダミー結果を返す
    """
    setup_logging()
    logger = logging.getLogger(__name__)

    logger.info("=== 処理開始 ===")
    logger.info("入力: %s  列: %s  上限: %s  再開: %s", csv_path, col, limit, resume)

    companies = read_company_names(csv_path, col)
    logger.info("企業数: %d 件", len(companies))

    done = load_progress() if resume else set()
    if done:
        logger.info("再開: %d 件は処理済みのためスキップ", len(done))

    # requests セッションを使い回してパフォーマンス向上
    session = requests.Session() if not dry_run else None

    stats = {"完全": 0, "要確認": 0, "取得失敗": 0}
    processed = 0
    start_time = time.time()

    for i, company in enumerate(companies):
        if limit and processed >= limit:
            logger.info("上限 %d 件に達したので終了", limit)
            break

        if company in done:
            logger.debug("スキップ（処理済み）: %s", company)
            continue

        logger.info("[%d/%d] 処理中: %s", i + 1, len(companies), company)

        if dry_run:
            # ドライラン: 実際のHTTPアクセスなし（テスト用）
            info = ExtractedInfo(
                company_name=company,
                postal_code="000-0000",
                address="（ドライランダミー）",
                representative="（ドライランダミー）",
                source_url="",
                score="要確認",
                notes=["dry-run"],
            )
        else:
            try:
                html, url = get_company_html(company, session=session)
                if html:
                    info = extract_from_html(html, company_name=company, source_url=url)
                else:
                    info = ExtractedInfo(
                        company_name=company,
                        score="取得失敗",
                        notes=["HTMLの取得に失敗"],
                    )
            except Exception as e:
                logger.error("予期しないエラー [%s]: %s", company, e)
                info = ExtractedInfo(
                    company_name=company,
                    score="取得失敗",
                    notes=[f"エラー: {e}"],
                )

        # 結果を全件CSVに追記
        append_result(OUTPUT_CSV, info)
        # 要確認・失敗は別ファイルにも追記
        if info.score != "完全":
            append_result(MANUAL_CSV, info)

        stats[info.score] = stats.get(info.score, 0) + 1
        done.add(company)
        save_progress(done)
        processed += 1

        elapsed = time.time() - start_time
        avg = elapsed / processed
        remaining = (len(companies) - i - 1) * avg
        logger.info(
            "  → スコア: %s | 経過: %.0fs | 残り推定: %.0fs",
            info.score, elapsed, remaining,
        )

    # ── 最終サマリ ──
    elapsed_total = time.time() - start_time
    logger.info("=== 処理完了 ===")
    logger.info("処理件数: %d", processed)
    logger.info("  完全: %d件 / 要確認: %d件 / 取得失敗: %d件",
                stats["完全"], stats["要確認"], stats["取得失敗"])
    logger.info("総処理時間: %.1f 秒 (平均 %.1f 秒/件)", elapsed_total, elapsed_total / max(processed, 1))
    logger.info("出力: %s", OUTPUT_CSV)
    logger.info("要確認リスト: %s", MANUAL_CSV)


# ────────────────────────────────────────────────────────────────
# CLI エントリポイント
# ────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="企業名リストから郵便番号・住所・代表者名をスクレイピングして収集する"
    )
    parser.add_argument(
        "--input", "-i", required=True,
        help="入力CSVファイルパス（企業名リスト）",
    )
    parser.add_argument(
        "--col", "-c", default="企業名",
        help="企業名が入っている列名またはインデックス（デフォルト: 企業名）",
    )
    parser.add_argument(
        "--limit", "-n", type=int, default=None,
        help="処理上限件数（デバッグ用。省略時は全件）",
    )
    parser.add_argument(
        "--resume", "-r", action="store_true",
        help="前回の途中から再開する（progress.json を参照）",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="実際のHTTPアクセスなしで処理フローだけ確認する",
    )
    return parser.parse_args()


# 型アノテーションを遅延インポートで解決
from typing import Optional


if __name__ == "__main__":
    args = parse_args()
    run(
        csv_path=args.input,
        col=args.col,
        limit=args.limit,
        resume=args.resume,
        dry_run=args.dry_run,
    )
