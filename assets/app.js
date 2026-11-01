'use strict';
const $ = s => document.querySelector(s);
const PAGE = 36;
const fields = ['source','job','model','catalog','scene','occupation','category','level','rating','available'];
const defaults = {q:'',source:'',job:'',model:'',catalog:'',scene:'',occupation:'',category:'',level:'',rating:'',available:'available',sort:'recent',view:'appreciate'};
let all = [], shown = [], isPublic = false, view = 'appreciate', cursor = 0, selected = new Set(), byId = new Map(), benchmarkCatalog = {}, benchmarkItems = [], promptDiagnostics = {};
let searchTimer, scrollBefore = 0, viewerFocus, compareFocus, viewerZoom = 1, compareRows = [], compareBlind = false, revealed = false, activePane = 0, syncScrolling = false;
const scalar = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const node = (tag, text, cls) => {const el = document.createElement(tag);if(text != null) el.textContent=text;if(cls) el.className=cls;return el;};
function source(x) {return scalar(x.source_group || (isPublic ? '로컬 생성' : x.source_kind || '출처 미확인'));}
function title(x) {return scalar(x.title || x.occupation || x.scene_id || '제목 미확인');}
function model(x) {return scalar((isPublic?benchmarkCatalog.models?.find(m=>String(m.id)===String(x.benchmark?.model_id))?.name:null) || x.model_label || x.model_id || '모델 미확인');}
function value(x, k) {
  return scalar(({source:()=>source(x),job:()=>x.job_id||x.bench_slug||x.exp_id||'',model:()=>model(x),catalog:()=>x.catalog,scene:()=>x.scene_id,occupation:()=>x.occupation,category:()=>x.category,level:()=>x.nsfw_level||'unknown',rating:()=>x.rating})[k]?.());
}
function media(x, kind) {
  if (kind === 'thumb') return x.thumb_url || `/media/${encodeURIComponent(x.image_id)}/thumb?size=640`;
  if (kind === 'preview') return x.preview_url || `/media/${encodeURIComponent(x.image_id)}/preview`;
  return x.original_url || (isPublic ? '' : `/media/${encodeURIComponent(x.image_id)}/original?original=1`);
}
function linkURL(raw) {try {const url = new URL(raw);return /^https?:$/.test(url.protocol) ? url.href : null;} catch {return null;}}
function setView(next) {
  view = next === 'bench' ? 'bench' : (next === 'prompt' && !isPublic ? 'prompt' : 'appreciate');
  document.body.classList.toggle('bench', view === 'bench');
  document.body.classList.toggle('prompt-view', view === 'prompt');
  $('#appreciate').setAttribute('aria-pressed', String(view === 'appreciate'));
  $('#benchmark').setAttribute('aria-pressed', String(view === 'bench'));
  $('#prompt-view').setAttribute('aria-pressed', String(view === 'prompt'));
  $('#prompt-view').hidden = isPublic;
  $('#prompt-view-panel').hidden = view !== 'prompt';
  $('#benchmark-guide').hidden=!(isPublic&&view==='bench');$('#model-information').hidden=!(isPublic&&view==='bench');document.body.classList.toggle('public-benchmark',isPublic&&view==='bench');
  $('#page-title').textContent=view==='prompt'?'프롬프트 비교':(isPublic&&view==='bench'?'모델 벤치마크':'이미지 탐색');
  $('#page-description').textContent=view==='prompt'?'같은 프롬프트의 결과를 같은 시드로 비교합니다.':(isPublic&&view==='bench'?'테스트 장면과 생성 조건을 살펴보고 모델별 결과를 비교합니다.':'마음에 드는 장면을 찾고, 선택한 이미지를 나란히 살펴보세요.');
}
const benchOf=x=>x.benchmark&&typeof x.benchmark==='object'?x.benchmark:{};
const benchGroupKey=(suite,scene)=>JSON.stringify([String(suite??''),String(scene??'')]);
function benchmarkGroups(items){const groups=new Map();for(const x of items){const b=benchOf(x);if(b.suite_id==null||b.suite_id===''||b.scene_key==null||b.scene_key===''||b.model_id==null||b.model_id==='')continue;const key=benchGroupKey(b.suite_id,b.scene_key);if(!groups.has(key))groups.set(key,{suite_id:String(b.suite_id),scene_key:String(b.scene_key),scene_label:String(b.scene_label||'장면 이름 미확인'),items:[]});groups.get(key).items.push(x);}return [...groups.values()];}
function benchValue(x,key){const b=benchOf(x);const v=b[key];return v==null||v===''?'미확인':Array.isArray(v)?(v.length?v.join(', '):'미확인'):scalar(v);}
function promptInfo(x){return x.prompt_comparison&&typeof x.prompt_comparison==='object'?x.prompt_comparison:null;}
function promptGroups(){const groups=new Map();for(const x of all){const p=promptInfo(x);if(!p?.match_verified||!p.prompt_sha256||!p.prompt)continue;if(!groups.has(p.prompt_sha256))groups.set(p.prompt_sha256,{hash:p.prompt_sha256,prompt:p.prompt,label:p.prompt_label||'',items:[],expected:new Set(),expectedTuning:new Map()});const g=groups.get(p.prompt_sha256);g.items.push(x);for(const c of p.expected_catalogs||[])g.expected.add(String(c));for(const pair of p.expected_tuning_arms||[])g.expectedTuning.set(String(pair.pair),new Set(pair.arms||[]));if(p.prompt_label&&!g.label)g.label=p.prompt_label;}return [...groups.values()];}
function promptGroupLabel(g){const names={P1:'P1 · 카페 사진',A1:'A1 · 애니메이션 일러스트',P2:'P2 · 패션 사진',A2:'A2 · 애니메이션 장면'};return names[g.label]||`${g.label||'프롬프트'} · ${g.hash.slice(0,12)}`;}
function setPromptOptions(restore){const groups=promptGroups(),select=$('#prompt-choice'),params=new URLSearchParams(location.search),wanted=restore?params.get('prompt_id'):select.value;select.replaceChildren();for(const g of groups){const o=node('option',promptGroupLabel(g));o.value=g.hash;o.title=g.prompt;select.append(o);}const preferred=groups.find(g=>g.label==='P1')||groups[0];select.value=groups.some(g=>g.hash===wanted)?wanted:(preferred?.hash||'');const chosen=groups.find(g=>g.hash===select.value);const seeds=[...new Set((chosen?.items||[]).map(x=>String(promptInfo(x).seed??'' )).filter(Boolean))].sort((a,b)=>Number(a)-Number(b));const seed=$('#prompt-seed'),wantedSeed=restore?params.get('seed'):seed.value;seed.replaceChildren();for(const s of seeds){const o=node('option',s);o.value=s;seed.append(o);}seed.value=seeds.includes(wantedSeed)?wantedSeed:(seeds.includes('31031')?'31031':(seeds[0]||''));const scope=$('#prompt-scope'),wantedScope=restore?params.get('scope'):scope.value;scope.value=['all','catalog','tuning'].includes(wantedScope)?wantedScope:'all';}
function promptCondition(p){return `${p.catalog||'카탈로그 미확인'} · ${p.variant||'기준'} · 시드 ${p.seed??'미확인'} · ${p.steps??'미확인'} steps · CFG ${p.cfg??'미확인'} · ${p.sampler||'샘플러 미확인'} / ${p.scheduler||'스케줄러 미확인'} · ${p.width??'?'} × ${p.height??'?'}`;}
function updatePromptManual(){const n=selected.size;$('#prompt-manual-count').textContent=`수동 비교 선택 ${n} / 4`;$('#prompt-manual-compare').disabled=n<2||n>4;}
function addPromptManual(x){if(selected.has(x.image_id)){selected.delete(x.image_id);}else if(selected.size>=4){$('#prompt-manual-count').textContent='최대 4장입니다. 선택을 먼저 해제해 주세요.';return;}else selected.add(x.image_id);updatePromptManual();renderPrompt(false);}
function renderPrompt(restore=false){if(isPublic)return;setPromptOptions(restore);const group=promptGroups().find(g=>g.hash===$('#prompt-choice').value),seed=$('#prompt-seed').value,scope=$('#prompt-scope').value;const rows=(group?.items||[]).filter(x=>String(promptInfo(x).seed??'')===seed&&(scope==='all'||promptInfo(x).scope===scope));rows.sort((a,b)=>{const x=promptInfo(a),y=promptInfo(b);return String(x.comparison_catalog||x.catalog).localeCompare(String(y.comparison_catalog||y.catalog),'ko',{numeric:true})||({baseline:0,기본:0,enhancer:1,candidate:2}[x.variant]??3)-({baseline:0,기본:0,enhancer:1,candidate:2}[y.variant]??3)||String(x.job_id).localeCompare(String(y.job_id));});shown=rows;const host=$('#prompt-results');host.replaceChildren();$('#prompt-summary').replaceChildren();updatePromptManual();if(!group){$('#prompt-summary').textContent='실제 positive prompt가 확인된 비교 자료가 없습니다.';return;}$('#prompt-summary').append(node('span',`${rows.length}개 확인된 결과 · exact positive SHA-256 ${group.hash} · 동일 positive만 묶음`));const q=promptDiagnostics;$('#prompt-summary').append(node('span',` · 비교 제외: 미확인 ${q.unverified||0}건, 실제 positive 불일치 ${q.mismatch||0}건`));const text=node('p',group.prompt,'prompt-text');host.append(text);const present=new Set(rows.map(x=>String(scope==='tuning'?promptInfo(x).comparison_catalog:promptInfo(x).catalog)));const expected=scope==='tuning'?new Set(group.expectedTuning.keys()):group.expected;for(const catalog of [...expected].filter(c=>!present.has(c)).sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}))) {const card=node('article',null,'prompt-card');card.append(node('h3',`${catalog} · 동일 시드 결과 없음`),node('div','이 프롬프트·시드의 성공 artifact가 없어 다른 시드나 프롬프트를 대신 표시하지 않습니다.','prompt-missing'));host.append(card);}const byCatalog=new Map();for(const x of rows){const p=promptInfo(x),k=String(p.comparison_catalog||p.catalog||'카탈로그 미확인');if(!byCatalog.has(k))byCatalog.set(k,[]);byCatalog.get(k).push(x);}for(const [catalog,assets] of byCatalog){const card=node('article',null,'prompt-card');card.append(node('h3',catalog));const actualArms=new Set(assets.filter(x=>promptInfo(x).scope==='tuning').map(x=>promptInfo(x).variant));for(const x of assets){const p=promptInfo(x),entry=node('div',null,p.scope==='tuning'?'prompt-tuning':'');if(p.scope==='tuning')entry.append(node('h4',`${p.variant==='candidate'?'후보':'기준'} · ${p.catalog} · ${p.job_id}`));const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',`${p.catalog} ${p.variant} 크게 보기`);const img=node('img');img.className='prompt-image';img.src=media(x,'thumb');img.loading='lazy';img.alt=`${p.catalog} ${p.variant}`;open.append(img);open.onclick=()=>openViewer(rows.indexOf(x),open);entry.append(open,node('div',promptCondition(p),'prompt-meta'));if(p.negative_prompt)entry.append(node('div',`Negative prompt: ${p.negative_prompt}`,'prompt-meta'));const add=node('button',selected.has(x.image_id)?'수동 비교 선택됨':'수동 비교에 추가','quiet');add.type='button';add.onclick=()=>addPromptManual(x);entry.append(add);card.append(entry);}if(scope==='tuning'){const expectedArms=group.expectedTuning.get(catalog)||new Set();for(const arm of expectedArms)if(!actualArms.has(arm))card.append(node('div',`${arm==='candidate'?'후보':'기준'} · 동일 시드 artifact 없음`,'prompt-meta'));}host.append(card);}if(restore){const params=new URLSearchParams();params.set('view','prompt');if(group)params.set('prompt_id',group.hash);if(seed)params.set('seed',seed);params.set('scope',scope);history.replaceState(null,'',location.pathname+'?'+params.toString()+location.hash);}}
function fillSelect(el,values,placeholder){el.replaceChildren();const first=node('option',placeholder);first.value='';el.append(first);for(const [v,label] of values){const o=node('option',label);o.value=v;el.append(o);}}
function renderBenchmark(restore=true){if(!isPublic)return;benchmarkItems=all.filter(x=>x.benchmark&&typeof x.benchmark==='object');const groups=benchmarkGroups(benchmarkItems),suite=$('#bench-suite'),scene=$('#bench-scene'),modelSelect=$('#bench-model');
  const suites=[...new Set(groups.map(g=>g.suite_id))],wantedSuite=restore?new URLSearchParams(location.search).get('suite'):suite.value;fillSelect(suite,suites.map(id=>[id,benchmarkCatalog.suites?.find(s=>String(s.id)===id)?.title||id]),'테스트 세트 선택');suite.value=suites.includes(wantedSuite)?wantedSuite:(suites[0]||'');
  const suiteGroups=groups.filter(g=>g.suite_id===suite.value),wantedScene=restore?new URLSearchParams(location.search).get('scene_key'):scene.value;fillSelect(scene,suiteGroups.map(g=>[g.scene_key,g.scene_label]),'비교 장면 선택');scene.value=suiteGroups.some(g=>g.scene_key===wantedScene)?wantedScene:(suiteGroups[0]?.scene_key||'');
  const group=suiteGroups.find(g=>g.scene_key===scene.value),models=[...new Set((group?.items||[]).map(x=>String(benchOf(x).model_id)))];fillSelect(modelSelect,models.map(id=>[id,benchmarkCatalog.models?.find(m=>String(m.id)===id)?.name||id]),'모든 모델');const wantedModel=restore?new URLSearchParams(location.search).get('bench_model'):modelSelect.value;modelSelect.value=models.includes(wantedModel)?wantedModel:'';
  const groupModelCount=new Set((group?.items||[]).map(x=>String(benchOf(x).model_id))).size;$('#compare-scene').disabled=$('#blind-scene').disabled=groupModelCount<2;$('#bench-counts').textContent=`${benchmarkItems.length}개 이미지 · ${new Set(benchmarkItems.map(x=>benchOf(x).model_id)).size}개 모델 · ${groups.length}개 비교 장면`;
  const suiteInfo=benchmarkCatalog.suites?.find(s=>String(s.id)===suite.value);$('#benchmark-introduction').textContent=benchmarkCatalog.benchmark?.introduction||benchmarkCatalog.introduction||suiteInfo?.description||'테스트 장면을 골라 모델별 결과를 비교합니다.';
  $('#bench-environment').textContent='기록된 환경: ComfyUI 생성 그래프 · 당시 GPU/드라이버/소프트웨어 버전은 미확인. 설정별 결과 비교이며 정량 순위가 아닙니다.';const method=$('#bench-method-content');method.replaceChildren();if(suiteInfo?.description)method.append(node('p',suiteInfo.description));for(const line of [...(suiteInfo?.notes||[]),...(benchmarkCatalog.benchmark?.methodology||benchmarkCatalog.methodology||[]),...(benchmarkCatalog.benchmark?.limitations||benchmarkCatalog.limitations||[])])method.append(node('p',line));if(benchmarkCatalog.benchmark?.environment_note||benchmarkCatalog.environment_note)method.append(node('p','테스트 환경: '+(benchmarkCatalog.benchmark?.environment_note||benchmarkCatalog.environment_note)));
  const cards=$('#model-cards');cards.replaceChildren();const definitions=benchmarkCatalog.models||[];for(const id of [...new Set((group?.items||[]).map(x=>String(benchOf(x).model_id)))]){const def=definitions.find(m=>String(m.id)===id)||{},card=node('article',null,'model-card');card.append(node('h3',def.name||id));card.append(node('p',`${def.family||'계열 미확인'} · ${def.precision||'정밀도 미확인'} · ${def.checkpoint||'체크포인트 미확인'}`));if(def.notes)card.append(node('p',def.notes));const sample=benchOf(group.items.find(x=>String(benchOf(x).model_id)===id)||{});card.append(node('p',`${sample.steps??'미확인'} steps · CFG ${sample.cfg??'미확인'} · ${sample.width??'?'} × ${sample.height??'?'}`,'model-settings'));card.append(node('p',`${sample.sampler??'샘플러 미확인'} / ${sample.scheduler??'스케줄러 미확인'} · 시드 ${sample.seed??'미확인'}`));card.append(node('p',`${(group.items||[]).filter(x=>String(benchOf(x).model_id)===id).length}개 결과`));cards.append(card);}
  const prompts=$('#bench-prompts');prompts.replaceChildren();for(const x of group?.items||[]){const b=benchOf(x),entry=node('details',null,'bench-prompt-item');entry.append(node('summary',`${benchmarkCatalog.models?.find(m=>String(m.id)===String(b.model_id))?.name||b.model_id} · ${b.scene_label||'장면 이름 미확인'}`));entry.append(node('h4','프롬프트'));entry.append(node('p',b.prompt||'미확인'));entry.append(node('h4','부정 프롬프트'));entry.append(node('p',b.negative_prompt===''?'사용 안 함 (빈 입력)':b.negative_prompt||'미확인'));prompts.append(entry);}
  const auto=(group?.items||[]).filter(x=>models.includes(String(benchOf(x).model_id)));const validIds=new Set(auto.map(x=>x.image_id));selected=new Set([...selected].filter(id=>validIds.has(id)));if(!selected.size){const choices=[],seenModels=new Set();for(const x of auto){const id=String(benchOf(x).model_id);if(seenModels.has(id))continue;seenModels.add(id);choices.push(x);if(choices.length===4)break;}choices.forEach(x=>selected.add(x.image_id));}$('#bench-status').textContent=!group?'이 세트에 비교할 장면이 없습니다.':groupModelCount<2?'이 장면에는 서로 다른 모델이 2개 미만이라 모델 비교를 시작할 수 없습니다.':models.length>4?`이 장면에는 ${models.length}개 모델이 있습니다. 처음 4개 모델 결과를 선택했습니다. 모델 필터를 바꾸어 다른 결과를 추가 선택할 수 있습니다.`:`${models.length}개 모델의 같은 장면 결과를 선택했습니다.`;updateSelected();
  if(restore){const params=new URLSearchParams(location.search);if(suite.value)params.set('suite',suite.value);else params.delete('suite');if(scene.value)params.set('scene_key',scene.value);else params.delete('scene_key');if(modelSelect.value)params.set('bench_model',modelSelect.value);else params.delete('bench_model');history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():'')+location.hash);}
}
function readUrl() {
  const params = new URLSearchParams(location.search);
  for(const key of ['q',...fields,'sort']) {
    const el=$('#'+key), next=params.get(key) ?? defaults[key];
    el.value = (el.tagName==='SELECT' && ![...el.options].some(o=>o.value===next)) ? defaults[key] : next;
  }
  if(isPublic) $('#level').value='';
  setView(params.get('view')||(isPublic?'bench':'appreciate'));
  if(view==='prompt')renderPrompt(true);
  updateFilterToggle();
}
function writeUrl(push=false) {
  if(view==='prompt'){const params=new URLSearchParams();params.set('view','prompt');if($('#prompt-choice').value)params.set('prompt_id',$('#prompt-choice').value);if($('#prompt-seed').value)params.set('seed',$('#prompt-seed').value);params.set('scope',$('#prompt-scope').value||'all');const url=location.pathname+'?'+params.toString()+location.hash;if(url!==location.pathname+location.search+location.hash)history[push?'pushState':'replaceState'](null,'',url);return;}
  const params=new URLSearchParams();
  for(const key of ['q',...fields,'sort']) {
    const val=$('#'+key).value;
    if(val!==defaults[key] && val && !(isPublic&&key==='level')) params.set(key,val);
  }
  if(view==='bench') params.set('view','bench');else if(isPublic)params.set('view','appreciate');
  if(view==='bench'){if($('#bench-suite').value)params.set('suite',$('#bench-suite').value);else params.delete('suite');if($('#bench-scene').value)params.set('scene_key',$('#bench-scene').value);else params.delete('scene_key');if($('#bench-model').value)params.set('bench_model',$('#bench-model').value);else params.delete('bench_model');}
  const url=location.pathname+(params.size?'?'+params.toString():'')+location.hash;
  if(url!==location.pathname+location.search+location.hash) history[push?'pushState':'replaceState'](null,'',url);
}
function filtered({url=true,push=false}={}) {
  if(view==='prompt'){if(url)writeUrl(push);renderPrompt(false);return;}
  const q=$('#q').value.trim().toLocaleLowerCase(), tokens=q.split(/\s+/).filter(Boolean);
  const picks=fields.filter(k=>!['available'].includes(k)).map(k=>[k,$('#'+k).value]).filter(([,v])=>v);
  shown=all.filter(x=>($('#available').value==='all'||x.available!==false)&&tokens.every(t=>x._search.includes(t))&&picks.every(([k,v])=>value(x,k)===v)&&(!(isPublic&&view==='bench')||(String(benchOf(x).suite_id??'')===$('#bench-suite').value&&String(benchOf(x).scene_key??'')===$('#bench-scene').value&&(!$('#bench-model').value||String(benchOf(x).model_id)===$('#bench-model').value))));
  const sort=$('#sort').value;
  if(sort==='model') shown.sort((a,b)=>model(a).localeCompare(model(b),'ko')||a._index-b._index);
  else if(sort==='rating') shown.sort((a,b)=>numberRating(b)-numberRating(a)||a._index-b._index);
  else shown.sort((a,b)=>b._date-a._date||a._index-b._index);
  if(url) writeUrl(push);
  render(true);updateFilterToggle();updateSelected();
}
function numberRating(x){const v=Number(x.rating);return x.rating!=null&&x.rating!==''&&Number.isFinite(v)?v:-Infinity;}
function makeImage(x, kind) {
  const img=node('img');img.src=media(x,kind);img.decoding='async';img.draggable=false;img.alt='';
  if(kind==='thumb') {img.className='thumb';img.loading='lazy';if(x.thumb_srcset||!isPublic) {img.srcset=x.thumb_srcset||`/media/${encodeURIComponent(x.image_id)}/thumb?size=320 320w, /media/${encodeURIComponent(x.image_id)}/thumb?size=640 640w`;img.sizes='(max-width:650px) 46vw, (max-width:1050px) 30vw, (min-width:1500px) 18vw, 22vw';}}
  img.onerror=()=>{img.alt='이미지를 불러오지 못했습니다';img.classList.add('broken');};return img;
}
function render(reset=false) {
  const grid=$('#grid');if(reset) grid.replaceChildren();const start=grid.children.length,end=Math.min(start+PAGE,shown.length),fragment=document.createDocumentFragment();
  for(let i=start;i<end;i++) {
    const x=shown[i], card=node('article',null,'card');card.dataset.id=x.image_id;card.classList.toggle('selected',selected.has(x.image_id));
    const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',title(x)+' 이미지 크게 보기');const thumb=makeImage(x,'thumb');if(i<4){thumb.loading='eager';if(i===0)thumb.fetchPriority='high';}open.append(thumb);open.onclick=()=>openViewer(i,open);
    const check=node('input',null,'select-image');check.type='checkbox';check.checked=selected.has(x.image_id);check.setAttribute('aria-label',title(x)+' 비교 선택');
    check.onchange=()=>{if(check.checked&&selected.size>=4){check.checked=false;$('#selection-hint').textContent='최대 4장입니다. 기존 선택을 해제해 주세요.';return;}check.checked?selected.add(x.image_id):selected.delete(x.image_id);card.classList.toggle('selected',check.checked);updateSelected();};
    const wrap=node('label',null,'select-wrap');wrap.append(check);

    const meta=node('div',null,'cardmeta'),heading=node('button',isPublic&&view==='bench'?model(x):title(x),'card-title');heading.title=title(x);heading.onclick=()=>openViewer(i,heading);
    const subtext=isPublic?(benchOf(x).scene_label||[x.occupation,x.scene_id].filter(Boolean).join(' · ')||source(x)):source(x)+' · '+model(x);
    const sub=node('div',subtext,'sub');sub.title=subtext;
    const bench=node('div',[model(x),x.scene_id, x.rating!=null?'평가 '+x.rating:'평가 미확인'].filter(Boolean).join(' · '),'bench-line');bench.title=bench.textContent;
    const bench2=node('div',[value(x,'job')||x.catalog,x.seed!=null?'시드 '+x.seed:'',x.created_at?'날짜 '+x.created_at:'날짜 미확인'].filter(Boolean).join(' · '),'bench-line');bench2.title=bench2.textContent;
    if(isPublic&&view==='bench'){const b=benchOf(x);bench.textContent=`${b.steps??'?'} steps · CFG ${b.cfg??'?'} · ${b.width??'?'}×${b.height??'?'}`;bench2.textContent=`${b.sampler??'?'} / ${b.scheduler??'?'} · ${b.precision||'정밀도 미확인'}`;}meta.append(heading,sub,bench,bench2);card.append(open,wrap,meta);fragment.append(card);
  }
  grid.append(fragment);$('#more').hidden=end>=shown.length;$('#more').textContent=`${Math.min(PAGE,shown.length-end)}장 더 보기`;$('#empty').hidden=!!shown.length;
  $('#count').textContent=`${shown.length.toLocaleString()}장 · ${end.toLocaleString()}장 표시`;
}
function updateSelected() {
  const n=selected.size;$('#batch').hidden=!n||(isPublic&&view==='bench');$('#selected-count').textContent=`${n} / 4장 선택`;
  $('#selection-hint').textContent=n<2?'한 장 더 골라 비교하세요.':'필터를 바꿔도 선택은 유지됩니다.';
  $('#compare').disabled=$('#blind').disabled=n<2;if(isPublic&&view==='bench'){$('#compare-scene').disabled=$('#blind-scene').disabled=n<2;}
}
function clearSelected(){selected.clear();document.querySelectorAll('.select-image').forEach(x=>x.checked=false);document.querySelectorAll('.card.selected').forEach(x=>x.classList.remove('selected'));updateSelected();}
function reset(){for(const key of ['q',...fields,'sort']) $('#'+key).value=defaults[key];filtered({push:true});}
function updateFilterToggle() {
  const n=fields.filter(k=>$('#'+k).value!==defaults[k]).length;
  const open=$('.tools').classList.contains('filters-open');$('#filter-toggle').textContent=`필터 ${open?'접기':'열기'}${n?' · '+n+'개 적용':''}`;$('#filter-toggle').setAttribute('aria-expanded',String(open));
}
function lockModal(dialog, focus) {
  if(!dialog.open){scrollBefore=window.scrollY;document.body.classList.add('modal-open');dialog.showModal();dialog.querySelector('.close').focus();}
  if(dialog.id==='viewer') viewerFocus=focus||viewerFocus;else compareFocus=focus||compareFocus;
}
function unlockModal(dialog) {
  document.body.classList.remove('modal-open');window.scrollTo(0,scrollBefore);const focus=dialog.id==='viewer'?viewerFocus:compareFocus;if(focus?.isConnected)focus.focus({preventScroll:true});
}
function setPanZoom(pan, next, preserve=true) {
  const before=Number(pan.dataset.zoom||1), z=Math.max(1,Math.min(4,next));
  const rx=preserve?(pan.scrollLeft+pan.clientWidth/2)/(pan.scrollWidth||1):.5,ry=preserve?(pan.scrollTop+pan.clientHeight/2)/(pan.scrollHeight||1):.5;
  pan.dataset.zoom=z;pan.classList.toggle('zoomed',z>1);const surface=pan.querySelector('.zoom-surface');surface.style.width=(z*100)+'%';surface.style.height=(z*100)+'%';
  if(z!==before||!preserve){pan.scrollLeft=Math.max(0,rx*pan.scrollWidth-pan.clientWidth/2);pan.scrollTop=Math.max(0,ry*pan.scrollHeight-pan.clientHeight/2);}
  return z;
}
function viewerSetZoom(z){viewerZoom=setPanZoom($('#view-pan'),z);$('#view-zoom').textContent=Math.round(viewerZoom*100)+'%';}
function evaluationSummary(e) {
  if(!e || typeof e!=='object')return '';
  const labels={unlinked:'연결된 평가 없음',unsupported_legacy_schema:'이전 평가 형식 · 점수 연결 미지원',binding_mismatch:'실행·버전 불일치',image_hash_mismatch:'이미지 해시 불일치',image_unavailable:'평가 이미지 확인 불가',stale_evaluation:'오래된 평가',ambiguous_evaluation:'평가가 여러 개여서 연결 미확정',missing_binding:'실행·버전 근거 부족',linked_no_known_checks:'확인된 문항 없음'};
  if(e.status!=='linked')return labels[e.status]||'평가 연결 미확인';
  const c=e.counts||{}, hash=e.image_verification==='matched'?'이미지 해시 확인':'이미지 해시 미확인';
  const catalog=e.catalog_verification==='matched'?'카탈로그 확인':'카탈로그 검증 미확인';
  return `통과 ${c.PASS||0} · 부분 ${c.PARTIAL||0} · 실패 ${c.FAIL||0} · 미확인 ${c.UNKNOWN||0} / 확인 문항 ${e.known_questions||0}개 기준 100점 환산(부분 0.5, 미확인 제외) · ${hash} · ${catalog} · 평가 규격 ${e.protocol_version||'미확인'}`;
}
function addMeta(list, label, val) {if(val==null||val==='')return;const row=node('div',null,'meta-row');row.append(node('dt',label),node('dd',scalar(val)));list.append(row);}
function openViewer(index, focus) {
  if(!shown.length)return;cursor=(index+shown.length)%shown.length;const x=shown[cursor],img=$('#large');
  $('#image-status').textContent='미리보기 불러오는 중…';img.onload=()=>$('#image-status').textContent='';img.onerror=()=>{$('#image-status').textContent='이미지를 불러오지 못했습니다';};img.src=media(x,'preview');img.alt=title(x);
  $('#viewer-position').textContent=`${cursor+1} / ${shown.length} · 미리보기`;
  $('#view-original').disabled=!media(x,'original');$('#view-original').textContent=isPublic?'원본 크기 보기':'원본 보기';
  const aside=$('#details');aside.replaceChildren();const h=node('h2',title(x));h.id='viewer-title';aside.append(h,node('p',source(x)),node('p',model(x)));
  if(isPublic)aside.append(node('p','메타데이터를 제거한 재인코딩본'));
  const fold=node('details'),summary=node('summary','정보 · 프롬프트 펼치기'),list=node('dl');fold.append(summary,list);
  const b=benchOf(x);for(const [label,val] of [['모델 전체 이름',model(x)],['출처',source(x)],['작성자',x.source_username||x.author],['출처 종류',x.source_kind],...(!isPublic?[['이미지 유형',x.nsfw_level||'미분류']]:[]),['날짜 (카탈로그 created_at)',x.created_at||'미확인'],['세트',b.suite_id||value(x,'job')],['장면',b.scene_label||x.scene_id],['직업',x.occupation],['카테고리',x.category],['카탈로그',x.catalog],['변형',x.variant],['평가',x.rating],['시드',benchValue(x,'seed')],['해상도',b.width!=null&&b.height!=null?`${b.width} × ${b.height}`:'미확인'],['단계',benchValue(x,'steps')],['CFG',benchValue(x,'cfg')],['샘플러',benchValue(x,'sampler')],['스케줄러',benchValue(x,'scheduler')],['체크포인트',benchValue(x,'checkpoint')],['정밀도',benchValue(x,'precision')],['백엔드',benchValue(x,'backend')],['장치',benchValue(x,'device')],['소프트웨어',benchValue(x,'software')],['실행 날짜',benchValue(x,'run_date')],['LoRA',benchValue(x,'loras')],['생성 설정',x.params],['태그',Array.isArray(x.tags)?x.tags.join(' · '):x.tags],['프롬프트',benchValue(x,'prompt')],['부정 프롬프트',benchValue(x,'negative_prompt')],['프롬프트 해시',benchValue(x,'prompt_sha256')],['부정 프롬프트 해시',benchValue(x,'negative_prompt_sha256')],['영문 프롬프트',x.prompt_en],['평가 요약',evaluationSummary(x.evaluation_summary)],['메타데이터 근거',x.metadata_provenance]]) addMeta(list,label,val);
  aside.append(fold);const sourceURL=linkURL(x.source_url);if(sourceURL){const a=node('a','출처 페이지 열기 ↗');a.href=sourceURL;a.target='_blank';a.rel='noopener noreferrer';aside.append(a);}
  lockModal($('#viewer'),focus);viewerZoom=1;setPanZoom($('#view-pan'),1,false);$('#view-zoom').textContent='100%';
}
function navigate(delta){openViewer(cursor+delta);}
function original(){const x=shown[cursor],url=media(x,'original');if(!url)return;$('#image-status').textContent='원본 불러오는 중…';$('#large').src=url;$('#view-original').disabled=true;$('#view-original').textContent=isPublic?'원본 크기 표시 중':'원본 표시 중';$('#viewer-position').textContent=`${cursor+1} / ${shown.length} · ${isPublic?'원본 크기':'원본'}`;viewerSetZoom(1);}
function shuffled(rows){const copy=[...rows];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
function compareIdentity(x){const b=benchOf(x);return [title(x),model(x)==='모델 미확인'?b.model_id:model(x),b.scene_label||x.scene_id,b.seed!=null?'시드 '+b.seed:(x.seed!=null?'시드 '+x.seed:''),x.rating!=null?'평가 '+x.rating:''].filter(Boolean).join(' · ');}
function compareLabel(x,i){return compareBlind&&!revealed?'이미지 '+String.fromCharCode(65+i):compareIdentity(x);}
function conditionParams(value) {
  if(Array.isArray(value))return value.map(conditionParams);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(prompt|positive|negative)/i.test(k)||/hash/i.test(k)).map(([k,v])=>[k,conditionParams(v)]));
  return value;
}
function conditionValue(x,key) {
  const benchDetails=benchOf(x);if(isPublic&&((key==='loras'&&Array.isArray(benchDetails.loras)&&!benchDetails.loras.length)||(key==='negative_prompt'&&benchDetails.negative_prompt==='')))return {text:'사용 안 함',confirmed:true};
  const b=benchOf(x), sourceKey=key==='model_label'?'model_id':key;
  const val=Object.prototype.hasOwnProperty.call(b,sourceKey)?b[sourceKey]:(key==='model_label'?x.model_label:x[key]);
  if(val!=null&&val!==''&&!/^(?:unknown|null|none|미확인|모델 미확인)$/i.test(String(val).trim())&&!(Array.isArray(val)&&!val.length)&&!(typeof val==='object'&&!Object.keys(val).length))return {text:Array.isArray(val)?val.join(' · '):scalar(val),confirmed:true};
  return {text:x.asset_role==='reference'?'해당 없음':'미확인',confirmed:false};
}
function updateConditionComparison() {
  const fold=$('#condition-comparison'),table=$('#condition-table');table.replaceChildren();fold.open=false;
  fold.hidden=compareBlind&&!revealed;if(fold.hidden)return;
  const head=node('thead'),headRow=node('tr');headRow.append(node('th','항목'));
  compareRows.forEach((x,i)=>{const cell=node('th','이미지 '+String.fromCharCode(65+i));cell.scope='col';headRow.append(cell);});headRow.append(node('th','확인된 차이'));head.append(headRow);table.append(head);
  const body=node('tbody');
  for(const [label,key] of (isPublic?[['모델','model_label'],['체크포인트','checkpoint'],['정밀도','precision'],['시드','seed'],['해상도','width'],['세로 해상도','height'],['단계','steps'],['CFG','cfg'],['샘플러','sampler'],['스케줄러','scheduler'],['텍스트 인코더','text_encoders'],['백엔드','backend'],['장치','device'],['소프트웨어','software'],['실행 날짜','run_date'],['프롬프트 해시','prompt_sha256'],['부정 프롬프트','negative_prompt'],['부정 프롬프트 해시','negative_prompt_sha256'],['LoRA','loras']]:[['모델','model_label'],['카탈로그','catalog'],['변형','variant'],['시드','seed'],['장면','scene_id'],['프롬프트 해시','prompt_sha256'],['세트 버전','suite_version'],['생성 설정','params'],['LoRA','loras']])) {
    const vals=compareRows.map(x=>conditionValue(x,key)),row=node('tr'),heading=node('th',label);heading.scope='row';row.append(heading);
    vals.forEach(v=>row.append(node('td',v.text)));
    const known=new Set(vals.filter(v=>v.confirmed).map(v=>v.text)),incomplete=vals.some(v=>!v.confirmed),different=known.size>1;
    const state=node('td',different?'다름':!known.size?'미확인':incomplete?'일부 미확인':'같음');state.className=different?'condition-different':(!known.size||incomplete?'condition-unknown':'');row.append(state);body.append(row);
  }
  table.append(body);
}
function drawCompare() {
  const grid=$('#compare-grid');grid.replaceChildren();grid.classList.toggle('four',compareRows.length>2);activePane=0;
  compareRows.forEach((x,i)=>{
    const item=node('section',null,'compare-item'),pan=node('div',null,'pan'),surface=node('div',null,'zoom-surface'),img=makeImage(x,'preview');
    pan.tabIndex=0;pan.dataset.zoom='1';pan.setAttribute('aria-label',`이미지 ${String.fromCharCode(65+i)} 이동 영역`);img.alt=compareBlind&&!revealed?`비교 이미지 ${String.fromCharCode(65+i)}`:title(x);
    surface.append(img);pan.append(surface);const label=node('div',compareLabel(x,i),'compare-label');item.append(pan,label);grid.append(item);
    const activate=()=>{activePane=i;grid.querySelectorAll('.compare-item').forEach((el,j)=>el.classList.toggle('active',i===j));$('#compare-zoom').textContent=Math.round(Number(pan.dataset.zoom||1)*100)+'%';};
    pan.addEventListener('pointerdown',activate);pan.addEventListener('focus',activate);installPan(pan);
    pan.addEventListener('scroll',()=>syncPan(pan),{passive:true});
  });
  grid.firstElementChild?.classList.add('active');$('#compare-zoom').textContent='100%';$('#reveal').hidden=$('#reshuffle').hidden=!compareBlind;$('#reveal').textContent=revealed?'이름 숨기기':'이름 표시';updateConditionComparison();
}
function openCompare(blind){compareRows=[...selected].map(id=>byId.get(id)).filter(Boolean);if(compareRows.length<2)return;compareBlind=blind;revealed=false;if(blind)compareRows=shuffled(compareRows);drawCompare();lockModal($('#compare-view'),document.activeElement);}
function compareSetZoom(next) {
  const panes=[...$('#compare-grid').querySelectorAll('.pan')],targets=$('#sync-pan').checked?panes:[panes[activePane]];
  targets.forEach(pan=>setPanZoom(pan,next));$('#compare-zoom').textContent=Math.round(Math.max(1,Math.min(4,next))*100)+'%';
}
function syncPan(pan) {
  if(!$('#sync-pan').checked||syncScrolling)return;syncScrolling=true;
  const rx=pan.scrollLeft/Math.max(1,pan.scrollWidth-pan.clientWidth),ry=pan.scrollTop/Math.max(1,pan.scrollHeight-pan.clientHeight);
  $('#compare-grid').querySelectorAll('.pan').forEach(other=>{if(other===pan)return;other.scrollLeft=rx*(other.scrollWidth-other.clientWidth);other.scrollTop=ry*(other.scrollHeight-other.clientHeight);});
  requestAnimationFrame(()=>syncScrolling=false);
}
function installPan(pan) {
  let drag=null;
  pan.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0||Number(pan.dataset.zoom||1)<=1)return;drag={x:event.clientX,y:event.clientY,left:pan.scrollLeft,top:pan.scrollTop};pan.classList.add('dragging');pan.setPointerCapture(event.pointerId);event.preventDefault();});
  pan.addEventListener('pointermove',event=>{if(drag){pan.scrollLeft=drag.left+drag.x-event.clientX;pan.scrollTop=drag.top+drag.y-event.clientY;}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])pan.addEventListener(type,()=>{drag=null;pan.classList.remove('dragging');});
  pan.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const z=Number(pan.dataset.zoom||1)+(event.deltaY<0?.25:-.25);if(pan.id==='view-pan')viewerSetZoom(z);else compareSetZoom(z);},{passive:false});
}
function populate(data) {
  isPublic=data.mode==='public';benchmarkCatalog=data.benchmark&&typeof data.benchmark==='object'?data.benchmark:{};$('#mode').textContent='';
  promptDiagnostics=data.diagnostics?.prompt_comparison_quality||{};
  if(isPublic){$('#q').placeholder='제목·모델·직업·장면 검색';}
  all=(Array.isArray(data.items)?data.items:[]).map((x,i)=>{const date=Date.parse(x.created_at||'');return {...x,image_id:String(x.image_id),_index:i,_date:Number.isFinite(date)?date:-Infinity,_search:[x.title,x.prompt,x.prompt_en,x.model_id,x.model_label,x.catalog,x.source_group,x.source_kind,x.source_ref,x.scene_id,x.occupation,x.category,x.job_id,x.bench_slug,x.exp_id,x.image_id,x.run_id,x.execution_run_uuid,x.source_username,x.author,...(Array.isArray(x.source_relations)?x.source_relations.flatMap(r=>[r.image_id,r.source_ref,r.run_id,r.execution_run_uuid,r.model_label,r.catalog,r.job_id]):[]),...(Array.isArray(x.tags)?x.tags:[])].filter(v=>v!=null).join(' ').toLocaleLowerCase()};});
  byId=new Map(all.map(x=>[x.image_id,x]));
  for(const k of fields.filter(k=>k!=='available')) {
    const values=[...new Set(all.map(x=>value(x,k)).filter(v=>v!==''))].sort((a,b)=>a.localeCompare(b,'ko'));
    const el=$('#'+k);for(const v of values){const levelLabels={SFW:'일상',NSFW:'성인',sfw:'일상',nsfw:'성인',unknown:'미분류',None:'미분류'};const option=node('option',k==='level'?(levelLabels[v]||'미분류'):v);option.value=v;option.title=option.textContent;el.append(option);}
    $(`[data-facet="${k}"]`).hidden=!values.length||(isPublic&&(['level'].includes(k)||values.length<=1));
  }
  $('[data-facet="available"]').hidden=isPublic||!all.some(x=>x.available===false);
  if(!isPublic&&data.diagnostics) {const n=Number(data.diagnostics.missing_images)||0;$('#diag').textContent=n?`파일 확인 필요 ${n.toLocaleString()}건 · 목록은 사용 가능한 이미지 기준`:'';}
  benchmarkCatalog=data.benchmark&&typeof data.benchmark==='object'?data.benchmark:{};
  renderBenchmark(true);readUrl();filtered({url:false});
}
$('#q').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>filtered(),150);});
for(const k of [...fields,'sort'])$('#'+k).addEventListener('change',()=>{clearTimeout(searchTimer);filtered({push:true});});
$('#appreciate').onclick=()=>{setView('appreciate');filtered({push:true});};$('#benchmark').onclick=()=>{setView('bench');filtered({push:true});};$('#prompt-view').onclick=()=>{setView('prompt');renderPrompt(false);filtered({push:true});};for(const id of ['prompt-choice','prompt-seed','prompt-scope'])$('#'+id).addEventListener('change',()=>{renderPrompt(false);writeUrl(true);});$('#prompt-manual-compare').onclick=()=>openCompare(false);$('#prompt-clear-selection').onclick=()=>{clearSelected();renderPrompt(false);};
$('#bench-suite').onchange=()=>{selected.clear();renderBenchmark(false);filtered({push:true});};$('#bench-scene').onchange=()=>{selected.clear();renderBenchmark(false);filtered({push:true});};$('#bench-model').onchange=()=>{renderBenchmark(false);filtered({push:true});};
$('#compare-scene').onclick=()=>openCompare(false);$('#blind-scene').onclick=()=>openCompare(true);
$('#filter-toggle').onclick=()=>{$('.tools').classList.toggle('filters-open');updateFilterToggle();};
$('#reset').onclick=$('#empty-reset').onclick=reset;$('#more').onclick=()=>render();$('#clear-selected').onclick=clearSelected;
$('#compare').onclick=()=>openCompare(false);$('#blind').onclick=()=>openCompare(true);
$('#reshuffle').onclick=()=>{compareRows=shuffled(compareRows);revealed=false;drawCompare();};
$('#reveal').onclick=()=>{revealed=!revealed;$('#compare-grid').querySelectorAll('.compare-item').forEach((item,i)=>{item.querySelector('.compare-label').textContent=compareLabel(compareRows[i],i);item.querySelector('img').alt=compareBlind&&!revealed?`비교 이미지 ${String.fromCharCode(65+i)}`:title(compareRows[i]);});$('#reveal').textContent=revealed?'이름 숨기기':'이름 표시';updateConditionComparison();};
$('#compare-plus').onclick=()=>compareSetZoom(Number($('#compare-grid').querySelectorAll('.pan')[activePane]?.dataset.zoom||1)+.5);
$('#compare-minus').onclick=()=>compareSetZoom(Number($('#compare-grid').querySelectorAll('.pan')[activePane]?.dataset.zoom||1)-.5);
$('#zoom-reset').onclick=()=>{const sync=$('#sync-pan').checked;$('#sync-pan').checked=true;compareSetZoom(1);$('#sync-pan').checked=sync;};
$('#sync-pan').onchange=()=>{if($('#sync-pan').checked){const pan=$('#compare-grid').querySelectorAll('.pan')[activePane];if(pan){compareSetZoom(Number(pan.dataset.zoom||1));syncPan(pan);}}};
$('#view-plus').onclick=()=>viewerSetZoom(viewerZoom+.5);$('#view-minus').onclick=()=>viewerSetZoom(viewerZoom-.5);$('#view-fit').onclick=()=>viewerSetZoom(1);$('#view-original').onclick=original;
$('.prev').onclick=()=>navigate(-1);$('.next').onclick=()=>navigate(1);
for(const dialog of document.querySelectorAll('dialog')){dialog.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>unlockModal(dialog));}
installPan($('#view-pan'));
document.addEventListener('keydown',event=>{const typing=/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)||event.target.isContentEditable;if(typing)return;if($('#viewer').open){if(event.key==='ArrowRight'){event.preventDefault();navigate(1);}if(event.key==='ArrowLeft'){event.preventDefault();navigate(-1);}if(event.key==='+')viewerSetZoom(viewerZoom+.5);if(event.key==='-')viewerSetZoom(viewerZoom-.5);}else if(!$('#compare-view').open&&event.key==='/'){event.preventDefault();$('#q').focus();}});
let touchStart=null;$('#view-pan').addEventListener('touchstart',event=>{touchStart=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
$('#view-pan').addEventListener('touchend',event=>{if(!touchStart||viewerZoom!==1)return;const end=event.changedTouches[0],dx=end.clientX-touchStart.x,dy=end.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)navigate(dx<0?1:-1);},{passive:true});
window.addEventListener('popstate',()=>{clearTimeout(searchTimer);document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());readUrl();filtered({url:false});});
fetch('catalog.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('카탈로그를 불러오지 못했습니다. 새로고침해 주세요.');return response.json();}).then(populate).catch(error=>{$('#count').textContent=error.message;$('#empty').hidden=false;$('#empty strong').textContent='컬렉션을 불러오지 못했습니다.';});
