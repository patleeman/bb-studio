import plistlib,json,subprocess
from pathlib import Path
import os
run=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR']);device=os.environ['BB_ARTIFACT_QA_DEVICE'];origin='http://127.0.0.1:49626'
assert os.environ.get('BB_ARTIFACT_QA_SERVER_URL') == 'http://127.0.0.1:49486'
os.environ['DEVELOPER_DIR']='/Applications/Xcode.app/Contents/Developer'
def sim(*args):return subprocess.check_output(['xcrun','simctl',*args],text=True).strip()
sim('install',device,str(run/'build/Build/Products/Debug-iphonesimulator/BBStudio.app'))
for domain in ['nyc.plee.bbgo','group.nyc.plee.bbgo']:
 sim('spawn',device,'defaults','write',domain,'serverURL','-string',origin)
 assert sim('spawn',device,'defaults','read',domain,'serverURL')==origin
for typ,domain in [('data','nyc.plee.bbgo'),('group.nyc.plee.bbgo','group.nyc.plee.bbgo')]:
 folder=Path(sim('get_app_container',device,'nyc.plee.bbgo',typ));p=folder/'Library/Preferences'/f'{domain}.plist';p.parent.mkdir(parents=True,exist_ok=True)
 values=plistlib.loads(p.read_bytes()) if p.exists() else {};values['serverURL']=origin;p.write_bytes(plistlib.dumps(values));assert plistlib.loads(p.read_bytes())['serverURL']==origin
 print('Verified origin before launch:',domain,origin)
p=next((run/'build/Build/Products').glob('*.xctestrun'));values=plistlib.loads(p.read_bytes())
if 'BBStudioUITests' in values:t=values['BBStudioUITests']
else:t=next(t for c in values['TestConfigurations'] for t in c['TestTargets'] if t['BlueprintName']=='BBStudioUITests')
t.setdefault('EnvironmentVariables',{}).update(BB_ARTIFACT_QA_SERVER_URL=origin,BB_ARTIFACT_QA_EDGE='YES',BB_ARTIFACT_QA_PRIVATE_SIM='YES',BB_ARTIFACT_QA_FIXTURES=(run/'fixtures.json').read_text(),BB_ARTIFACT_QA_BASELINE='YES' if os.environ.get('BASELINE')=='YES' else 'NO')
p.write_bytes(plistlib.dumps(values));print(p)
