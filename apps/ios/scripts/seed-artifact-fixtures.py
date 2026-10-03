import urllib.request,json,base64,sqlite3,hashlib,zlib,struct,os
from pathlib import Path
import urllib.parse
origin=os.environ['BB_QA_SERVER_URL']
u=urllib.parse.urlsplit(origin)
assert u.scheme == 'http' and u.hostname in ['127.0.0.1','localhost'] and u.port not in [None,1,38886]
data_dir=Path(os.environ['BB_QA_DATA_DIR']).resolve()
assert str(data_dir).startswith('/private/tmp/') and data_dir.name == 'data'
project=os.environ['BB_QA_PROJECT_ID']
assert sqlite3.connect(data_dir/'bb.db').execute('SELECT id FROM projects WHERE id=?',(project,)).fetchone()
assert any(p['id']==project for p in json.load(urllib.request.urlopen(origin+'/api/v1/projects')))
run=Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])
def rpc(method,input):
 req=urllib.request.Request(origin+'/api/v1/plugins/studio/rpc/artifacts_'+method,data=json.dumps(input).encode(),headers={'Content-Type':'application/json'})
 result=json.load(urllib.request.urlopen(req)); assert result['ok'],result; return result['result']
def chunk(t,b): return struct.pack('!I',len(b))+t+b+struct.pack('!I',zlib.crc32(t+b)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',120,80,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\x18\x91\xc2'*120)*80))+chunk(b'IEND',b'')
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
stream=b'BT /F1 18 Tf 30 120 Td (Artifact Runtime PDF) Tj ET';objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream')
pdf=b'%PDF-1.4\n';offsets=[0]
for i,obj in enumerate(objects,1): offsets.append(len(pdf));pdf+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
x=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{v:010} 00000 n \n'.encode() for v in offsets[1:])+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(x).encode()+b'\n%%EOF\n'
fixtures={}
import secrets
missing_suffix=secrets.token_hex(8).encode()
for kind,name,mime,data in [('emptyText','artifact-runtime-empty-text.txt','text/plain',b''),('missingHTML','artifact-runtime-missing-html.html','text/html',b'<html><body><h1>Artifact Runtime recovered HTML 20261003</h1></body></html>'),('text','artifact-runtime-text.txt','text/plain',b'Artifact Runtime Text 20261003'),('markdown','artifact-runtime-markdown.md','text/markdown',b'# Artifact Runtime Markdown\n\n**Rendered preview** 20261003'),('image','artifact-runtime-image.png','image/png',png),('html','artifact-runtime-html.html','text/html',b'<html><body><h1>Artifact Runtime HTML</h1><p>20261003</p></body></html>'),('pdf','artifact-runtime-pdf.pdf','application/pdf',pdf),('missingText','artifact-runtime-missing-text.txt','text/plain',b'Artifact Runtime recovered text 20261003'),('missingImage','artifact-runtime-missing-image.png','image/png',png+b'own-missing-image-20261003'),('corruptImage','artifact-runtime-corrupt-image.png','image/png',b'not-an-image-20261003'),('corruptPDF','artifact-runtime-corrupt.pdf','application/pdf',b'not-a-pdf-20261003')]:
 if kind.startswith('missing'): data += missing_suffix
 payload=dict(name=name,mime=mime,bytes=base64.b64encode(data).decode(),projectId=project)
 fixtures[kind]=dict(id=rpc('importFile',payload)['id'],payload=payload)
 (run/'fixtures.json').write_text(json.dumps(fixtures))
 if kind.startswith('missing'):
  db=sqlite3.connect(str(data_dir/'plugins/studio/artifacts.db'));digest=hashlib.sha256(data).hexdigest();assert db.execute('SELECT artifact_id FROM artifact_versions WHERE sha256=?',(digest,)).fetchall() == [(fixtures[kind]['id'],)], 'Only mutate blobs referenced by this owned fixture';db.execute('DELETE FROM artifact_blobs WHERE sha256=?',(digest,));db.commit();db.close()
(run/'fixtures.json').write_text(json.dumps(fixtures))
print(json.dumps({k:v['id'] for k,v in fixtures.items()}))

import secrets,time,subprocess
out=fixtures
suffix=secrets.token_hex(6)
for kind,name,data in [('headerPDF','edge-header-corrupt.pdf',b'%PDF-1.7\nnot a document '+suffix.encode()),('lookup','edge-lookup.txt',b'Edge lookup recovered'),('race','edge-race.txt',b'Edge old delayed version')]:
 payload={'name':name,'mime':'application/pdf' if kind=='headerPDF' else 'text/plain','bytes':base64.b64encode(data).decode(),'projectId':project}
 out[kind]={'id':rpc('importFile',payload)['id'],'payload':payload}
 (run/'fixtures.json').write_text(json.dumps(out))
race=out['race']; old=rpc('get',{'id':race['id']})['artifact']['version'];data=b'Edge newest selected version';digest=hashlib.sha256(data).hexdigest();version='av_'+secrets.token_hex(8)
db=sqlite3.connect(str(data_dir/'plugins/studio/artifacts.db'))
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
payload={'name':'edge-locked.pdf','mime':'application/pdf','bytes':base64.b64encode(locked.read_bytes()).decode(),'projectId':project}
out['lockedPDF']={'id':rpc('importFile',payload)['id'],'payload':payload}
(run/'fixtures.json').write_text(json.dumps(out))
