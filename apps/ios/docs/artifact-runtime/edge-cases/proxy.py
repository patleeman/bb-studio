"""Read-only loopback test proxy. Control endpoints only address seeded IDs."""
import http.server,urllib.request,urllib.error,json,os,threading,time,hashlib,subprocess,urllib.parse
from pathlib import Path
fixtures=json.loads((Path(os.environ['BB_ARTIFACT_QA_RUN_DIR'])/'fixtures.json').read_text())
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
  # All writes are rejected. Native RPC lookup/text/list requests are read-only.
  if self.command=='POST' and self.path.rsplit('/',1)[-1] not in ['get','text','list','threadArtifacts','resolve','projectNames','settings','status']:
   self.answer(403,b'QA proxy rejects writes');return
  if self.command=='GET' and urllib.parse.urlsplit(self.path).path!='/api/v1/plugins/artifacts/http/content':
   self.answer(403,b'QA proxy only serves artifact bytes');return
  payload=json.loads(body) if body else {}
  if self.path.endswith('/artifacts/rpc/get') and payload.get('id')==fixtures['lookup']['id'] and state['lookup']:
   state['lookup']=False;state['lookupFailed']=True;record({'check':'lookup','status':503});self.answer(503,b'{"ok":false,"error":"Controlled initial lookup failure"}',{'Content-Type':'application/json'});return
  request=urllib.request.Request('http://127.0.0.1:49486'+self.path,data=body if self.command=='POST' else None,method=self.command,headers={'Content-Type':self.headers.get('Content-Type','application/json')})
  try:
   with urllib.request.urlopen(request,timeout=20) as r:status=r.status;data=r.read();headers=dict(r.headers)
  except urllib.error.HTTPError as r:status=r.code;data=r.read();headers=dict(r.headers)
  except Exception as e:self.answer(502,str(e).encode());return
  if self.path.endswith('/artifacts/rpc/text') and payload.get('id')==fixtures['race']['id'] and payload.get('versionId')==fixtures['race']['oldVersion']:
   state['delayed']=True;record({'check':'old-version-held','version':payload['versionId'],'status':status})
   if not release.wait(20):self.answer(504,b'delay not released');return
   state['completed']=True;record({'check':'old-version-released','version':payload['versionId'],'sha256':hashlib.sha256(data).hexdigest(),'status':status})
  if self.path.endswith('/artifacts/rpc/get') and payload.get('id')==fixtures['lookup']['id'] and state['lookupFailed'] and status==200:
   state['lookupRecovered']=True;record({'check':'lookup','status':status})
  query=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  if query.get('artifact')==[fixtures['race']['id']] and query.get('download')==['1']:
   state['sharedNewest']=query.get('version')==[fixtures['race']['newVersion']] and data==b'Edge newest selected version'
   record({'check':'selected-version-share','version':query.get('version'),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'status':status})
  self.answer(status,data,headers)
http.server.ThreadingHTTPServer(('127.0.0.1',49626),Handler).serve_forever()
