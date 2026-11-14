"""의존성 없는 HTML 한 파일로 묶는다. 원본 디자인 자료나 운영 앱은 수정하지 않는다."""
from pathlib import Path
import base64

root = Path(__file__).resolve().parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "styles.css").read_text(encoding="utf-8")
js = (root / "app.js").read_text(encoding="utf-8")
logo = "data:image/webp;base64," + base64.b64encode((root / "assets/riskguard-logo.webp").read_bytes()).decode()
html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + js + "\n</script>")
html = html.replace("assets/riskguard-logo.webp", logo)
output = root / "RiskGuard_프로토타입.html"
output.write_text(html, encoding="utf-8")
print(output)
