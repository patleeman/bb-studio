"""Remove only owned fixture IDs printed by the focused test, even on failure."""
import json,pathlib,re,sys,urllib.request
folder=pathlib.Path(sys.argv[1])
ids={id for log in folder.glob('*.log') for id in re.findall(r'DETACH_PROBE fixture page: (pg_[A-Za-z0-9]+)',log.read_text(errors='replace'))}
for id in sorted(ids):
    request=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/pages/rpc/get',data=json.dumps({'id':id}).encode(),headers={'Content-Type':'application/json'})
    try:
        existing=json.load(urllib.request.urlopen(request,timeout=10))
        if existing.get('ok') and existing.get('result',{}).get('page') is None: continue
        request=urllib.request.Request('http://127.0.0.1:49486/api/v1/plugins/pages/rpc/remove',data=json.dumps({'id':id}).encode(),headers={'Content-Type':'application/json'})
        result=json.load(urllib.request.urlopen(request,timeout=10))
        if not result['ok'] and 'not found' not in str(result).lower(): print('Cleanup response',id,result,file=sys.stderr)
    except Exception as error: print('Cleanup failed',id,error,file=sys.stderr)
print('Checked cleanup for',len(ids),'owned fixture IDs')
