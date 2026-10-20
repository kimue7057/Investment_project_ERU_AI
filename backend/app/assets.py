"""내부 자산 키와 사용자에게 보여주는 가명. 실제 식별자와 연결하지 않는다."""
import re

ASSET_NAMES = {"A": "새벽코인", "B": "물결코인", "C": "산들코인", "D": "노을코인"}


def display_names(text):
    text = text.replace("코인 A~D", "네 가지 코인").replace("코인 A/B/C/D", "네 가지 코인")
    text = re.sub(r"코인\s*([ABCD])(?![A-Za-z])", lambda m: ASSET_NAMES[m[1]], text)
    return re.sub(r"(?<![A-Za-z])([ABCD])(?![A-Za-z])", lambda m: ASSET_NAMES[m[1]], text)
