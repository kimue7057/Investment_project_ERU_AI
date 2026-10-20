"""내부 자산 키와 사용자에게 보여주는 가명. 실제 식별자와 연결하지 않는다."""
import re

ASSET_NAMES = {"A": "Asterra", "B": "Velora", "C": "Nexora", "D": "Lumera"}
LEGACY_NAMES = dict(zip(("새벽코인", "물결코인", "산들코인", "노을코인"), ASSET_NAMES.values()))


def display_names(text):
    for old, name in LEGACY_NAMES.items():
        particles = {"은": "는", "이": "가", "을": "를", "과": "와", "으로": "로"}
        text = re.sub(re.escape(old) + r"(으로|은|이|을|과)(?=$|[\s.,!?·:;])",
                      lambda m: name + particles[m[1]], text)
        text = text.replace(old, name)
    text = text.replace("코인 A~D", "네 가지 코인").replace("코인 A/B/C/D", "네 가지 코인")
    text = re.sub(r"코인\s*([ABCD])(?![A-Za-z])", lambda m: ASSET_NAMES[m[1]], text)
    return re.sub(r"(?<![A-Za-z])([ABCD])(?![A-Za-z])", lambda m: ASSET_NAMES[m[1]], text)
