import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/deploy-canary.sh'
SHA = 'a' * 40

GCLOUD = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['FAKE_STATE']);d=json.loads(p.read_text());args=sys.argv[1:]
d['calls'].append(args)
def opt(key):return next((a.split('=',1)[1] for a in args if a.startswith(key+'=')),None) or args[args.index(key)+1]
if args[:3]==['run','services','describe']:
 traffic=[{'revisionName':revision,'percent':percent} for revision,percent in d.get('active_traffic',{'old-a':60,'old-b':40}).items()]
 if 'revision' in d:traffic.append({'revisionName':d['revision'],'tag':d['tag'],'url':'https://canary.example'})
 print(json.dumps({'status':{'traffic':traffic,'url':'https://service.example'}}))
elif args[:2]==['run','deploy']:
 d['revision']='ai-gateway-'+opt('--revision-suffix');d['tag']=opt('--tag')
elif args[:3]==['run','services','update-traffic']:
 d['traffic_updates'].append(opt('--to-revisions'))
 mode=os.environ.get('FAIL_MODE','')
 silent=(mode=='silent-rollback' and len(d['traffic_updates'])==2) or (mode=='silent-promotion' and len(d['traffic_updates'])==1)
 if not silent:d['active_traffic']={r:int(p) for r,p in (item.rsplit('=',1) for item in opt('--to-revisions').split(','))}
p.write_text(json.dumps(d))
'''
CURL = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
url=sys.argv[-1];d=json.loads(Path(os.environ['FAKE_STATE']).read_text());mode=os.environ.get('FAIL_MODE','')
if mode in ('service-ready','silent-rollback') and 'service.example/ready' in url:sys.exit(22)
if url.endswith('/health'):print(json.dumps({'status':'healthy','commit':'wrong' if mode=='commit' else os.environ['GIT_SHA']}))
else:print(json.dumps({'status':'not_ready' if mode=='ready' else 'ready'}))
'''


class CanarySafetyTests(unittest.TestCase):
    def run_deploy(self, failure=''):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);state=root/'state.json'
            state.write_text(json.dumps({'calls':[],'traffic_updates':[]}))
            for name,body in [('gcloud',GCLOUD),('curl',CURL)]:
                path=root/name;path.write_text(body);path.chmod(0o755)
            env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],
                 'FAKE_STATE':str(state),'FAIL_MODE':failure,'PROJECT_ID':'synthetic',
                 'REGION':'europe-west2','SERVICE':'ai-gateway','IMAGE':'example/image',
                 'GIT_SHA':SHA,'GITHUB_RUN_ID':'1234'}
            result=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True)
            return result,json.loads(state.read_text())

    def test_promotes_only_the_verified_named_revision(self):
        result,state=self.run_deploy()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(state['traffic_updates'],['ai-gateway-git-'+SHA[:12]+'-1234=100'])
        self.assertNotIn('LATEST',json.dumps(state['calls']))

    def test_wrong_commit_never_changes_traffic(self):
        result,state=self.run_deploy('commit')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(state['traffic_updates'],[])

    def test_unready_canary_never_changes_traffic(self):
        result,state=self.run_deploy('ready')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(state['traffic_updates'],[])

    def test_post_promotion_failure_restores_exact_previous_split(self):
        result,state=self.run_deploy('service-ready')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(state['traffic_updates'][-1],'old-a=60,old-b=40')
        self.assertEqual(len(state['traffic_updates']),2)
        self.assertEqual(state['active_traffic'],{'old-a':60,'old-b':40})
        self.assertIn('Verified rollback traffic split',result.stderr)

    def test_successful_rollback_command_with_wrong_readback_is_critical(self):
        result,state=self.run_deploy('silent-rollback')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(state['traffic_updates'][-1],'old-a=60,old-b=40')
        self.assertEqual(state['active_traffic'],{'ai-gateway-git-'+SHA[:12]+'-1234':100})
        self.assertIn('CRITICAL: rollback command succeeded but captured traffic was not restored',result.stderr)
        self.assertNotIn('Verified rollback traffic split',result.stderr)

    def test_successful_promotion_command_with_wrong_split_triggers_rollback(self):
        result,state=self.run_deploy('silent-promotion')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(state['traffic_updates'][-1],'old-a=60,old-b=40')
        self.assertIn('Traffic mismatch',result.stderr)
        self.assertNotIn('Verified '+SHA+' on',result.stdout)


if __name__=='__main__':unittest.main()
