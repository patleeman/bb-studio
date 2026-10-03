"""Loopback fixture proxy. Faults and restoration writes address only owned fixtures."""
import http.server,urllib.request,urllib.error,json,os,threading,time,hashlib,subprocess,urllib.parse
from pathlib import Path
upstream=os.environ['BB_QA_SERVER_URL']
u=urllib.parse.urlsplit(upstream)
assert u.scheme=='http' and u.hostname in ['127.0.0.1','localhost'] and u.port not in [None,1,38886]
fixtures=json.loads((Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'fixtures.json').read_text())
restored_ids=set()
state={'lookup':False,'lookupFailed':False,'lookupRecovered':False,'delayed':False,'released':False,'completed':False,'sharedNewest':False,'copiedNewest':False};release=threading.Event();lock=threading.Lock()
def record(event):
 with lock:
  with (Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'events.jsonl').open('a') as f:f.write(json.dumps(event)+'\n')
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def answer(self,status,data,headers={}):
  self.send_response(status)
  for k,v in headers.items():
   if k.lower() not in ['transfer-encoding','content-length','connection','content-encoding']: self.send_header(k,v)
  self.send_header('Content-Length',str(len(data)));self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):self.handle_request()
 def do_POST(self):self.handle_request()
 def handle_request(self):
  body=self.rfile.read(int(self.headers.get('Content-Length',0)))
  if self.path.startswith('/__edge/'):
   if self.path=='/__edge/arm-lookup':state['lookup']=True
   elif self.path=='/__edge/release':state['released']=True;release.set()
   elif self.path=='/__edge/check-copy':
    device=os.environ['BB_ARTIFACT_QA_DEVICE']
    # The caller cannot choose a device: this is the runner's fresh private UUID.
    copied=subprocess.check_output(['xcrun','simctl','pbpaste',device])
    state['copiedNewest']=copied==b'Edge newest selected version'
    record({'check':'selected-version-copy','sha256':hashlib.sha256(copied).hexdigest(),'matchesNewest':state['copiedNewest']})
   elif self.path=='/__edge/arm-delay':state.update(delayed=False,released=False,completed=False);release.clear()
   self.answer(200,json.dumps(state).encode(),{'Content-Type':'application/json'});return
  # Forward artifact reads and the fixture restoration RPCs only.
  if self.command=='POST' and self.path.rsplit('/',1)[-1] not in ['artifacts_get','artifacts_text','artifacts_list','artifacts_threadArtifacts','artifacts_importFile','artifacts_delete','resolve','projectNames','settings','status']:
   self.answer(403,b'QA proxy rejects writes');return
  payload=json.loads(body) if body else {}
  method=self.path.rsplit('/',1)[-1]
  if method=='artifacts_importFile' and payload not in [f['payload'] for f in fixtures.values()]:
   self.answer(403,b'Only fixture bytes may be restored');return
  if method=='artifacts_delete' and payload.get('id') not in restored_ids:
   self.answer(403,b'Only artifacts created by this proxy may be deleted');return
  if self.path.endswith('/studio/rpc/artifacts_get') and payload.get('id')==fixtures['lookup']['id'] and state['lookup']:
   state['lookup']=False;state['lookupFailed']=True;record({'check':'lookup','status':503});self.answer(503,b'{"ok":false,"error":"Controlled initial lookup failure"}',{'Content-Type':'application/json'});return
  request=urllib.request.Request(upstream+self.path,data=body if self.command=='POST' else None,method=self.command,headers={'Content-Type':self.headers.get('Content-Type','application/json')})
  try:
   with urllib.request.urlopen(request,timeout=20) as r:status=r.status;data=r.read();headers=dict(r.headers)
  except urllib.error.HTTPError as r:status=r.code;data=r.read();headers=dict(r.headers)
  except Exception as e:self.answer(502,str(e).encode());return
  if method=='artifacts_importFile' and status==200:
   restored_ids.add(json.loads(data)['result']['id'])
  if self.path.endswith('/studio/rpc/artifacts_text') and payload.get('id')==fixtures['race']['id'] and payload.get('versionId')==fixtures['race']['oldVersion']:
   state['delayed']=True;record({'check':'old-version-held','version':payload['versionId'],'status':status})
   if not release.wait(20):self.answer(504,b'delay not released');return
   state['completed']=True;record({'check':'old-version-released','version':payload['versionId'],'sha256':hashlib.sha256(data).hexdigest(),'status':status})
  if self.path.endswith('/studio/rpc/artifacts_get') and payload.get('id')==fixtures['lookup']['id'] and state['lookupFailed'] and status==200:
   state['lookupRecovered']=True;record({'check':'lookup','status':status})
  query=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  if query.get('artifact')==[fixtures['race']['id']] and query.get('download')==['1']:
   state['sharedNewest']=query.get('version')==[fixtures['race']['newVersion']] and data==b'Edge newest selected version'
   record({'check':'selected-version-share','version':query.get('version'),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'status':status})
  self.answer(status,data,headers)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
(Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'proxy-origin').write_text('http://127.0.0.1:'+str(server.server_port))
server.serve_forever()
