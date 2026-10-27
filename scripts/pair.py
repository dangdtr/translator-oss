import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.app import TOKEN

config_dict = {'url': 'http://127.0.0.1:8765', 'token': TOKEN}
config_js = 'globalThis.LOCAL_CONFIG = ' + json.dumps(config_dict) + ';\n'
config_json = json.dumps(config_dict, indent=2) + '\n'

targets = [
    (ROOT / 'extension/local-config.js', config_js),
    (ROOT / 'public/local-config.js', config_js),
    (ROOT / '.output/chrome-mv3/local-config.js', config_js),
    (ROOT / 'extension/local-config.json', config_json),
    (ROOT / 'public/local-config.json', config_json),
    (ROOT / '.output/chrome-mv3/local-config.json', config_json),
]

for path, content in targets:
    if path.parent.exists():
        path.write_text(content)
        path.chmod(0o600)

print('Extension paired with local server.')
