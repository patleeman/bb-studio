import os,json,urllib.request,base64,sqlite3,secrets,time,hashlib,subprocess
from pathlib import Path
assert os.environ['BB_DATA_DIR']=='/tmp/bb-studio-goal-staged/data'
run=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR']);out=json.loads((run/'fixtures.json').read_text()) if (run/'fixtures.json').exists() else {};suffix=secrets.token_hex(6)
def rpc(method,data):
 r=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/artifacts/rpc/'+method,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(r))['result']
for kind,name,data in [('headerPDF','edge-header-corrupt.pdf',b'%PDF-1.7\nnot a document '+suffix.encode()),('lookup','edge-lookup.txt',b'Edge lookup recovered'),('race','edge-race.txt',b'Edge old delayed version')]:
 payload={'name':name,'mime':'application/pdf' if kind=='headerPDF' else 'text/plain','bytes':base64.b64encode(data).decode(),'projectId':'proj_su3dznrbpw'}
 out[kind]={'id':rpc('importFile',payload)['id'],'payload':payload}
 (run/'fixtures.json').write_text(json.dumps(out))
race=out['race']; old=rpc('get',{'id':race['id']})['artifact']['version'];data=b'Edge newest selected version';digest=hashlib.sha256(data).hexdigest();version='av_'+secrets.token_hex(8)
db=sqlite3.connect('/tmp/bb-studio-goal-staged/data/plugins/artifacts/data.db')
assert db.execute('SELECT id FROM artifacts WHERE id=?',(race['id'],)).fetchall()==[(race['id'],)]
db.execute('INSERT OR IGNORE INTO artifact_blobs VALUES (?,?)',(digest,data))
db.execute('INSERT INTO artifact_versions VALUES (?,?,?,?,?,?,?,?)',(version,race['id'],2,'edge-race.txt','text/plain',len(data),digest,int(time.time()*1000)))
db.commit();db.close();race['oldVersion']=old['id'];race['newVersion']=version
(run/'fixtures.json').write_text(json.dumps(out));print({k:v['id'] for k,v in out.items()})

# PDFKit creates an actual password-protected document from the readable fixture.
source=run/'readable.pdf';locked=run/'locked.pdf'
source.write_bytes(base64.b64decode(out['pdf']['payload']['bytes']))
helper=run/'lock-pdf.swift'
helper.write_text("""import Foundation
import PDFKit
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
precondition(document.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), withOptions: [.userPasswordOption: "fixture-password", .ownerPasswordOption: "fixture-owner"]))
precondition(PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[2]))!.isLocked)
""")
subprocess.run(['xcrun','swift',str(helper),str(source),str(locked)],check=True)
payload={'name':'edge-locked.pdf','mime':'application/pdf','bytes':base64.b64encode(locked.read_bytes()).decode(),'projectId':'proj_su3dznrbpw'}
out['lockedPDF']={'id':rpc('importFile',payload)['id'],'payload':payload}
(run/'fixtures.json').write_text(json.dumps(out))
