"""
generator.py - Claude API を使った Threads 投稿文生成モジュール

使用モデル: claude-haiku-4-5（コスト効率重視）
APIキー: 環境変数 ANTHROPIC_API_KEY から取得
外部送信: なし（ローカルファイルへの書き込みのみ）
"""

from __future__ import annotations

import json
import os
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import anthropic

# ---------------------------------------------------------
# 定数
# ---------------------------------------------------------
MODEL_ID = "claude-haiku-4-5"
MAX_TOKENS = 512

# Threads の文字数上限（500文字）
THREADS_MAX_CHARS = 500

# NGワードリスト（業種に合わせて追加）
NG_WORDS: list[str] = [
    "絶対",
    "確実に儲かる",
    "必ず稼げる",
    "副業詐欺",
    "無限連鎖講",
    "ネズミ講",
]

# 重複判定用ログファイル
LOGS_DIR = Path(__file__).parent / ".logs"
DUPLICATE_LOG = LOGS_DIR / "generated_hashes.jsonl"

# サンプル保存先
SAMPLES_DIR = Path(__file__).parent / "samples"


# ---------------------------------------------------------
# プロンプトテンプレート
# ---------------------------------------------------------
SYSTEM_PROMPT = """あなたはSNSマーケティングの専門家です。
Threadsに投稿する、読者を引きつける集客向け投稿文を生成します。

## 制約
- 文字数: 500文字以内（必須）
- 改行を適度に使い、読みやすくする
- ハッシュタグは末尾にまとめて付ける
- 絵文字を効果的に使い、親しみやすいトーンにする
- 広告・宣伝感を出しすぎず、価値提供型のコンテンツにする

## 出力形式
投稿本文のみを出力してください。説明や補足は不要です。
"""


def _build_user_prompt(
    theme: str,
    tone: str,
    target: str,
    hashtag_policy: str,
    extra_instruction: str = "",
) -> str:
    """ユーザープロンプトを組み立てる"""
    parts = [
        f"テーマ: {theme}",
        f"トーン: {tone}",
        f"ターゲット: {target}",
        f"ハッシュタグ方針: {hashtag_policy}",
    ]
    if extra_instruction:
        parts.append(f"追加指示: {extra_instruction}")
    return "\n".join(parts)


# ---------------------------------------------------------
# 品質ガード
# ---------------------------------------------------------
def _check_length(text: str) -> tuple[bool, str]:
    """文字数チェック（500文字以内）"""
    length = len(text)
    if length > THREADS_MAX_CHARS:
        return False, f"文字数超過: {length}文字（上限 {THREADS_MAX_CHARS}文字）"
    return True, f"文字数OK: {length}文字"


def _check_ng_words(text: str) -> tuple[bool, str]:
    """NGワードチェック"""
    found = [w for w in NG_WORDS if w in text]
    if found:
        return False, f"NGワード検出: {', '.join(found)}"
    return True, "NGワードなし"


def _compute_hash(text: str) -> str:
    """投稿文のハッシュ値（重複判定用）"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _check_duplicate(text: str) -> tuple[bool, str]:
    """重複チェック（過去生成履歴と比較）"""
    LOGS_DIR.mkdir(exist_ok=True)
    h = _compute_hash(text)

    if DUPLICATE_LOG.exists():
        with DUPLICATE_LOG.open(encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                    if record.get("hash") == h:
                        return False, f"重複検出: hash={h} (生成日時: {record.get('created_at', '不明')})"
                except json.JSONDecodeError:
                    continue
    return True, "重複なし"


def _record_hash(text: str, metadata: dict) -> None:
    """生成ハッシュをログに追記"""
    LOGS_DIR.mkdir(exist_ok=True)
    record = {
        "hash": _compute_hash(text),
        "created_at": datetime.now(timezone.utc).isoformat(),
        **metadata,
    }
    with DUPLICATE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def quality_check(text: str) -> dict:
    """
    品質チェックをまとめて実施。
    戻り値: {"passed": bool, "checks": [...]}
    """
    checks = []
    all_passed = True

    for fn in [_check_length, _check_ng_words, _check_duplicate]:
        passed, message = fn(text)
        checks.append({"name": fn.__name__.lstrip("_"), "passed": passed, "message": message})
        if not passed:
            all_passed = False

    return {"passed": all_passed, "checks": checks}


# ---------------------------------------------------------
# 生成メイン関数
# ---------------------------------------------------------
def generate_post(
    theme: str,
    tone: str = "親しみやすく・カジュアル",
    target: str = "30代の働くビジネスパーソン",
    hashtag_policy: str = "3〜5個、テーマに関連するもの",
    extra_instruction: str = "",
    retry_on_fail: int = 2,
) -> dict:
    """
    Threads 投稿文を生成して品質チェック付きで返す。

    Parameters
    ----------
    theme            : 投稿テーマ
    tone             : 文体・トーン
    target           : ターゲット読者
    hashtag_policy   : ハッシュタグ方針
    extra_instruction: 追加指示（任意）
    retry_on_fail    : 品質チェック失敗時のリトライ回数

    Returns
    -------
    dict:
      - text        : 生成された投稿文
      - quality     : 品質チェック結果
      - status      : "draft" | "approved" | "rejected"
      - metadata    : 生成時メタデータ（モデル・トークン数など）
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "環境変数 ANTHROPIC_API_KEY が設定されていません。"
            " .env ファイルまたはシェルで設定してください。"
        )

    client = anthropic.Anthropic(api_key=api_key)
    user_prompt = _build_user_prompt(theme, tone, target, hashtag_policy, extra_instruction)

    last_result = None
    for attempt in range(1 + retry_on_fail):
        # ---- API 呼び出し ----
        response = client.messages.create(
            model=MODEL_ID,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ],
        )

        text = response.content[0].text.strip()
        quality = quality_check(text)

        metadata = {
            "model": MODEL_ID,
            "attempt": attempt + 1,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "theme": theme,
            "tone": tone,
            "target": target,
        }

        last_result = {
            "text": text,
            "quality": quality,
            "status": "draft",  # 承認待ち（人が最終確認）
            "metadata": metadata,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        if quality["passed"]:
            _record_hash(text, metadata)
            break
        # 品質NG → リトライ

    return last_result


# ---------------------------------------------------------
# サンプル生成（デモ用）
# ---------------------------------------------------------
def generate_samples(count: int = 10) -> list[dict]:
    """
    デモ用サンプルを複数生成してファイル保存する。
    実際の API キーがない場合はモックデータを返す。
    """
    sample_themes = [
        ("副業の始め方", "元気・背中を押す", "副業に興味のある会社員"),
        ("時間管理術", "落ち着いた・知的", "残業が多い30代"),
        ("フリーランス転身", "共感・体験談風", "独立を考えているサラリーマン"),
        ("朝活の習慣化", "爽やか・モーニングルーティン", "朝が苦手な人"),
        ("AI活用仕事術", "テンション高め・先進的", "IT に興味あるビジネスパーソン"),
        ("ミニマリスト生活", "穏やか・丁寧", "モノを減らしたい人"),
        ("読書習慣の作り方", "知的好奇心を刺激", "本を読みたいが続かない人"),
        ("副業月5万達成", "実績ベース・信頼感", "副業初心者"),
        ("ストレスフリーな働き方", "共感・癒し系", "仕事に疲れた人"),
        ("SNS集客の基本", "教育系・わかりやすく", "SNS運用を始めたい個人事業主"),
    ]

    results = []
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    for i, (theme, tone, target) in enumerate(sample_themes[:count]):
        if api_key:
            result = generate_post(theme=theme, tone=tone, target=target)
        else:
            # API キーなしのモックデータ
            result = _mock_post(i, theme, tone, target)

        result["sample_id"] = f"sample_{i+1:02d}"
        results.append(result)

        # ファイル保存
        SAMPLES_DIR.mkdir(exist_ok=True)
        out_path = SAMPLES_DIR / f"sample_{i+1:02d}.json"
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    return results


def _mock_post(idx: int, theme: str, tone: str, target: str) -> dict:
    """API キーなし時のモックデータ（デモ表示用）"""
    mock_texts = [
        "副業を始めたいけど何からすればいい？\n\n実は最初の一歩は「スキルの棚卸し」だけ✨\n今の仕事で得た経験、全部立派な武器になります。\n\nライター・デザイン・プログラミング・コーチング...\nどれも最初は0からスタートした人ばかり。\n\n大切なのは完璧なスキルより、まずやってみること！\n今日から一緒に始めましょう💪\n\n#副業 #副業初心者 #フリーランス #スキルアップ #働き方改革",
        "時間がない！が口癖になっていませんか？\n\nそれ、実は「時間の使い方」の問題かもしれません🕐\n\n✅ 朝30分のルーティン確立\n✅ スマホ通知をオフにする時間を作る\n✅ タスクを3つに絞る\n\nこれだけで、1日の生産性が劇的に変わります。\n残業が当たり前になっていた私が、定時退社できるようになった方法です。\n\n#時間管理 #生産性向上 #残業ゼロ #タスク管理 #仕事術",
    ]
    text = mock_texts[idx % len(mock_texts)]
    return {
        "text": text,
        "quality": {"passed": True, "checks": [
            {"name": "check_length", "passed": True, "message": f"文字数OK: {len(text)}文字"},
            {"name": "check_ng_words", "passed": True, "message": "NGワードなし"},
            {"name": "check_duplicate", "passed": True, "message": "重複なし"},
        ]},
        "status": "draft",
        "metadata": {
            "model": MODEL_ID + " (mock)",
            "attempt": 1,
            "input_tokens": 0,
            "output_tokens": 0,
            "theme": theme,
            "tone": tone,
            "target": target,
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    # 単体テスト実行
    print("=== generator.py 単体テスト ===")
    result = generate_post(
        theme="副業の始め方",
        tone="親しみやすく・背中を押す",
        target="副業に興味のある会社員",
        hashtag_policy="3〜5個",
    )
    print(f"生成文:\n{result['text']}\n")
    print(f"品質チェック: {result['quality']}")
    print(f"ステータス: {result['status']}")
