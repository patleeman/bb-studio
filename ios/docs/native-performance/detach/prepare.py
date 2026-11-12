import pathlib,subprocess,plistlib,os,sys
root=pathlib.Path(sys.argv[1]); sim=sys.argv[2]; origin='http://127.0.0.1:49486'; os.environ['DEVELOPER_DIR']='/Applications/Xcode.app/Contents/Developer'
subprocess.run(['xcrun','simctl','install',sim,str(root/'build/Build/Products/Debug-iphonesimulator/BBStudio.app')],check=True)
for domain in ['nyc.plee.bbgo','group.nyc.plee.bbgo']:
 subprocess.run(['xcrun','simctl','spawn',sim,'defaults','write',domain,'serverURL','-string',origin],check=True)
 assert subprocess.check_output(['xcrun','simctl','spawn',sim,'defaults','read',domain,'serverURL'],text=True).strip()==origin
app=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',sim,'nyc.plee.bbgo','data'],text=True).strip()); group=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',sim,'nyc.plee.bbgo','group.nyc.plee.bbgo'],text=True).strip())
for folder,domain in [(app,'nyc.plee.bbgo'),(group,'group.nyc.plee.bbgo')]:
 path=folder/'Library/Preferences'/f'{domain}.plist';path.parent.mkdir(parents=True,exist_ok=True);data=plistlib.loads(path.read_bytes()) if path.exists() else {};data.update(serverURL=origin,skipPushPrompt=True);path.write_bytes(plistlib.dumps(data)); assert plistlib.loads(path.read_bytes())['serverURL']==origin
 print('Confirmed',domain,origin)
source=next((root/'build/Build/Products').glob('BBStudio_*.xctestrun'));data=plistlib.loads(source.read_bytes());targets=[t for c in data['TestConfigurations'] for t in c['TestTargets']] if 'TestConfigurations' in data else [t for t in data.values() if isinstance(t,dict) and t.get('BlueprintName')]
for t in targets:
 if t['BlueprintName']=='BBStudioTests':
  t['OnlyTestIdentifiers']=['PageModelDetachTests'];t['CommandLineArguments']=['-serverURL',origin,'-skipPushPrompt','YES'];t.setdefault('EnvironmentVariables',{}).update(BB_DETACH_QA_SERVER_URL=origin,BB_DETACH_QA_PRIVATE_SIM='YES')
 else:t['IsEnabled']=False
(root/'build/Build/Products/detach.xctestrun').write_bytes(plistlib.dumps(data))
