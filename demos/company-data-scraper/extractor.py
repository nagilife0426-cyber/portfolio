"""
extractor.py
------------
HTMLテキストから「郵便番号・住所・代表者名」を抽出するロジック。
正規表現＋ヒューリスティックで表記ゆれに対応。
実在サイトへのアクセスはしない。入力はHTMLテキスト（文字列）のみ。
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup


# ────────────────────────────────────────────────────────────────
# 抽出結果のデータクラス
# ────────────────────────────────────────────────────────────────

@dataclass
class ExtractedInfo:
    """1社分の抽出結果。"""
    company_name: str = ""
    postal_code: Optional[str] = None   # 例: "123-4567"
    address: Optional[str] = None       # 例: "東京都千代田区丸の内1-1-1"
    representative: Optional[str] = None  # 例: "山田 太郎"
    source_url: str = ""
    score: str = "不明"                  # "完全" | "要確認" | "取得失敗"
    notes: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "企業名": self.company_name,
            "郵便番号": self.postal_code or "",
            "住所": self.address or "",
            "代表者名": self.representative or "",
            "URL": self.source_url,
            "スコア": self.score,
            "備考": " / ".join(self.notes),
        }


# ────────────────────────────────────────────────────────────────
# 郵便番号の抽出
# ────────────────────────────────────────────────────────────────

# 〒付き郵便番号（優先パターン）: 〒123-4567
_POSTAL_WITH_KIGOU = re.compile(
    r"〒\s*(\d{3})\s*[-－‐‑−]\s*(\d{4})"
)
# 〒なし郵便番号（フォールバック）: 123-4567
# 電話番号（03-1234-5678 等）との誤認を減らすため、
# 直前にスペース・改行・「:」「：」等があるケースに限定し、
# 直後が行末 or スペース or 非数字になるものにマッチ
_POSTAL_WITHOUT_KIGOU = re.compile(
    r"(?:^|[\s:：,、\n])(\d{3})\s*[-－‐‑−]\s*(\d{4})(?=\s|$|[^\d])"
)

def extract_postal_code(text: str) -> Optional[str]:
    """
    テキストから郵便番号を抽出する。
    優先順位: 〒付き → 〒なし（文脈限定）。
    最初にヒットしたものを返す（複数ある場合は住所ラベル近傍を優先するため
    `extract_from_html` 側でコンテキストを絞ってから呼ぶこと）。
    """
    # 1. 〒付きを優先
    m = _POSTAL_WITH_KIGOU.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # 2. 〒なし（誤認リスクがあるので文脈を絞る）
    m = _POSTAL_WITHOUT_KIGOU.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return None


# ────────────────────────────────────────────────────────────────
# 住所の抽出
# ────────────────────────────────────────────────────────────────

# 都道府県で始まり、最低でも市区町村＋番地らしい文字列を取り込む
_PREF_PATTERN = re.compile(
    r"((?:北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京都|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都府|大阪府|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)[都道府県]?)"
    r"(?:.*?)"
    r"(\d+[-－‐‑−号棟丁目番地\d\s・&A-Za-z]*)+"
)

# ビル名まで含めた幅広いパターン（都道府県起点）
_ADDRESS_LONG_PATTERN = re.compile(
    r"((?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県"
    r"|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県"
    r"|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県"
    r"|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県"
    r"|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)"
    r"[^\r\n<]{5,80})"
)

def extract_address(text: str) -> Optional[str]:
    """都道府県を起点に住所らしい文字列を抽出する。"""
    m = _ADDRESS_LONG_PATTERN.search(text)
    if m:
        addr = m.group(1).strip()
        # 末尾に余分なHTMLエンティティ等が残っていれば除去
        addr = re.sub(r"\s{2,}", " ", addr)
        return addr
    return None


# ────────────────────────────────────────────────────────────────
# 代表者名の抽出
# ────────────────────────────────────────────────────────────────

# ラベルのバリエーション
_REP_LABELS = (
    r"(?:代表取締役(?:社長|CEO|会長|副社長)?|代表者|代表|取締役社長"
    r"|社長|CEO|Chief Executive Officer|代表取締役(?:兼)?)"
)

# ラベルの直後（コロン・スペース・HTMLタグを挟む）に続く氏名候補
# 氏名は漢字・ひらがな・カタカナ・英字・スペースで2〜20文字
_NAME_CHARS = r"[^\S\r\n]*[:：]?[^\S\r\n]*([一-龯ぁ-んァ-ヶa-zA-Z\s]{2,20})"

_REP_PATTERN = re.compile(
    _REP_LABELS + _NAME_CHARS
)

# 「氏名 / 役職」順の表（th=役職、td=氏名）に対応するフォールバック
_REP_TABLE_LABEL = re.compile(_REP_LABELS)

def extract_representative(html: str, soup: BeautifulSoup) -> Optional[str]:
    """
    代表者名を抽出する。
    優先順位:
    1. 平文テキスト中の「代表取締役 山田太郎」パターン
    2. <table>の th/td ペアで役職ラベル→隣接セルの氏名
    3. dl/dt/dd 形式の定義リスト
    """
    # --- 1. 平文パターン ---
    # BeautifulSoupでタグを除去したテキストで検索
    plain = soup.get_text(separator="\n")
    m = _REP_PATTERN.search(plain)
    if m:
        name = m.group(1).strip()
        if _is_valid_name(name):
            return name

    # --- 2. table の th→td ---
    for th in soup.find_all(["th", "dt"]):
        if _REP_TABLE_LABEL.search(th.get_text()):
            # 同行の td / 次の dd
            sibling = th.find_next_sibling(["td", "dd"])
            if sibling:
                name = sibling.get_text(separator=" ").strip()
                name = re.sub(r"\s+", " ", name)
                if _is_valid_name(name):
                    return name

    # --- 3. dl/dt/dd ---
    for dt in soup.find_all("dt"):
        if _REP_TABLE_LABEL.search(dt.get_text()):
            dd = dt.find_next_sibling("dd")
            if dd:
                name = dd.get_text(separator=" ").strip()
                name = re.sub(r"\s+", " ", name)
                if _is_valid_name(name):
                    return name

    return None


def _is_valid_name(name: str) -> bool:
    """
    抽出した文字列が「人名らしいか」を簡易チェック。
    - 長すぎる（> 20文字）→NG
    - 住所・会社名の典型ワードを含む→NG
    - 数字だけ→NG
    """
    if not name or len(name) > 20:
        return False
    noise_patterns = re.compile(
        r"(?:株式会社|有限会社|合同会社|都|道|府|県|市|区|町|村|番地|号室|\d{3}-|\d{4})"
    )
    if noise_patterns.search(name):
        return False
    if re.match(r"^\d+$", name):
        return False
    return True


# ────────────────────────────────────────────────────────────────
# メイン抽出関数
# ────────────────────────────────────────────────────────────────

def extract_from_html(
    html: str,
    company_name: str = "",
    source_url: str = "",
) -> ExtractedInfo:
    """
    HTMLテキストから郵便番号・住所・代表者名を抽出して ExtractedInfo を返す。

    Parameters
    ----------
    html         : ページのHTML文字列
    company_name : 企業名（結果に付与するだけ）
    source_url   : 取得元URL（結果に付与するだけ）

    Returns
    -------
    ExtractedInfo
    """
    soup = BeautifulSoup(html, "html.parser")

    # スクリプト・スタイルを除去してノイズを減らす
    for tag in soup(["script", "style", "noscript", "meta"]):
        tag.decompose()

    plain_text = soup.get_text(separator="\n")

    # ── 郵便番号 ──
    # まず住所ラベル近傍のテキストブロックだけを優先検索
    postal = _extract_postal_near_address_label(soup) or extract_postal_code(plain_text)

    # ── 住所 ──
    address = _extract_address_near_label(soup) or extract_address(plain_text)

    # 郵便番号と住所が両方取れている場合、住所の先頭に郵便番号が入っていたら除去
    if postal and address:
        address = re.sub(r"^〒?\s*\d{3}[-－]\d{4}\s*", "", address).strip()

    # ── 代表者名 ──
    representative = extract_representative(html, soup)

    # ── スコア計算 ──
    info = ExtractedInfo(
        company_name=company_name,
        postal_code=postal,
        address=address,
        representative=representative,
        source_url=source_url,
    )
    info.score = _calc_score(info)
    return info


def _extract_postal_near_address_label(soup: BeautifulSoup) -> Optional[str]:
    """
    「所在地」「住所」「本社」などのラベル要素の近傍テキストから郵便番号を取る。
    テーブルセルや dl/dt/dd パターンに対応。
    """
    address_labels = re.compile(r"(?:所在地|住\s*所|本\s*社|本店|アクセス|お問[い合合]せ先)")
    for elem in soup.find_all(["th", "dt", "td", "li", "p", "div", "span"]):
        if address_labels.search(elem.get_text()):
            # 同じブロックかその近傍テキスト全体を取る
            context = elem.get_text(separator="\n")
            sibling = elem.find_next_sibling()
            if sibling:
                context += "\n" + sibling.get_text(separator="\n")
            parent = elem.parent
            if parent:
                context += "\n" + parent.get_text(separator="\n")
            code = extract_postal_code(context)
            if code:
                return code
    return None


def _extract_address_near_label(soup: BeautifulSoup) -> Optional[str]:
    """
    住所ラベル近傍から住所を取る。テーブル th→td / dl dt→dd に対応。
    """
    address_labels = re.compile(r"(?:所在地|住\s*所|本\s*社|本店)")
    for elem in soup.find_all(["th", "dt"]):
        if address_labels.search(elem.get_text()):
            sibling = elem.find_next_sibling(["td", "dd"])
            if sibling:
                text = sibling.get_text(separator=" ").strip()
                text = re.sub(r"\s+", " ", text)
                addr = extract_address(text)
                if addr:
                    return addr
                # 都道府県が取れなくてもラベル隣なら採用
                if len(text) > 5:
                    # 郵便番号部分だけ除去して返す
                    text = re.sub(r"〒?\s*\d{3}[-－]\d{4}\s*", "", text).strip()
                    if text:
                        return text
    return None


def _calc_score(info: ExtractedInfo) -> str:
    """
    抽出結果の信頼度スコアを返す。
    - 全項目揃い → "完全"
    - 1〜2項目  → "要確認"
    - 0項目     → "取得失敗"
    """
    filled = sum([
        info.postal_code is not None,
        info.address is not None,
        info.representative is not None,
    ])
    if filled == 3:
        return "完全"
    elif filled >= 1:
        return "要確認"
    else:
        return "取得失敗"
