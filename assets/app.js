'use strict';
const $ = s => document.querySelector(s);
const PAGE = 36;
const semanticAxes = ['subject','style','situation','activity','place','composition','mood','lighting'];
const semanticAxisFallbackLabels = {subject:'대상',style:'표현 방식',situation:'상황',activity:'활동',place:'장소',composition:'구도',mood:'분위기',lighting:'빛·시간'};
const fields = ['source','job','model','catalog','scene','occupation','category','level','rating','role','available',...semanticAxes,'author','aspect','prompt_info','model_info'];
const defaults = {q:'',content_q:'',source:'',job:'',model:'',catalog:'',scene:'',occupation:'',category:'',level:'',rating:'',role:'',subject:'',style:'',situation:'',activity:'',place:'',composition:'',mood:'',lighting:'',author:'',aspect:'',prompt_info:'',model_info:'',available:'available',sort:'recent',view:'explore'};
let all = [], shown = [], isPublic = false, view = 'explore', axis='subject', semanticNode='', cursor = 0, selected = new Set(), facetSelections=new Map(), byId = new Map(), benchmarkCatalog = {}, benchmarkItems = [], promptDiagnostics = {}, shuffleSeed='';
let contentInterpretation = null, semanticExpanded = new Set();
let searchTimer, scrollBefore = 0, viewerFocus, compareFocus, viewerZoom = 1, compareRows = [], viewerRows = [], compareBlind = false, revealed = false, activePane = 0, syncScrolling = false;
let currentBenchmarkModelCount=0;
const scalar = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const node = (tag, text, cls) => {const el = document.createElement(tag);if(text != null) el.textContent=text;if(cls) el.className=cls;return el;};
function source(x) {return scalar(x.source_group || (isPublic ? '로컬 생성' : x.source_kind || '출처 미확인'));}
function usableLabel(value) {const text=scalar(value).trim();return !!text&&!/^(?:unknown|null|none|제목 미확인|모델 미확인)$/i.test(text)&&! /^(?:manual-\d+|job-|run-|file-|gen-|bench-|experiment-|id-)/i.test(text)&&!/^[a-f\d]{16,}$/i.test(text);}
function promptTitle(prompt) {if(!usableLabel(prompt))return '';let text=scalar(prompt).replace(/\s+/g,' ').replace(/^(?:Photograph|Create|Generate|Render) exactly (?:ONE|one) scene\.\s*/i,'');const subject=text.match(/(?:a|an) fictional ([^.]{3,100}?)\s*,?\s*(?:age\s+\d+[, ]+)?working as (?:a|an) ([^.;]+)/i),action=text.match(/(?:Moment and action|Action):\s*([^.;]+)/i);if(subject)return `${subject[2].trim()}${action?` — ${action[1].trim()}`:''}`;text=text.replace(/\b(?:masterpiece|best quality|high quality|ultra[- ]?detailed|8k|4k|highres|photorealistic)\b[, ]*/ig,'');return (text.split(/[.!?](?:\s|$)/,1)[0]||'').slice(0,100).trim();}
function title(x) {const chosen=[x.display_title,x.scene_title,x.title,x.occupation].find(usableLabel)||promptTitle(x.prompt)||x.scene_id;return scalar(chosen||'제목 미확인');}
function model(x) {let raw=(isPublic?benchmarkCatalog.models?.find(m=>String(m.id)===String(x.benchmark?.model_id))?.name:null) || (usableLabel(x.model_label)?x.model_label:null) || (usableLabel(x.model_id)?x.model_id:null) || (['benchmark','experiment','local'].includes(x.source_kind)&&usableLabel(x.catalog)?x.catalog:null);if(raw==null)return '';if(!isPublic&&Array.isArray(raw))return `모델 조합 · ${raw.map(scalar).join(' · ')}`;if(!isPublic&&typeof raw==='string'&&/^\s*\[/.test(raw)){try{const parts=JSON.parse(raw);if(Array.isArray(parts))return `모델 조합 · ${parts.map(scalar).join(' · ')}`;}catch{}}return scalar(raw);}
function value(x, k) {
  const b=benchOf(x);
  return scalar(({source:()=>source(x),job:()=>isPublic?(b.suite_id||''):x.job_id||x.bench_slug||x.exp_id||'',model:()=>isPublic?(b.model_id||model(x)):model(x),catalog:()=>x.catalog,scene:()=>isPublic?(b.scene_key?`${b.suite_id}::${b.scene_key}`:''):x.scene_id,occupation:()=>x.occupation,category:()=>x.category,level:()=>x.nsfw_level||'unknown',rating:()=>x.rating,role:()=>x.asset_role||(isPublic?'generated':'unknown'),author:()=>x.source_username||x.author||'unknown',aspect:()=>{const c=x.benchmark||x._conditions||{},w=Number(c.width||x.width),h=Number(c.height||x.height);return w>0&&h>0?(w/h>1.05?'landscape':w/h<0.95?'portrait':'square'):'unknown';},prompt_info:()=>usableLabel(x.prompt||x.prompt_en||x.benchmark?.prompt||x._conditions?.prompt)?'known':'unknown',model_info:()=>model(x)?'known':'unknown'})[k]?.());
}
function facetValues(x,k){return semanticAxes.includes(k)?(x.semantic?.[k]?.length?x.semantic[k]:['unknown']):[value(x,k)];}
function matchesFacet(x,k,values){const own=new Set(facetValues(x,k)),parents=benchmarkCatalog.semantic_parents?.[k]||{};for(const id of [...own]){const seen=new Set();for(let parent=parents[id];parent&&!seen.has(parent);parent=parents[parent]){seen.add(parent);own.add(parent);}}return [...own].some(v=>values.has(v));}
function labelFor(k,v){if(semanticAxes.includes(k))return benchmarkCatalog.semantic_labels?.[k]?.[v]||v;if(k==='role')return ({generated:'생성 결과',reference:'참고 이미지',unknown:'역할 미확인'})[v]||v;if(k==='aspect')return ({landscape:'가로',portrait:'세로',square:'정사각형',unknown:'크기 미확인'})[v]||v;if(['prompt_info','model_info'].includes(k))return v==='known'?'정보 있음':'정보 미확인';if(k==='author'&&v==='unknown')return '작성자 미확인';if(k==='level')return ({SFW:'일상',NSFW:'성인',sfw:'일상',nsfw:'성인',unknown:'미분류',None:'미분류'})[v]||'미분류';if(k==='job'&&isPublic)return benchmarkCatalog.suites?.find(s=>String(s.id)===String(v))?.title||v;if(k==='model'&&isPublic)return benchmarkCatalog.models?.find(m=>String(m.id)===String(v))?.name||v;if(k==='scene'&&isPublic){const [suite,key]=v.split('::');return benchmarkItems.find(x=>String(benchOf(x).suite_id)===suite&&String(benchOf(x).scene_key)===key)?.benchmark.scene_label||v;}return v;}
function activeSemanticSelections(){return new Map([...facetSelections].filter(([k,values])=>semanticAxes.includes(k)&&values.size).map(([k,values])=>[k,new Set(values)]));}
function matchesContent(x){if(!$('#semantic-query')?.value.trim())return true;if(contentQueryBlocks())return false;return [...contentInterpretation.matches].every(([k,values])=>matchesFacet(x,k,values));}
function readContentInterpretation(){const query=$('#semantic-query')?.value.trim()||'';if(!query)return null;const vocabulary=benchmarkCatalog.semantic_query_aliases||benchmarkCatalog.query_aliases||benchmarkCatalog.semantic_aliases||{};return window.AtlasBrowse?.interpretQuery(query,vocabulary,benchmarkCatalog.semantic_labels||{},benchmarkCatalog.semantic_parents||{})||{matches:new Map(),unresolved:query,recognized:0,unsupportedVocabulary:true};}
function contentQueryBlocks(){return !!$('#semantic-query')?.value.trim()&&(!contentInterpretation||contentInterpretation.unsupportedNegation||contentInterpretation.unsupportedVocabulary||!!contentInterpretation.unresolved||!contentInterpretation.recognized);}
function axisLabel(k){return benchmarkCatalog.semantic_axis_labels?.[k]||semanticAxisFallbackLabels[k]||k;}
function renderContentQueryStatus(){const host=$('#semantic-query-status');if(!host)return;host.textContent='';const query=$('#semantic-query').value.trim();if(!query)return;const interpreted=[...(contentInterpretation?.matches||[])].flatMap(([axis,ids])=>[...ids].map(id=>`${axisLabel(axis)}: ${labelFor(axis,id)}`));if(contentInterpretation?.unsupportedNegation){host.textContent='부정 조건 검색은 아직 지원되지 않아 결과를 표시하지 않습니다.';return;}if(contentInterpretation?.unsupportedVocabulary){host.textContent='의미 검색 사전을 불러오지 못해 결과를 과대포함하지 않도록 표시하지 않습니다.';return;}const parts=[];if(interpreted.length)parts.push(`해석: ${interpreted.join(' · ')}`);if(contentInterpretation?.unresolved)parts.push(`미해석: ${contentInterpretation.unresolved}`);if(!interpreted.length)parts.push('해석 가능한 의미가 없습니다.');if(contentQueryBlocks())parts.push('검색 결과 없음');else parts.push(`${shown.length.toLocaleString()}장 일치`);host.textContent=parts.join(' / ');}
function installSemanticMetadata(data){const keys=['semantic_labels','semantic_parents','semantic_axis_labels','semantic_axis_order','semantic_status_labels','semantic_query_aliases','query_aliases','semantic_aliases'];for(const key of keys)if(data[key]!==undefined)benchmarkCatalog[key]=data[key];benchmarkCatalog.semantic_labels||={};benchmarkCatalog.semantic_parents||={};benchmarkCatalog.semantic_axis_labels||={};benchmarkCatalog.semantic_status_labels||={};for(const option of $('#axis')?.options||[])if(semanticAxes.includes(option.value))option.textContent=axisLabel(option.value);}
function media(x, kind) {
  if (kind === 'thumb') return x.thumb_url || `/media/${encodeURIComponent(x.image_id)}/thumb?size=640`;
  if (kind === 'preview') return x.preview_url || `/media/${encodeURIComponent(x.image_id)}/preview`;
  return x.original_url || (isPublic ? '' : `/media/${encodeURIComponent(x.image_id)}/original?original=1`);
}
function linkURL(raw) {try {const url = new URL(raw);return /^https?:$/.test(url.protocol) ? url.href : null;} catch {return null;}}
function setView(next) {
  if(next==='all'&&semanticNode){const chosen=facetSelections.get(axis)||new Set();chosen.add(semanticNode);facetSelections.set(axis,chosen);semanticNode='';}
  view = next === 'bench' ? 'bench' : (next === 'prompt' && !isPublic ? 'prompt' : (next==='all'?'all':'explore'));
  document.body.classList.toggle('bench', view === 'bench');
  document.body.classList.toggle('prompt-view', view === 'prompt');
  $('#appreciate').setAttribute('aria-pressed', String(view === 'appreciate'));
  $('#appreciate').setAttribute('aria-pressed', String(view === 'explore'));
  $('#all-view').setAttribute('aria-pressed', String(view === 'all'));
  $('#benchmark').setAttribute('aria-pressed', String(view === 'bench'||view === 'prompt'));
  $('#prompt-view').setAttribute('aria-pressed', String(view === 'prompt'));
  $('#prompt-view').hidden = true;
  $('#prompt-view-panel').hidden = view !== 'prompt';
  $('#benchmark-guide').hidden=!(isPublic&&view==='bench');$('#model-information').hidden=!(isPublic&&view==='bench');document.body.classList.toggle('public-benchmark',isPublic&&view==='bench');
  $('#page-title').textContent=view==='prompt'?'모델 결과 비교':(isPublic&&view==='bench'?'모델 비교':view==='all'?'전체 이미지':'이미지 탐색');
  $('#page-description').textContent=view==='prompt'?'장면을 선택하면 카탈로그별 결과를 한눈에 보고, 명시된 튜닝 쌍은 기준·후보로 비교합니다.':(isPublic&&view==='bench'?'같은 장면의 결과를 살펴보고 모델별로 비교합니다.':view==='all'?'전체 이미지에서 조건을 조합해 찾아보세요.':'의미 분류를 따라 이미지를 탐색하세요.');
  $('#explore-panel').hidden=view!=='explore'||isPublic&&view==='bench';document.body.classList.toggle('all-view',view==='all');
  $('#filter-toggle').hidden=isPublic&&view==='bench';
  $('#reset').hidden=isPublic&&view==='bench';
  $('#search-all').hidden=!(isPublic&&view==='bench'&&$('#q').value.trim());$('#q').placeholder=isPublic&&view==='bench'?'이 장면에서 검색':'제목·모델·장면·프롬프트 검색';$('#benchmark').textContent='비교';
}
function privateConditions(x){if(x.asset_role==='reference'&&x.reference_id)return {prompt:x.reference_prompt,negative_prompt:x.reference_negative_prompt,seed:x.reference_seed,steps:x.reference_steps,cfg:x.reference_cfg,sampler:x.reference_sampler,scheduler:x.reference_scheduler,width:x.reference_width,height:x.reference_height,precision:x.reference_precision,checkpoint:x.reference_catalog_model_id,prompt_sha256:x.prompt_sha256};if(x.viewer_conditions)return {...x.viewer_conditions,scene_label:x.scene_title,precision:x.viewer_conditions.precision||x.params?.precision};const m=x.benchmark_map||{},g=m.png_graph_conditions||{},r=m.receipt_conditions||{},p=x.prompt_comparison||{},c=p.execution_config||r.execution_config||{},a=g.samplers?.[0]||{},size=/^(\d+)x(\d+)$/i.exec(m.resolution||'');return {prompt:x.prompt||x.prompt_en||p.prompt,negative_prompt:x.negative_prompt??p.negative_prompt,seed:x.seed??p.seed??m.seed??r.seed??a.seed,steps:p.steps??r.steps??c.steps??a.steps,cfg:p.cfg??r.cfg??c.cfg??a.cfg,sampler:p.sampler??r.sampler??c.sampler_name??a.sampler_name,scheduler:p.scheduler??r.scheduler??c.scheduler??a.scheduler,width:p.width??r.width??c.width??(size?Number(size[1]):null),height:p.height??r.height??c.height??(size?Number(size[2]):null),checkpoint:g.positive_models?.filter(v=>!v.startsWith('LoRA: ')).join(' · '),loras:g.positive_models?.filter(v=>v.startsWith('LoRA: ')).map(v=>v.slice(6)),scene_label:x.scene_title,prompt_sha256:x.prompt_sha256||p.prompt_sha256||m.prompt_sha256};}
const benchOf=x=>x.benchmark&&typeof x.benchmark==='object'?x.benchmark:(x._conditions||{});
const benchGroupKey=(suite,scene)=>JSON.stringify([String(suite??''),String(scene??'')]);
function benchmarkGroups(items){const groups=new Map();for(const x of items){const b=benchOf(x);if(b.suite_id==null||b.suite_id===''||b.scene_key==null||b.scene_key===''||b.model_id==null||b.model_id==='')continue;const key=benchGroupKey(b.suite_id,b.scene_key);if(!groups.has(key))groups.set(key,{suite_id:String(b.suite_id),scene_key:String(b.scene_key),scene_label:String(b.scene_label||'장면 이름 미확인'),items:[]});groups.get(key).items.push(x);}return [...groups.values()];}
function benchValue(x,key){const b=benchOf(x);const v=b[key]??(key==='prompt'?x.prompt:key==='negative_prompt'?x.negative_prompt:key==='prompt_sha256'?x.prompt_sha256:undefined);return v==null||v===''?'미확인':Array.isArray(v)?(v.length?v.join(', '):'미확인'):scalar(v);}
function promptInfo(x){return x.prompt_comparison&&typeof x.prompt_comparison==='object'?x.prompt_comparison:null;}
function conditioningText(kind,value,missing){return kind==='conditioning_zeroout'?'ZeroOut · 인코딩 텍스트 없음':value===''?'빈 텍스트 ("")':value==null?missing:scalar(value);}
const baseFamilyOrder=['krea2','qwen-image-2.1','moss-image','bria-fibo','flux3'];
const baseFamilyLabel=id=>({'krea2':'Krea2','qwen-image-2.1':'Qwen Image 2.1','moss-image':'MOSS','bria-fibo':'Bria FIBO','flux3':'FLUX.3','unknown':'베이스 미확인'})[id]||id;
function compareBaseFamilies(a,b){const rank=x=>baseFamilyOrder.includes(x)?baseFamilyOrder.indexOf(x):baseFamilyOrder.length;return rank(a)-rank(b)||String(a).localeCompare(String(b),'ko');}
function promptGroups(){const groups=new Map();for(const x of all){const p=promptInfo(x);if(!p?.match_verified||!p.prompt_sha256||!p.prompt)continue;const id=p.scope==='reproduction'?`${p.prompt_sha256}|reproduction|${p.prompt_label}`:p.prompt_sha256;if(!groups.has(id))groups.set(id,{id,hash:p.prompt_sha256,prompt:p.prompt,label:p.prompt_label||'',items:[],expected:new Set(),expectedTuning:new Map()});const g=groups.get(id);g.items.push(x);for(const c of p.expected_catalogs||[])g.expected.add(String(c));for(const pair of p.expected_tuning_arms||[])g.expectedTuning.set(String(pair.catalog||pair.pair),new Set(pair.arms||[]));if(p.prompt_label&&!g.label)g.label=p.prompt_label;}return [...groups.values()];}
const referenceSceneLabels={'CIV-138945082':'SAT · 붉은 복면 인물','CIV-138944952':'SAT · 헬리콥터 장면','CIV-145782224':'FLUX · 포스터','CIV-145782225':'FLUX · 여우','CIV-145881758':'MOSS SFT · 운동화','CIV-145881762':'MOSS SFT · 식물 도감','CIV-146222320':'MOSS Imagine · 외계인','CIV-146223793':'MOSS Imagine · 헤드폰 제품','CIV-143630633':'Krealism · 앨리스 카페','CIV-143630994':'Krealism · 검은 옷 인물 사진','CIV-138029959':'Asian Utopian · 기타 연주','CIV-138029965':'Asian Utopian · 해변의 원피스 인물','CIV-146114216':'Moody MOSS v1 · 초밥집','CIV-146114227':'Moody MOSS v1 · 베이커리','CIV-146542606':'Moody MOSS v2 · 학과 산수화','CIV-146542607':'Moody MOSS v2 · 영문·중문 글자 포스터','CIV-146504028':'Dirty MOSS · 자동차 옆 거리 사진','CIV-146504069':'Dirty MOSS · 농구공과 세 사람','CIV-142853465':'IntoRealism · 두 가지 머리색 인물','CIV-142852175':'IntoRealism · 클럽 DJ','CIV-137002588':'Redcraft · 프레넬 렌즈 포스터','CIV-137002574':'Redcraft · 들판의 손 원근','CIV-140548392':'Soliloquy · 우주비행사','CIV-140548401':'Soliloquy · 배달원','CIV-139095151':'Moody Krea2 · 해변','CIV-139095150':'Moody Krea2 · 자카란다','CIV-144285039':'Noct Q · 시장의 흰 원피스 인물','CIV-143430906':'Qwen Image 2.1 · 붉은 종이접기','CIV-144492854':'Qwen Image 2.1 · 눈 오는 날 인물','CIV-145303466':'RED Qwen · 원본 재현 비교'};
function referenceSceneLabel(g){const ref=g.items.find(x=>promptInfo(x).scope==='job4794-reference'&&x.asset_role==='reference'),p=ref&&promptInfo(ref);return referenceSceneLabels[p?.reference_id]||String(p?.prompt||g.label).split(/[.!?。\n]/,1)[0].slice(0,72);}
function promptGroupLabel(g){if(g.items.some(x=>promptInfo(x).scope==='reproduction'))return `Moody · ${g.label==='anchor-01'?'01 · 스튜디오': '02 · 경극'} 원본 재현`;if(g.items.some(x=>promptInfo(x).scope==='job4794-reference'))return `원본 비교 · ${referenceSceneLabel(g)}`;const names={P1:'공통 프롬프트 · P1 카페 사진',A1:'공통 프롬프트 · A1 애니메이션 일러스트',P2:'공통 프롬프트 · P2 패션 사진',A2:'공통 프롬프트 · A2 애니메이션 장면'};return names[g.label]||`공통 프롬프트 · ${g.label||'프롬프트'} · ${g.hash.slice(0,12)}`;}
let promptSelectionContext='';
function job4794GeneratedCard(x,equivalent){
  const p=promptInfo(x),card=node('article',null,'prompt-card');
  const sourceNegative=conditioningText(p.source_negative_kind,p.source_negative_prompt,'원본 미기록');
  const effectiveNegative=conditioningText(p.effective_negative_kind,p.negative_prompt,'텍스트 없음 또는 미확인');
  const armLabel=p.comparison_role==='기록 프롬프트 비교'?'기록 프롬프트 비교 · 원본 최종 caption 미확인':({baseline:'기준',candidate:'후보',generated:'비교 결과',direct_target:'목표 원본'})[p.arm||p.comparison_role]||'비교 결과';
  card.append(node('h3',`${armLabel} · ${p.sampler||'샘플러 미확인'}/${p.scheduler||'스케줄러 미확인'} · ${p.source_seed_match?'원본 seed':'안정성 추가 seed'} ${p.seed}`));
  const open=node('button',null,'image-open');open.type='button';
  open.setAttribute('aria-label',`${p.reference_id} ${p.comparison_role||p.catalog} seed ${p.seed} 생성 결과 확대`);
  open.append(makeImage(x,'thumb'));open.onclick=()=>openViewerRows([x],0,open);card.append(open);
  card.append(node('p',`${p.catalog} · release ${p.release_id||'미기록'} · ${p.steps??'?'} steps · CFG ${p.cfg??'?'} · ${p.sampler||'?'} / ${p.scheduler||'?'} · ${p.width}×${p.height}`,'prompt-meta'));
  const fold=node('details');fold.append(node('summary','조건 차이·실효 설정·실행 관계'));
  const relation=equivalent?`\n같은 source+seed의 별도 arm(${promptInfo(equivalent).comparison_role})은 PNG SHA-256과 실효 graph SHA-256이 같아 중복 타일을 생략했습니다. 실행 근거: ${equivalent.metadata_provenance}`:'';
  const phase=p.comparison_role==='Imagine 기본값 확인'
    ?'\n기본값 confirmation PNG/graph 검증 완료. 최종 visual 품질 판정은 별도 대기.'
    :/Imagine/i.test(String(p.catalog))?'\n원본 설정의 생성 검증 완료. 기본값 confirmation 결과는 별도 카드/관계로 구분.'
    :/production|적용 후/i.test(String(p.comparison_role))?'\n품질 근거: JOB-4794 wave04 manager visual review에서 production 적용 설정으로 확인됨.':'';
  fold.append(node('p',`${p.diagnostic_status?`실행 메모: ${p.diagnostic_status}\n`:''}${p.condition_differences.join(' · ')}\n원본 확인된 조건 차이: ${(p.source_condition_facts||[]).join(' · ')||'추가 상세 미기록'}\nSource negative (${p.source_negative_kind||'kind 미확인'}): ${sourceNegative}\nEffective positive (${p.positive_conditioning_kind||'kind 미확인'}): ${p.prompt}\nEffective negative (${p.effective_negative_kind||'kind 미확인'}): ${effectiveNegative}\n요청 negative 실제 graph 일치: ${p.actual_negative_matches_expected==null?'미검증':p.actual_negative_matches_expected?'일치':'불일치'}\n실효 graph SHA-256 ${p.effective_graph_sha256}\n실효 graph: ${JSON.stringify(p.effective_graph)}\nSource graph: ${p.source_fullgraph||'미확인'} · exact source generator 증명 없음\nPNG SHA-256 ${p.png_sha256}${phase}${relation}\n${x.metadata_provenance}`));
  card.append(fold);const add=node('button',selected.has(x.image_id)?'선택됨':'비교 선택','quiet');add.type='button';
  add.onclick=()=>addPromptManual(x);card.append(add);return card;
}
function renderComparisonBoard(group,seed,scope,rows){
  const host=$('#prompt-results');host.replaceChildren();host.classList.remove('direct-comparison','direct-comparison-three');host.classList.add('family-groups');
  const context=`${group.id}|${seed}`;
  if(context!==promptSelectionContext){selected.clear();promptSelectionContext=context;}
  else {const valid=new Set(rows.map(x=>x.image_id));selected=new Set([...selected].filter(id=>valid.has(id)));}
  updatePromptManual();$('#prompt-reference').hidden=true;
  const reproduction=rows.some(x=>promptInfo(x).scope==='reproduction');
  const job4794=rows.some(x=>promptInfo(x).scope==='job4794-reference');
  let usable=rows.filter(x=>reproduction?promptInfo(x).scope==='reproduction':job4794?promptInfo(x).scope==='job4794-reference'&&x.asset_role==='generated':promptInfo(x).scope==='catalog'||promptInfo(x).scope==='tuning');
  let historicalDiagnostics=[];
  if(job4794){historicalDiagnostics=usable.filter(x=>promptInfo(x).comparison_status==='historical_diagnostic_only');usable=usable.filter(x=>promptInfo(x).comparison_status!=='historical_diagnostic_only');}
  const hiddenEquivalentRuns=new Map();
  if(job4794){const unique=new Map();for(const x of usable){const p=promptInfo(x),key=[p.reference_id,p.seed,p.png_sha256,p.effective_graph_sha256].join('|');if(unique.has(key)){const prior=unique.get(key);if(/적용 후|production|기본값 확인/i.test(p.comparison_role||'')){hiddenEquivalentRuns.set(x.image_id,prior);unique.set(key,x);}else hiddenEquivalentRuns.set(prior.image_id,x);}else unique.set(key,x);}usable=[...unique.values()];}
  $('#prompt-summary').textContent=reproduction
    ? `원본 프롬프트·시드 ${seed} 재현 · 생성 설정은 원본과 다를 수 있습니다.`
    : job4794?`${referenceSceneLabel(group)} · 기준 시드 ${seed} · ${usable.length}개 비교 결과 · 원본 조건 일부 미기록`: `Positive 동일 · 시드 ${seed} · 설정은 모델별로 다릅니다. ${new Set(usable.map(x=>String(promptInfo(x).comparison_catalog||promptInfo(x).catalog))).size}개 카탈로그 · ${usable.length}개 결과 · 직접 목표 원본 없음`;
  const source=node('details',null,'prompt-source');source.append(node('summary',reproduction?'원본 재현 문맥·출처':'프롬프트 원문과 비교 정보'));
  source.append(node('p',group.prompt,'prompt-text'));if(!reproduction&&group.label.startsWith('A')){const refs=styleReferences(null);if(refs)source.append(refs);}$('#prompt-summary').after(source);
  if(job4794){
    const target=rows.find(x=>promptInfo(x).scope==='job4794-reference'&&x.asset_role==='reference');
    host.classList.add('direct-comparison');host.classList.toggle('direct-comparison-three',usable.length>1);
    if(target){const p=promptInfo(target),card=node('article',null,'prompt-card direct-reference-card');card.append(node('h3',`목표 원본 · ${referenceSceneLabel(group)}`));const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label','실제 목표 원본 확대');open.append(makeImage(target,'thumb'));open.onclick=()=>openViewerRows([target],0,open);card.append(open,node('p',`원본 · ${p.catalog||'모델 정보 미확인'} · 버전 ${p.source_model_version_id??'미기록'} · 시드 ${p.reference_seed??'미기록'}`,'prompt-meta'));
      const sourceLink=linkURL(p.reference_source_url);if(sourceLink){const link=node('a','원본 출처 ↗');link.href=sourceLink;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
      const fold=node('details');fold.append(node('summary','원본 조건·연결 증거'));fold.append(node('p',`모델 버전: ${p.source_model_version_id??'미기록'} · 정밀도: ${p.source_precision||'미확인'}\n${p.source_steps??'?'} steps · CFG ${p.source_cfg??'?'} · ${p.source_sampler||'샘플러 미기록'} / ${p.source_scheduler||'원본 스케줄러 미공개'}\nNegative (${p.source_negative_kind||'kind 미확인'}): ${conditioningText(p.source_negative_kind,p.source_negative_prompt,'원본 미기록')}\n${p.source_prompt_status||''}\nSource positive 원문: ${p.source_prompt_verbatim||p.prompt}\n비교 prompt: ${p.prompt}\nSource condition facts: ${(p.source_condition_facts||[]).join(' · ')||'미기록'}\nsource hash: ${p.source_sha256}\nsource fullgraph: ${p.source_fullgraph}\nexact source-generator 증명: 없음`));card.append(fold);host.append(card);}
    host.append(node('h2','기준 · 후보 비교','direct-comparison-heading'));
    const pairOrder={baseline:0,candidate:1};const conditioningRank=x=>promptInfo(x).actual_negative_matches_expected===true?0:promptInfo(x).actual_negative_matches_expected===false?1:2;usable.sort((a,b)=>conditioningRank(a)-conditioningRank(b)||(pairOrder[promptInfo(a).arm]??2)-(pairOrder[promptInfo(b).arm]??2));
    for(const x of usable)host.append(job4794GeneratedCard(x,hiddenEquivalentRuns.get(x.image_id)));
    if(historicalDiagnostics.length){const history=node('details',null,'prompt-history-diagnostics');history.append(node('summary',`원본 비교에서 제외한 실행 기록 (${historicalDiagnostics.length})`),node('p','실효 negative conditioning이 source 조건과 불일치하여 기본 비교에서 제외했습니다. 파일·PNG·실행 이력은 보존되어 있습니다.'));for(const x of historicalDiagnostics)history.append(job4794GeneratedCard(x));host.append(history);}
    return;
  }
  if(reproduction){
    const sample=usable[0],p=promptInfo(sample),ref=byId.get(p.reference_image_id);
    if(ref){const box=$('#prompt-reference');box.hidden=false;box.replaceChildren();box.append(node('strong','직접 목표 원본 · Moody Krea 2 Mix V7.0'));
      const pair=node('div',null,'direct-pair');
      for(const [item,label] of [[ref,`원본 · ${p.reference_width}×${p.reference_height}`],[sample,`재현 · ${p.width}×${p.height}`]]){
        const card=node('div',null,'direct-image');card.append(node('h3',label));const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',`${label} 확대`);open.append(makeImage(item,'thumb'));open.onclick=()=>openViewerRows([item],0,open);card.append(open);pair.append(card);
      }
      box.append(pair,node('p',`해상도 ${p.reference_width}×${p.reference_height} → ${p.width}×${p.height} · 시드 ${p.seed} · ${p.steps} steps · CFG ${p.cfg} · ${p.sampler} / ${p.scheduler} · 워크플로 차이는 생성 정보에서 확인`));if(p.catalog==='krea2-moody'){const identity=node('details');identity.append(node('summary','체크포인트 동일성·스튜디오 제외 이력'));identity.append(node('p','원본 target: Civitai version 3209007. 현재 local BF16: version 3209040이며 정밀도/버전이 일치하지 않습니다. exact-source/pixel 재현으로 보지 않습니다. 이전 studio 제외 표시는 유지하며 해당 이미지·기록은 삭제하지 않았습니다. 근거: JOB-4794 manager-identity-finding.json.'));box.append(identity);}const sourceLink=linkURL(p.source_url);if(sourceLink){const link=node('a','원본 출처 열기 ↗');link.href=sourceLink;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
      const compare=node('button','원본과 재현 확대 비교','quiet');compare.type='button';compare.onclick=()=>{compareRows=[ref,sample];compareBlind=false;revealed=false;drawCompare();$('#compare-grid .compare-label').textContent='목표 원본';$('#compare-grid .compare-item:last-child .compare-label').textContent='원본 프롬프트·시드 재현';lockModal($('#compare-view'),compare);};box.append(compare);
    }
    const card=node('article',null,'prompt-card');card.append(node('h3',`${baseFamilyLabel(p.base_family)} · ${p.catalog} · 원본 프롬프트/시드 재현`));
    card.append(node('p','긍정 프롬프트와 시드는 원본과 일치합니다. 해상도·워크플로 조건은 다릅니다.','prompt-meta'));
    const detail=node('details');detail.append(node('summary','생성 설정·프롬프트 출처'));detail.append(node('p',`${p.checkpoint||'체크포인트 미확인'} · ${p.steps} steps · CFG ${p.cfg} · ${p.sampler}/${p.scheduler} · ${p.width}×${p.height}\n${p.condition_differences?.join('\n')||'조건 차이 미기록'}\nPositive: ${p.prompt}\nNegative: ${p.negative_prompt===''?'사용 안 함':p.negative_prompt??'미기록'}\n${sample.metadata_provenance}`));card.append(detail);host.append(card);return;
  }
  const byCatalog=new Map();for(const x of usable){const p=promptInfo(x),catalog=String(p.comparison_catalog||p.catalog);if(!byCatalog.has(catalog))byCatalog.set(catalog,[]);byCatalog.get(catalog).push(x);}
  const families=new Map();
  for(const [catalog,assets] of byCatalog){const p0=promptInfo(assets[0]),family=p0.base_family||'unknown';if(!families.has(family))families.set(family,[]);
    if(scope==='tuning'){
      const card=node('article',null,'prompt-card tuning-card');card.append(node('h3',catalog));
      const pairs=new Map(),recovered=[];
      for(const x of assets){const px=promptInfo(x);if(px.role==='runtime_recovered'){recovered.push(x);continue;}if(!px.pair_id||!['baseline','candidate'].includes(px.role))continue;if(!pairs.has(px.pair_id))pairs.set(px.pair_id,{});pairs.get(px.pair_id)[px.role]=x;}
      for(const [pairId,arms] of pairs){const pair=node('div',null,'tuning-pair');for(const role of ['baseline','candidate']){const x=arms[role],cell=node('div',null,'tuning-arm');cell.append(node('strong',role==='baseline'?'기준':'후보'));if(x){const px=promptInfo(x),open=node('button',null,'image-open');open.type='button';open.append(makeImage(x,'thumb'));open.onclick=()=>openViewerRows([x],0,open);cell.append(open,node('p',`${px.cfg==null?'CFG 미기록':`CFG ${px.cfg}`} · ${px.width??'?'}×${px.height??'?'}`));const choose=node('button',selected.has(x.image_id)?'선택됨':'비교 선택','quiet');choose.type='button';choose.onclick=()=>addPromptManual(x);cell.append(choose);}else cell.append(node('div','해당 arm 결과 없음','prompt-missing'));pair.append(cell);}
        const compare=node('button','이 쌍 바로 비교','quiet');compare.type='button';compare.onclick=()=>{if(!arms.baseline||!arms.candidate)return;compareRows=[arms.baseline,arms.candidate];compareBlind=false;revealed=false;drawCompare();lockModal($('#compare-view'),compare);};card.append(pair,node('p',tuningChanges(arms),'tuning-diff'),compare);
      }
      if(recovered.length){const fold=node('details');fold.append(node('summary',`접힌 단일 기능 복구 ${recovered.length}개`));for(const x of recovered){const px=promptInfo(x),row=node('div',null,'prompt-extra');row.append(node('span',`기능 복구 · ${px.cfg==null?'CFG 미기록':`CFG ${px.cfg}`} · ${px.width??'?'}×${px.height??'?'}`));const open=node('button','결과 보기','quiet');open.type='button';open.onclick=()=>openViewerRows([x],0,open);row.append(open);fold.append(row);}card.append(fold);}
      families.get(family).push(card);continue;
    }
    const card=node('article',null,'prompt-card');const pool=assets.filter(x=>promptInfo(x).scope==='catalog');
    const canonical=pool[0]||assets.find(x=>promptInfo(x).role==='baseline')||assets[0];
    const p=promptInfo(canonical);card.append(node('h3',catalog));card.append(node('p',`${baseFamilyLabel(family)} · ${p.role==='catalog_reference'?'카탈로그 기준':p.role==='baseline'?'튜닝 기준':p.role==='runtime_recovered'?'복구 후 결과':'후보'} · ${p.width??'?'}×${p.height??'?'}`,'prompt-meta'));
    const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',`${catalog} 결과 확대`);open.append(makeImage(canonical,'thumb'));open.onclick=()=>openViewerRows([canonical],0,open);card.append(open);const info=node('details');info.append(node('summary','생성 정보'));info.append(node('p',`Positive 동일 · Negative: ${p.negative_prompt==null?'미기록':p.negative_prompt===''?'사용 안 함':p.negative_prompt}\n${p.steps??'단계 미기록'} steps · CFG ${p.cfg??'미기록'} · ${p.sampler||'샘플러 미기록'} / ${p.scheduler||'스케줄러 미기록'} · ${p.width??'?'}×${p.height??'?'}\n실행: ${p.run_key||'미기록'} · ${canonical.metadata_provenance||'출처 설명 미기록'}`));card.append(info);
    const add=node('button',selected.has(canonical.image_id)?'선택됨':'비교 선택','quiet');add.type='button';add.onclick=()=>addPromptManual(canonical);card.append(add);
    const extra=assets.filter(x=>x!==canonical);
    if(extra.length){const fold=node('details');fold.append(node('summary',`다른 실행 ${extra.length}개`));for(const x of extra){const px=promptInfo(x),row=node('div',null,'prompt-extra');row.append(node('span',`${px.role==='candidate'?'튜닝 후보':px.role==='runtime_recovered'?'단일 기능 복구':'추가 기준'} · ${px.width??'?'}×${px.height??'?'}`));const view=node('button','보기','quiet');view.type='button';view.onclick=()=>openViewerRows([x],0,view);row.append(view);if(px.pair_id&&['baseline','candidate'].includes(px.role)){const partner=assets.find(y=>y!==x&&promptInfo(y).pair_id===px.pair_id&&promptInfo(y).role!==(px.role));if(partner){const pair=node('button','전후 비교','quiet');pair.type='button';pair.onclick=()=>{compareRows=[x,partner];compareBlind=false;revealed=false;drawCompare();lockModal($('#compare-view'),pair);};row.append(pair);}}fold.append(row);}card.append(fold);}
    const refs=styleReferences(catalog);if(refs)card.append(refs);
    families.get(family).push(card);
  }
  for(const [family,cards] of [...families].sort(([a],[b])=>compareBaseFamilies(a,b))){const section=node('section',null,'prompt-family');section.append(node('h2',`${baseFamilyLabel(family)} · ${cards.length}개 카탈로그`));const grid=node('div',null,'prompt-results prompt-family-grid');cards.forEach(c=>grid.append(c));section.append(grid);host.append(section);}
}
function setPromptOptions(restore){
  const groups=promptGroups(),select=$('#prompt-choice'),params=new URLSearchParams(location.search),wanted=restore?params.get('prompt_id'):select.value;
  select.replaceChildren();
  const common=groups.filter(g=>['P1','A1','P2','A2'].includes(g.label)).sort((a,b)=>['P1','A1','P2','A2'].indexOf(a.label)-['P1','A1','P2','A2'].indexOf(b.label));
  const direct=groups.filter(g=>g.items.some(x=>promptInfo(x).scope==='reproduction')).sort((a,b)=>a.label.localeCompare(b.label));
  const other=groups.filter(g=>!common.includes(g)&&!direct.includes(g));
  const reference=other.filter(g=>g.items.some(x=>promptInfo(x).scope==='job4794-reference')),misc=other.filter(g=>!reference.includes(g));
  for(const [label,list] of [['공통 프롬프트',common],['원본 비교',reference],['원본 재현',direct],['기타 테스트',misc]]){if(!list.length)continue;const box=node('optgroup');box.label=label;for(const g of list){const o=node('option',promptGroupLabel(g));o.value=g.id;o.title=g.prompt;box.append(o);}select.append(box);}
  select.value=groups.some(g=>g.id===wanted)?wanted:(common[0]?.id||groups[0]?.id||'');
  const chosen=groups.find(g=>g.id===select.value),seeds=[...new Set((chosen?.items||[]).map(x=>String(promptInfo(x).seed??'')).filter(Boolean))].sort((a,b)=>Number(a)-Number(b));
  const seed=$('#prompt-seed'),wantedSeed=restore?params.get('seed'):seed.value;seed.replaceChildren();for(const v of seeds){const o=node('option',v);o.value=v;seed.append(o);}seed.value=seeds.includes(wantedSeed)?wantedSeed:(seeds.includes('31031')?'31031':seeds[0]||'');
  const scope=$('#prompt-scope'),wantedScope=restore?params.get('scope'):scope.value;scope.disabled=!!chosen?.items.some(x=>['reproduction','job4794-reference'].includes(promptInfo(x).scope));scope.value=wantedScope==='tuning'&&!scope.disabled?'tuning':'all';
}
function promptCondition(p){return `${p.steps??'—'} steps · CFG ${p.cfg??'—'} · ${p.sampler||'샘플러 미확인'} · ${p.width??'?'} × ${p.height??'?'}`;}
function tuningChanges(arms){if(!arms.baseline||!arms.candidate)return '예상 기준·후보 중 실제 결과가 없어 변경값을 확정할 수 없습니다.';const a=promptInfo(arms.baseline),b=promptInfo(arms.candidate),fields=[['단계','steps'],['CFG','cfg'],['샘플러','sampler'],['스케줄러','scheduler'],['정밀도','precision'],['체크포인트','checkpoint']];const changes=fields.filter(([,key])=>a[key]!==b[key]).map(([label,key])=>`${label} ${a[key]??'미기록'} → ${b[key]??'미기록'}`);if(a.width!==b.width||a.height!==b.height)changes.push(`해상도 ${a.width??'?'}×${a.height??'?'} → ${b.width??'?'}×${b.height??'?'}`);if(a.negative_prompt!==b.negative_prompt)changes.push('Negative prompt 변경');return changes.length?`변경: ${changes.join(' · ')}`:'기록된 실행 설정 차이 없음';}
function updatePromptManual(){
  const n=selected.size,tray=$('#prompt-manual-count').parentElement;tray.hidden=n===0;
  $('#prompt-manual-count').textContent=`선택 ${n} / 4`;$('#prompt-manual-compare').disabled=n<2||n>4;
  let blind=$('#prompt-manual-blind');if(!blind){blind=node('button','블라인드 비교','quiet');blind.id='prompt-manual-blind';blind.type='button';blind.onclick=()=>openCompare(true);tray.insertBefore(blind,$('#prompt-clear-selection'));}blind.disabled=n<2||n>4;
}
function addPromptManual(x){if(selected.has(x.image_id)){selected.delete(x.image_id);}else if(selected.size>=4){$('#prompt-manual-count').textContent='최대 4장입니다. 선택을 먼저 해제해 주세요.';return;}else selected.add(x.image_id);updatePromptManual();renderPrompt(false);}
function styleReferences(catalog){
  const refs=all.filter(x=>x.asset_role==='reference'&&x.source_kind==='reference'&&x.reference_id&&(catalog?x.reference_catalog_model_id===catalog:!x.reference_catalog_model_id&&x.reference_common_board));
  if(!refs.length)return null;
  const fold=node('details',null,'style-references');fold.append(node('summary',catalog?`모델 스타일 참고 ${refs.length}개`:`공통 미감 참고 ${refs.length}개`));fold.append(node('p','스타일 참고 자료이며, 이 공통 프롬프트 결과의 목표 원본은 아닙니다.','prompt-meta'));
  for(const ref of refs){const row=node('div',null,'style-reference-row'),open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',`${ref.reference_id} 스타일 참고 확대`);open.append(makeImage(ref,'thumb'));open.onclick=()=>openViewerRows([ref],0,open);row.append(open);
    const info=node('div');info.append(node('p',`${ref.reference_id} · 모델 버전 ${ref.reference_model_version_id??'미기록'} · ${ref.reference_width??'?'}×${ref.reference_height??'?'}`));
    const source=linkURL(ref.reference_source_url);if(source){const a=node('a','참고 출처 ↗');a.href=source;a.target='_blank';a.rel='noopener noreferrer';info.append(a);}row.append(info);fold.append(row);
  }return fold;
}
function renderPrompt(restore=false){if(isPublic)return;setPromptOptions(restore);const group=promptGroups().find(g=>g.id===$('#prompt-choice').value),seed=$('#prompt-seed').value,scope=$('#prompt-scope').value;const rows=(group?.items||[]).filter(x=>(promptInfo(x).scope==='job4794-reference'&&x.asset_role==='reference'||String(promptInfo(x).seed??'')===seed)&&(scope==='all'||promptInfo(x).scope===scope));rows.sort((a,b)=>{const x=promptInfo(a),y=promptInfo(b);return compareBaseFamilies(x.base_family||'unknown',y.base_family||'unknown')||String(x.comparison_catalog||x.catalog).localeCompare(String(y.comparison_catalog||y.catalog),'ko',{numeric:true})||({baseline:0,기본:0,enhancer:1,candidate:2}[x.variant]??3)-({baseline:0,기본:0,enhancer:1,candidate:2}[y.variant]??3)||String(x.job_id).localeCompare(String(y.job_id));});shown=rows;document.querySelectorAll('.prompt-source').forEach(el=>el.remove());$('#prompt-summary').replaceChildren();if(!group){$('#prompt-summary').textContent='실제 positive prompt가 확인된 비교 자료가 없습니다.';$('#prompt-reference').hidden=true;return;}renderComparisonBoard(group,seed,scope,rows);if(restore){const params=new URLSearchParams();params.set('view','prompt');params.set('prompt_id',group.id);if(seed)params.set('seed',seed);params.set('scope',scope);history.replaceState(null,'',location.pathname+'?'+params.toString()+location.hash);}}
function fillSelect(el,values,placeholder){el.replaceChildren();const first=node('option',placeholder);first.value='';el.append(first);for(const [v,label] of values){const o=node('option',label);o.value=v;el.append(o);}}
function renderBenchmark(restore=true){if(!isPublic)return;benchmarkItems=all.filter(x=>x.benchmark&&typeof x.benchmark==='object');const groups=benchmarkGroups(benchmarkItems),suite=$('#bench-suite'),scene=$('#bench-scene'),modelSelect=$('#bench-model');
  const suites=[...new Set(groups.map(g=>g.suite_id))],wantedSuite=restore?new URLSearchParams(location.search).get('suite'):suite.value;fillSelect(suite,suites.map(id=>[id,benchmarkCatalog.suites?.find(s=>String(s.id)===id)?.title||id]),'테스트 세트 선택');suite.value=suites.includes(wantedSuite)?wantedSuite:(suites[0]||'');
  const suiteGroups=groups.filter(g=>g.suite_id===suite.value),wantedScene=restore?new URLSearchParams(location.search).get('scene_key'):scene.value;fillSelect(scene,suiteGroups.map(g=>[g.scene_key,g.scene_label]),'비교 장면 선택');scene.value=suiteGroups.some(g=>g.scene_key===wantedScene)?wantedScene:(suiteGroups[0]?.scene_key||'');
  const group=suiteGroups.find(g=>g.scene_key===scene.value),models=[...new Set((group?.items||[]).map(x=>String(benchOf(x).model_id)))];const wantedModel=restore?new URLSearchParams(location.search).get('bench_model'):modelSelect.value;fillSelect(modelSelect,models.map(id=>[id,benchmarkCatalog.models?.find(m=>String(m.id)===id)?.name||id]),'모든 모델');modelSelect.value=models.includes(wantedModel)?wantedModel:'';
  const groupModelCount=new Set((group?.items||[]).map(x=>String(benchOf(x).model_id))).size;currentBenchmarkModelCount=groupModelCount;$('#compare-scene').disabled=$('#blind-scene').disabled=groupModelCount<2;$('#bench-counts').textContent=`${benchmarkItems.length}개 이미지 · ${new Set(benchmarkItems.map(x=>benchOf(x).model_id)).size}개 모델 · ${groups.length}개 비교 장면`;
  const suiteInfo=benchmarkCatalog.suites?.find(s=>String(s.id)===suite.value);$('#benchmark-introduction').textContent=benchmarkCatalog.benchmark?.introduction||benchmarkCatalog.introduction||suiteInfo?.description||'테스트 장면을 골라 모델별 결과를 비교합니다.';
  $('#bench-environment').textContent='기록된 환경: ComfyUI 생성 그래프 · 당시 GPU/드라이버/소프트웨어 버전은 미확인. 설정별 결과 비교이며 정량 순위가 아닙니다.';const method=$('#bench-method-content');method.replaceChildren();if(suiteInfo?.description)method.append(node('p',suiteInfo.description));for(const line of [...(suiteInfo?.notes||[]),...(benchmarkCatalog.benchmark?.methodology||benchmarkCatalog.methodology||[]),...(benchmarkCatalog.benchmark?.limitations||benchmarkCatalog.limitations||[])])method.append(node('p',line));if(benchmarkCatalog.benchmark?.environment_note||benchmarkCatalog.environment_note)method.append(node('p','테스트 환경: '+(benchmarkCatalog.benchmark?.environment_note||benchmarkCatalog.environment_note)));
  const cards=$('#model-cards');cards.replaceChildren();const definitions=benchmarkCatalog.models||[];for(const id of [...new Set((group?.items||[]).map(x=>String(benchOf(x).model_id)))]){const def=definitions.find(m=>String(m.id)===id)||{},card=node('article',null,'model-card');card.append(node('h3',def.name||id));card.append(node('p',`${def.family||'계열 미확인'} · ${def.precision||'정밀도 미확인'} · ${def.checkpoint||'체크포인트 미확인'}`));if(def.notes)card.append(node('p',def.notes));const sample=benchOf(group.items.find(x=>String(benchOf(x).model_id)===id)||{});card.append(node('p',`${sample.steps??'미확인'} steps · CFG ${sample.cfg??'미확인'} · ${sample.width??'?'} × ${sample.height??'?'}`,'model-settings'));card.append(node('p',`${sample.sampler??'샘플러 미확인'} / ${sample.scheduler??'스케줄러 미확인'} · 시드 ${sample.seed??'미확인'}`));card.append(node('p',`${(group.items||[]).filter(x=>String(benchOf(x).model_id)===id).length}개 결과`));cards.append(card);}
  const prompts=$('#bench-prompts');prompts.replaceChildren();for(const x of group?.items||[]){const b=benchOf(x),entry=node('details',null,'bench-prompt-item');entry.append(node('summary',`${benchmarkCatalog.models?.find(m=>String(m.id)===String(b.model_id))?.name||b.model_id} · ${b.scene_label||'장면 이름 미확인'}`));entry.append(node('h4','프롬프트'));entry.append(node('p',b.prompt||'미확인'));entry.append(node('h4','부정 프롬프트'));entry.append(node('p',b.negative_prompt===''?'사용 안 함 (빈 입력)':b.negative_prompt||'미확인'));prompts.append(entry);}
  const auto=(group?.items||[]).filter(x=>models.includes(String(benchOf(x).model_id)));const validIds=new Set(auto.map(x=>x.image_id));selected=new Set([...selected].filter(id=>validIds.has(id)));const sceneToken=benchGroupKey(suite.value,scene.value);if(view==='bench'&&!selected.size&&sceneToken!==lastAutoScene){const choices=[],seenModels=new Set();for(const x of auto){const id=String(benchOf(x).model_id);if(seenModels.has(id))continue;seenModels.add(id);choices.push(x);if(choices.length===4)break;}choices.forEach(x=>selected.add(x.image_id));}if(view==='bench')lastAutoScene=sceneToken;$('#bench-status').textContent=!group?'이 세트에 비교할 장면이 없습니다.':groupModelCount<2?'이 장면에는 서로 다른 모델이 2개 미만이라 모델 비교를 시작할 수 없습니다.':`${selected.size}개 이미지 선택됨`;updateSelected();
  if(restore&&view==='bench'){const params=new URLSearchParams();if($('#q').value)params.set('q',$('#q').value);params.set('view','bench');if(suite.value)params.set('suite',suite.value);if(scene.value)params.set('scene_key',scene.value);if(modelSelect.value)params.set('bench_model',modelSelect.value);history.replaceState(null,'',location.pathname+'?'+params.toString()+location.hash);}
}
let lastAutoScene='';
function readUrl() {
  const params = new URLSearchParams(location.search);
  $('#semantic-query').value=params.get('content_q')||'';for(const [k,values] of facetSelections){if(!semanticAxes.includes(k)||!values.size)continue;semanticExpanded.add(`axis:${k}`);for(const id of values){const parents=benchmarkCatalog.semantic_parents?.[k]||{},seen=new Set();for(let parent=parents[id];parent&&!seen.has(parent);parent=parents[parent]){seen.add(parent);semanticExpanded.add(`node:${k}:${parent}`);}}}
  for(const key of ['q',...fields,'sort']) {
    const el=$('#'+key);if(fields.includes(key)&&key!=='available'){const valid=new Set([...el.options].map(o=>o.value));facetSelections.set(key,new Set(params.getAll(key).filter(v=>valid.has(v))));el.value='';continue;}
    const next=params.get(key) ?? defaults[key];el.value = (el.tagName==='SELECT' && ![...el.options].some(o=>o.value===next)) ? defaults[key] : next;
  }
  if(isPublic) {$('#level').value='';facetSelections.delete('level');}
  const savedView=params.get('view')||'explore',legacyDetailed=!isPublic&&['bench','privatebench'].includes(savedView),nextView=legacyDetailed||savedView==='appreciate'?'all':savedView==='publicbench'?'bench':savedView;semanticNode='';setView(nextView);axis=semanticAxes.includes(params.get('axis'))?params.get('axis'):'subject';semanticNode=params.get('node')||'';if(view==='all'&&semanticNode){const chosen=facetSelections.get(axis)||new Set();chosen.add(semanticNode);facetSelections.set(axis,chosen);semanticNode='';}shuffleSeed=params.get('seed')||'';if($('#axis'))$('#axis').value=axis;if($('#density'))$('#density').value=legacyDetailed?'detailed':(params.get('density')||'simple');
  $('#date-kind').value=['record','generated','collected','source'].includes(params.get('date-kind'))?params.get('date-kind'):'record';$('#date-from').value=params.get('date-from')||'';$('#date-to').value=params.get('date-to')||'';$('#include-unknown-date').checked=params.get('unknown-date')!=='0';
  if(isPublic&&view==='bench'){for(const key of [...fields,'sort'])if(key!=='q')$('#'+key).value=defaults[key];$('#semantic-query').value='';facetSelections.clear();}
  if(isPublic&&view==='bench'){renderBenchmark(true);}
  if(view==='prompt')renderPrompt(true);
  updateFilterToggle();
  writeUrl(false);
}
function writeUrl(push=false) {
  if(view==='prompt'){const params=new URLSearchParams();params.set('view','prompt');if($('#prompt-choice').value)params.set('prompt_id',$('#prompt-choice').value);if($('#prompt-seed').value)params.set('seed',$('#prompt-seed').value);params.set('scope',$('#prompt-scope').value||'all');const url=location.pathname+'?'+params.toString()+location.hash;if(url!==location.pathname+location.search+location.hash)history[push?'pushState':'replaceState'](null,'',url);return;}
  const params=new URLSearchParams();
  for(const key of ['q',...fields,'sort']) {
    if(fields.includes(key)&&key!=='available'){if(!(isPublic&&view==='bench'))for(const val of facetSelections.get(key)||[])params.append(key,val);continue;}const val=$('#'+key).value;
    if(!(isPublic&&view==='bench'&&key!=='q')&&!(isPublic&&view==='bench'&&key==='sort')&&val!==defaults[key] && val && !(isPublic&&key==='level')) params.set(key,val);
  }
  if($('#semantic-query').value.trim()&&!(isPublic&&view==='bench'))params.set('content_q',$('#semantic-query').value.trim());if(view!=='explore') params.set('view',view);if(['all','explore'].includes(view)&&axis!=='subject')params.set('axis',axis);if(view==='explore'&&semanticNode)params.set('node',semanticNode);if($('#density').value!=='simple')params.set('density',$('#density').value);if($('#sort').value==='shuffle'&&shuffleSeed)params.set('seed',shuffleSeed);
  if($('#date-kind').value!=='record')params.set('date-kind',$('#date-kind').value);if($('#date-from').value)params.set('date-from',$('#date-from').value);if($('#date-to').value)params.set('date-to',$('#date-to').value);if(!$('#include-unknown-date').checked)params.set('unknown-date','0');
  if(view==='bench'){if($('#bench-suite').value)params.set('suite',$('#bench-suite').value);else params.delete('suite');if($('#bench-scene').value)params.set('scene_key',$('#bench-scene').value);else params.delete('scene_key');if($('#bench-model').value)params.set('bench_model',$('#bench-model').value);else params.delete('bench_model');}
  const url=location.pathname+(params.size?'?'+params.toString():'')+location.hash;
  if(url!==location.pathname+location.search+location.hash) history[push?'pushState':'replaceState'](null,'',url);
}
function filtered({url=true,push=false}={}) {
  if(view==='prompt'){if(url)writeUrl(push);renderPrompt(false);return;}
  $('#shuffle-again').hidden=$('#sort').value!=='shuffle';
  const q=$('#q').value.trim().toLocaleLowerCase(), tokens=q.split(/\s+/).filter(Boolean);
  contentInterpretation=readContentInterpretation();const semanticSelections=activeSemanticSelections();const picks=[...facetSelections].filter(([k,s])=>s.size&&!semanticAxes.includes(k)).map(([k,s])=>[k,s]);for(const k of semanticAxes){const values=semanticSelections.get(k);if(values?.size)picks.push([k,values]);}const queryBlocks=contentQueryBlocks()&&!(isPublic&&view==='bench');
  shown=all.filter(x=>($('#available').value==='all'||x.available!==false)&&tokens.every(t=>x._search.includes(t))&&!queryBlocks&&((isPublic&&view==='bench')||(matchesContent(x)&&picks.every(([k,values])=>matchesFacet(x,k,values))))&&(view!=='explore'||!semanticNode||(x.semantic?.[axis]||['unknown']).includes(semanticNode))&&((isPublic&&view==='bench')||dateMatches(x))&&(!(isPublic&&view==='bench')||(String(benchOf(x).suite_id??'')===$('#bench-suite').value&&String(benchOf(x).scene_key??'')===$('#bench-scene').value&&(!$('#bench-model').value||String(benchOf(x).model_id)===$('#bench-model').value))));
  const sort=$('#sort').value;
  if(sort==='group_subject'||sort==='group_model'){const key=x=>sort==='group_model'?(model(x)||'미확인 모델'):topicGroup(x);shown.sort((a,b)=>key(a).localeCompare(key(b),'ko',{numeric:true})||a._index-b._index);}
  else if(sort==='model') shown.sort((a,b)=>model(a).localeCompare(model(b),'ko')||a._index-b._index);
  else if(sort==='rating') shown.sort((a,b)=>numberRating(b)-numberRating(a)||a._index-b._index);
  else if(sort==='title') shown.sort((a,b)=>title(a).localeCompare(title(b),'ko',{numeric:true})||a.image_id.localeCompare(b.image_id));
  else if(sort.startsWith('generated_')||sort.startsWith('collected_')||sort.startsWith('source_')){const k=sort.startsWith('generated_')?'generated_at':sort.startsWith('collected_')?'collected_at':'source_created_at',dir=sort.endsWith('_old')?1:-1;shown.sort((a,b)=>{const ax=String(a[k]||''),by=String(b[k]||'');return ax===by?a._index-b._index:!ax?1:!by?-1:dir*ax.localeCompare(by);});}
  else if(sort==='shuffle'){const seed=shuffleSeed||new URLSearchParams(location.search).get('seed')||'atlas';let h=0;for(const c of seed)h=(h*31+c.charCodeAt(0))|0;const key=x=>{let n=h>>>0;for(const c of x.image_id)n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n;};shown.sort((a,b)=>key(a)-key(b)||a.image_id.localeCompare(b.image_id));}
  else shown.sort((a,b)=>{const x=recordRaw(a),y=recordRaw(b);return x===y?a._index-b._index:!x?1:!y?-1:($('#sort').value==='old'?1:-1)*x.localeCompare(y);});
  if(url) writeUrl(push);
  render(true);updateFilterToggle();updateSelected();renderActiveFilters();updateFacetCounts();if(view==='explore')renderSemantic();renderContentQueryStatus();
}
function numberRating(x){const v=Number(x.rating);return x.rating!=null&&x.rating!==''&&Number.isFinite(v)?v:-Infinity;}
function recordDate(x){const candidates=[['generated_at','generated_at_precision','생성'],['collected_at','collected_at_precision','수집'],['source_created_at','source_created_at_precision','출처 게시']].filter(([k])=>typeof x[k]==='string'&&x[k]);return candidates.sort((a,b)=>x[b[0]].localeCompare(x[a[0]]))[0]||null;}
function friendlyDate(raw,precision){if(!raw)return '날짜 미확인';const day=String(raw).slice(0,10).replace(/-/g,'.')+'.';if(precision==='day'||/^\d{4}-\d\d-\d\d$/.test(raw))return day;const hasZone=/Z$|[+-]\d\d:\d\d$/i.test(raw);if(!hasZone)return `${day} ${String(raw).slice(11,16)} (시간대 미확인)`;const d=new Date(raw);if(!Number.isFinite(d.getTime()))return day;return `${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d).replace(/\s/g,'')} ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)} KST`;}
function recordRaw(x){const descriptor=recordDate(x);return descriptor?x[descriptor[0]]:'';}
function selectedDate(x){const kind=$('#date-kind').value;return ({generated:['generated_at','generated_at_precision','생성'],collected:['collected_at','collected_at_precision','수집'],source:['source_created_at','source_created_at_precision','출처 게시']})[kind]||recordDate(x);}
const civilDayCache=new Map(),civilDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
function civilDay(raw,precision){if(!raw)return '';if(precision==='day'||!/(?:Z|[+-]\d\d:\d\d)$/i.test(raw))return raw.slice(0,10);if(civilDayCache.has(raw))return civilDayCache.get(raw);const date=new Date(raw);if(!Number.isFinite(date.getTime()))return '';const parts=Object.fromEntries(civilDayFormatter.formatToParts(date).map(p=>[p.type,p.value]));const day=`${parts.year}-${parts.month}-${parts.day}`;civilDayCache.set(raw,day);return day;}
function dateMatches(x){const descriptor=selectedDate(x),raw=descriptor&&x[descriptor[0]];if(!raw)return $('#include-unknown-date').checked;const from=$('#date-from').value,to=$('#date-to').value;if(!from&&!to)return true;const day=civilDay(raw,x[descriptor[1]]);return !!day&&(!from||day>=from)&&(!to||day<=to);}
function topicGroup(x){const ids=x.semantic?.[axis]||['unknown'],parents=benchmarkCatalog.semantic_parents?.[axis]||{},nonLeaves=new Set(ids.map(id=>parents[id]).filter(Boolean));return ids.find(id=>!nonLeaves.has(id))||'unknown';}
function makeImage(x, kind) {
  const img=node('img');img.src=media(x,kind);img.decoding='async';img.draggable=false;img.alt='';
  if(kind==='thumb') {img.className='thumb';img.loading='lazy';if(x.thumb_srcset||!isPublic) {img.srcset=x.thumb_srcset||`/media/${encodeURIComponent(x.image_id)}/thumb?size=320 320w, /media/${encodeURIComponent(x.image_id)}/thumb?size=640 640w`;img.sizes='(max-width:650px) 46vw, (max-width:1050px) 30vw, (min-width:1500px) 18vw, 22vw';}}
  img.onerror=()=>{img.alt='이미지를 불러오지 못했습니다';img.classList.add('broken');};return img;
}
function render(reset=false) {
  const grid=$('#grid');if(reset){grid.replaceChildren();delete grid.dataset.lastGroup;}const start=[...grid.children].filter(el=>el.classList.contains('card')).length,end=Math.min(start+PAGE,shown.length),fragment=document.createDocumentFragment();
  const grouped=['group_subject','group_model'].includes($('#sort').value),groupKey=x=>$('#sort').value==='group_model'?(model(x)||'미확인 모델'):topicGroup(x),counts=new Map();if(grouped)for(const x of shown)counts.set(groupKey(x),(counts.get(groupKey(x))||0)+1);
  for(let i=start;i<end;i++) {
    const x=shown[i];if(grouped&&grid.dataset.lastGroup!==groupKey(x)){const key=groupKey(x),label=$('#sort').value==='group_model'?key:(benchmarkCatalog.semantic_labels?.[axis]||{})[key]||'분류 미확인';const header=node('h2',`${label} · ${counts.get(key)}장`,'gallery-group');fragment.append(header);grid.dataset.lastGroup=key;}const card=node('article',null,'card');card.dataset.id=x.image_id;card.classList.toggle('detailed',$('#density').value==='detailed');card.classList.toggle('selected',selected.has(x.image_id));
    const open=node('button',null,'image-open');open.type='button';open.setAttribute('aria-label',title(x)+' 이미지 크게 보기');const thumb=makeImage(x,'thumb');if(i<4){thumb.loading='eager';if(i===0)thumb.fetchPriority='high';}open.append(thumb);open.onclick=()=>openViewer(i,open);
    const check=node('input',null,'select-image');check.type='checkbox';check.checked=selected.has(x.image_id);check.setAttribute('aria-label',title(x)+' 비교 선택');
    check.onchange=()=>{if(check.checked&&selected.size>=4){check.checked=false;$('#selection-hint').textContent='최대 4장입니다. 기존 선택을 해제해 주세요.';return;}check.checked?selected.add(x.image_id):selected.delete(x.image_id);card.classList.toggle('selected',check.checked);updateSelected();};
    const wrap=node('label',null,'select-wrap');wrap.append(check);

    const meta=node('div',null,'cardmeta'),heading=node('button',isPublic?(view==='bench'?model(x):(benchOf(x).scene_label||title(x))):title(x),'card-title');heading.title=title(x);heading.onclick=()=>openViewer(i,heading);
    const modelLabel=model(x),subtext=isPublic&&view==='bench'?(benchOf(x).scene_label||[x.occupation,x.scene_id].filter(Boolean).join(' · ')||source(x)):(modelLabel||[source(x),x.source_username||x.author].filter(Boolean).join(' · '));
    const sub=node('div',subtext,'sub');sub.title=subtext;
    const bench=node('div',[x.scene_title||x.scene_id, x.rating!=null?'평가 '+x.rating:null].filter(Boolean).join(' · '),'bench-line');bench.title=bench.textContent;
    const dateInfo=selectedDate(x),dateLabel=dateInfo&&x[dateInfo[0]]?`${dateInfo[2]} ${friendlyDate(x[dateInfo[0]],x[dateInfo[1]])}`:dateInfo?`${dateInfo[2]} 날짜 미확인`:'날짜 미확인';const bench2=node('div',[x.catalog,x.seed!=null?'시드 '+x.seed:null,(()=>{const c=x.benchmark||x._conditions||{};return c.width&&c.height?`${c.width}×${c.height}`:null;})()].filter(Boolean).join(' · '),'bench-line');bench2.title=dateInfo?`${dateLabel} · 원값 ${x[dateInfo[0]]} · 정밀도 ${x[dateInfo[1]]||'미확인'}`:dateLabel;
    if(isPublic&&view==='bench'){const b=benchOf(x);bench.textContent=`${b.steps??'?'} steps · CFG ${b.cfg??'?'} · ${b.width??'?'}×${b.height??'?'}`;bench2.textContent=`${b.sampler??'?'} / ${b.scheduler??'?'}${b.precision?` · ${b.precision}`:''}`;}meta.append(heading,sub);if(bench.textContent)meta.append(bench);if(dateLabel&&!(isPublic&&view==='bench'))meta.append(node('div',dateLabel,'bench-line date-meta'));if(bench2.textContent&&($('#density').value==='detailed'||isPublic&&view==='bench'))meta.append(bench2);card.append(open,wrap,meta);fragment.append(card);
  }
  grid.append(fragment);$('#more').hidden=end>=shown.length;$('#more').textContent=`${Math.min(PAGE,shown.length-end)}장 더 보기`;$('#empty').hidden=!!shown.length;
  $('#count').textContent=`${shown.length.toLocaleString()}장 결과 / 전체 ${all.length.toLocaleString()}장 · ${end.toLocaleString()}장 표시`;
}
function updateSelected() {
  const n=selected.size;$('#batch').hidden=!n||(isPublic&&view==='bench');$('#selected-count').textContent=`${n} / 4장 선택`;
  $('#selection-hint').textContent=n<2?'한 장 더 골라 비교하세요.':'필터를 바꿔도 선택은 유지됩니다.';
  document.querySelectorAll('.select-image').forEach(check=>{check.checked=selected.has(check.closest('.card')?.dataset.id);check.closest('.card')?.classList.toggle('selected',check.checked);});
  $('#compare').disabled=$('#blind').disabled=n<2;if(isPublic&&view==='bench'){$('#compare-scene').disabled=$('#blind-scene').disabled=n<2;const host=$('#bench-selection');host.replaceChildren(node('strong',`비교 선택 ${n} / 4장`));for(const id of selected){const x=byId.get(id);if(!x)continue;const chip=node('span',null,'selected-model-chip');chip.append(node('span',model(x)));const remove=node('button','해제','text-button');remove.type='button';remove.setAttribute('aria-label',`${model(x)} 선택 해제`);remove.onclick=()=>{selected.delete(id);updateSelected();};chip.append(remove);host.append(chip);}const clear=node('button','전체 해제','text-button');clear.type='button';clear.onclick=clearSelected;host.append(clear);$('#compare-scene').textContent=`선택 ${n}장 · 이 장면 모델 비교`;$('#blind-scene').textContent=`선택 ${n}장 · 블라인드`;}
  if(isPublic&&view==='bench'&&currentBenchmarkModelCount>=2)$('#bench-status').textContent=`${n}개 이미지 선택됨${n<2?' · 2장 이상 선택하세요.':''}`;
}
function clearSelected(){selected.clear();document.querySelectorAll('.select-image').forEach(x=>x.checked=false);document.querySelectorAll('.card.selected').forEach(x=>x.classList.remove('selected'));updateSelected();}
function reset(){for(const key of ['q',...fields,'sort']) $('#'+key).value=defaults[key];$('#semantic-query').value='';contentInterpretation=null;for(const k of fields)if(k!=='available')facetSelections.set(k,new Set());axis='subject';semanticNode='';shuffleSeed='';$('#axis').value=axis;$('#date-kind').value='record';$('#date-from').value='';$('#date-to').value='';$('#include-unknown-date').checked=true;renderSemantic();renderBreadcrumb();filtered({push:true});}
function updateFilterToggle() {
  const n=[...facetSelections.values()].reduce((sum,set)=>sum+set.size,0)+fields.filter(k=>k==='available'&&$('#'+k).value!==defaults[k]).length+($('#semantic-query').value.trim()?1:0);
  const open=$('#filters').classList.contains('show-advanced');$('#filter-toggle').textContent=`상세 필터 ${open?'접기':'열기'}${n?' · '+n+'개 적용':''}`;$('#filter-toggle').setAttribute('aria-expanded',String(open));
}
function renderActiveFilters(){const host=$('#active-filters');host.replaceChildren();const chip=(text,aria,off)=>{const b=node('button',text+' ×','filter-chip');b.type='button';if(aria)b.setAttribute('aria-label',aria);b.onclick=off;host.append(b);};const q=$('#q').value.trim();if(q)chip(`검색: ${q}`,'검색 조건 해제',()=>{$('#q').value='';filtered({push:true});});const contentQ=$('#semantic-query').value.trim();if(contentQ)chip(`내용: ${contentQ}`,'의미 검색 조건 해제',()=>{$('#semantic-query').value='';contentInterpretation=null;filtered({push:true});});for(const [k,values] of facetSelections)for(const v of values)chip(`${$('#'+k).closest('label')?.childNodes[0]?.textContent.trim()||k}: ${labelFor(k,v)}`,`${k} ${labelFor(k,v)} 조건 해제`,()=>{values.delete(v);filtered({push:true});});if($('#available').value!=='available')chip(`이미지: ${$('#available').selectedOptions[0]?.textContent}`,'이미지 조건 초기화',()=>{$('#available').value='available';filtered({push:true});});if(semanticNode)chip(`분류: ${(benchmarkCatalog.semantic_labels?.[axis]||{})[semanticNode]||semanticNode}`,'분류 조건 해제',()=>{semanticNode='';renderBreadcrumb();filtered({push:true});});if($('#date-kind').value!=='record')chip(`날짜 기준: ${$('#date-kind').selectedOptions[0]?.textContent}`,'날짜 기준 해제',()=>{$('#date-kind').value='record';filtered({push:true});});if($('#date-from').value||$('#date-to').value)chip(`기간: ${$('#date-from').value||'시작 없음'} – ${$('#date-to').value||'끝 없음'}`,'날짜 범위 해제',()=>{$('#date-from').value='';$('#date-to').value='';filtered({push:true});});if(!$('#include-unknown-date').checked)chip('날짜 미확인 제외','미확인 날짜 포함',()=>{$('#include-unknown-date').checked=true;filtered({push:true});});}
function updateFacetCounts(){
  const tokens=$('#q').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const base=all.filter(x=>($('#available').value==='all'||x.available!==false)&&tokens.every(t=>x._search.includes(t))&&dateMatches(x)&&matchesContent(x)&&(view!=='explore'||!semanticNode||(x.semantic?.[axis]||['unknown']).includes(semanticNode)));
  for(const k of fields){const el=$('#'+k);if(!el||k==='available')continue;const others=[...facetSelections].filter(([f,values])=>f!==k&&values.size),counts=new Map(),parents=benchmarkCatalog.semantic_parents?.[k]||{};
    for(const x of base){if(!others.every(([f,values])=>matchesFacet(x,f,values)))continue;const values=new Set(facetValues(x,k));for(const id of [...values]){const seen=new Set();for(let parent=parents[id];parent&&!seen.has(parent);parent=parents[parent]){seen.add(parent);values.add(parent);}}for(const v of values)if(v)counts.set(v,(counts.get(v)||0)+1);}
    for(const opt of el.options){if(!opt.value)continue;const n=counts.get(opt.value)||0;opt.disabled=n===0&&!facetSelections.get(k)?.has(opt.value);opt.textContent=`${labelFor(k,opt.value)} (${n})`;}
  }
}
function renderSemantic(){
  const host=$('#semantic-tree');if(!host)return;const focused=host.contains(document.activeElement)?document.activeElement.closest('[role="treeitem"]')?.dataset.nodeKey:null;host.classList.add('semantic-tree');host.setAttribute('role','tree');host.setAttribute('aria-label','여러 기준으로 이미지 분류');host.replaceChildren();const labelsByAxis=benchmarkCatalog.semantic_labels||{},parentsByAxis=benchmarkCatalog.semantic_parents||{},axisNames=benchmarkCatalog.semantic_axis_labels||{},allSemantic=activeSemanticSelections(),tokens=$('#q').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),blocked=contentQueryBlocks();
  const axisOrder=benchmarkCatalog.semantic_axis_order?.filter(k=>semanticAxes.includes(k))||semanticAxes;if(!semanticExpanded.has('initialized')){semanticExpanded.add('initialized');if(axisOrder[0])semanticExpanded.add(`axis:${axisOrder[0]}`);}
  const statusText=(items,k)=>{const counts=new Map();for(const x of items){const status=x.semantic_status?.[k]||x.semantic_status?.[`${k}_status`];if(status)counts.set(status,(counts.get(status)||0)+1);}const names=benchmarkCatalog.semantic_status_labels||{};return [...counts].map(([s,n])=>`${names[s]||s} ${n}`).join(' · ');};
  const renderNodes=(entries,group,k,scope,counts)=>{for(const entry of entries){const selected=facetSelections.get(k)?.has(entry.id)||false;if(!entry.count&&!selected)continue;const item=node('div',null,'semantic-treeitem');item.setAttribute('role','treeitem');item.tabIndex=0;item.dataset.nodeKey=`${k}:${entry.id}`;item.setAttribute('aria-selected',String(selected));item.setAttribute('aria-label',`${entry.label}, ${entry.count}장`);const row=node('div',null,'tree-row');if(entry.children.length){const key=`node:${k}:${entry.id}`,expanded=semanticExpanded.has(key);item.setAttribute('aria-expanded',String(expanded));const toggle=node('button',expanded?'▾':'▸','tree-disclosure');toggle.type='button';toggle.setAttribute('aria-label',`${entry.label} 하위 분류 ${expanded?'접기':'펼치기'}`);toggle.setAttribute('aria-expanded',String(expanded));toggle.onclick=e=>{e.stopPropagation();expanded?semanticExpanded.delete(key):semanticExpanded.add(key);renderSemantic();const next=[...host.querySelectorAll('[role="treeitem"]')].find(x=>x.dataset.nodeKey===`${k}:${entry.id}`);next?.focus();};row.append(toggle);}else row.append(node('span','·','tree-disclosure-spacer'));row.append(node('span',`${entry.label} (${entry.count.toLocaleString()})`,'tree-label'));item.append(row);item.onclick=e=>{if(e.target.closest('button')||e.target.closest('[role="treeitem"]')!==item)return;const next=new Set(facetSelections.get(k)||[]);next.has(entry.id)?next.delete(entry.id):next.add(entry.id);next.size?facetSelections.set(k,next):facetSelections.delete(k);semanticNode='';filtered({push:true});if(host.classList.contains('mobile-open')){host.classList.remove('mobile-open');$('#tree-toggle').setAttribute('aria-expanded','false');$('#tree-toggle').textContent='분류 열기';$('#tree-toggle').focus();}};group.append(item);if(entry.children.length){const childGroup=node('div',null,'semantic-treegroup');childGroup.setAttribute('role','group');childGroup.hidden=!semanticExpanded.has(`node:${k}:${entry.id}`);item.append(childGroup);renderNodes(entry.children,childGroup,k,scope,counts);}}};
  axisOrder.forEach(k=>{const labels=labelsByAxis[k]||{},parents=parentsByAxis[k]||{},selected=allSemantic.get(k)||new Set(),otherSelections=new Map([...allSemantic].filter(([f])=>f!==k)),otherFacets=[...facetSelections].filter(([f,s])=>s.size&&!semanticAxes.includes(f)),scope=all.filter(x=>!blocked&&($('#available').value==='all'||x.available!==false)&&tokens.every(t=>x._search.includes(t))&&matchesContent(x)&&otherFacets.every(([f,values])=>matchesFacet(x,f,values))&&[...otherSelections].every(([f,values])=>matchesFacet(x,f,values))&&dateMatches(x)&&(view!=='explore'||!semanticNode||(x.semantic?.[axis]||['unknown']).includes(semanticNode)));const counts=window.AtlasBrowse?.countNodes(scope,k,parents)||{direct:new Map(),unique:new Map()},countMap=new Map([...Object.entries(labels)].map(([id])=>[id,parents[id]?(counts.unique.get(id)||counts.direct.get(id)||0):(counts.direct.get(id)||0)])),tree=window.AtlasBrowse?.buildTree(labels,parents,countMap)||[];const root=node('section',null,'semantic-axis');root.setAttribute('role','treeitem');root.tabIndex=0;root.dataset.nodeKey=`axis:${k}`;root.setAttribute('aria-label',axisLabel(k));const axisKey=`axis:${k}`,expanded=semanticExpanded.has(axisKey);root.setAttribute('aria-expanded',String(expanded));const head=node('div',null,'semantic-axis-head');const axisToggle=node('button',null,'tree-axis-toggle');axisToggle.type='button';axisToggle.tabIndex=-1;axisToggle.textContent=`${expanded?'▾':'▸'} ${axisLabel(k)} (${scope.length.toLocaleString()})`;axisToggle.setAttribute('aria-expanded',String(expanded));axisToggle.onclick=()=>{expanded?semanticExpanded.delete(axisKey):semanticExpanded.add(axisKey);renderSemantic();};head.append(axisToggle);const status=statusText(scope,k);if(status)head.append(node('span',status,'semantic-status-counts'));root.append(head);const group=node('div',null,'semantic-treegroup');group.setAttribute('role','group');group.hidden=!expanded;renderNodes(tree,group,k,scope,counts);root.append(group);host.append(root);});
  const info=node('p',`${all.length.toLocaleString()}개 이미지 · 여러 기준을 함께 선택해 이미지를 좁혀보세요. 상위 항목에는 하위 분류도 포함됩니다.`,'semantic-note');$('#explore-summary').replaceChildren(info);if(focused){const next=[...host.querySelectorAll('[role="treeitem"]')].find(x=>x.dataset.nodeKey===focused);next?.focus();}
}
function handleTreeKeyboard(event){const item=event.target.closest('#semantic-tree [role="treeitem"]');if(!item)return;if(event.target.closest('button')&&['Enter',' '].includes(event.key))return;const visible=[...$('#semantic-tree').querySelectorAll('[role="treeitem"]')].filter(x=>!x.closest('[hidden]'));const index=visible.indexOf(item),children=item.querySelector(':scope > .semantic-treegroup'),key=item.classList.contains('semantic-axis')?`axis:${item.dataset.nodeKey?.split(':')[1]}`:`node:${item.dataset.nodeKey}`;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();visible[index+(event.key==='ArrowDown'?1:-1)]?.focus();}else if(event.key==='Home'||event.key==='End'){event.preventDefault();(event.key==='Home'?visible[0]:visible.at(-1))?.focus();}else if(event.key==='ArrowRight'){event.preventDefault();if(children?.hidden){item.querySelector(':scope > .semantic-axis-head .tree-axis-toggle, :scope > .tree-row .tree-disclosure')?.click();}else children?.querySelector('[role="treeitem"]')?.focus();}else if(event.key==='ArrowLeft'){event.preventDefault();if(children&&!children.hidden){item.querySelector(':scope > .semantic-axis-head .tree-axis-toggle, :scope > .tree-row .tree-disclosure')?.click();}else item.parentElement?.closest('[role="treeitem"]')?.focus();}else if(event.key==='Enter'||event.key===' '){event.preventDefault();if(item.classList.contains('semantic-axis'))item.querySelector('.tree-axis-toggle')?.click();else item.click();}}
function renderBreadcrumb(){const host=$('#breadcrumbs');if(!semanticNode){host.replaceChildren();host.hidden=true;return;}host.hidden=false;const labels=benchmarkCatalog.semantic_labels?.[axis]||{},parents=benchmarkCatalog.semantic_parents?.[axis]||{};host.replaceChildren();const home=node('button','탐색 루트','text-button');home.onclick=()=>{semanticNode='';renderSemantic();renderBreadcrumb();filtered({push:true});};host.append(home);const chain=[];for(let id=semanticNode;id;id=parents[id])chain.unshift(id);for(const id of chain){host.append(node('span','›'));const item=node('button',labels[id]||'분류 미확인','text-button');item.onclick=()=>{semanticNode=id;renderSemantic();renderBreadcrumb();filtered({push:true});};host.append(item);}}
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
function viewerSetZoom(z){viewerGestures?.reset();viewerZoom=setPanZoom($('#view-pan'),z);$('#view-zoom').textContent=Math.round(viewerZoom*100)+'%';}
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
  return openViewerRows(shown,index,focus);
}
function openViewerRows(rows,index,focus) {
  viewerGestures?.reset();
  viewerRows=rows;if(!viewerRows.length)return;cursor=(index+viewerRows.length)%viewerRows.length;const x=viewerRows[cursor],img=$('#large');
  $('#image-status').textContent='미리보기 불러오는 중…';img.onload=()=>$('#image-status').textContent='';img.onerror=()=>{$('#image-status').textContent='이미지를 불러오지 못했습니다';};img.src=media(x,'preview');img.alt=title(x);
  $('#viewer-position').textContent=`${cursor+1} / ${viewerRows.length} · 미리보기`;
  $('#view-original').disabled=!media(x,'original');$('#view-original').textContent=isPublic?'원본 크기 보기':'원본 보기';
  const aside=$('#details');aside.replaceChildren();const h=node('h2',title(x));h.id='viewer-title';aside.append(h,node('p',source(x)),node('p',model(x)));
  if(x.asset_role==='reference')aside.append(node('p','원작자 참고 이미지 · 생성 결과가 아니며 목표 달성 점수로 사용하지 않습니다.'));
  if(isPublic)aside.append(node('p','메타데이터를 제거한 재인코딩본'));
  const fold=node('details'),summary=node('summary','정보 · 프롬프트 펼치기'),list=node('dl');fold.append(summary,list);
  const b=benchOf(x);for(const [label,val] of [['모델 전체 이름',model(x)],['출처',source(x)],['작성자',x.source_username||x.author],['출처 종류',x.source_kind],...(!isPublic?[['이미지 유형',x.nsfw_level||'미분류']]:[]),['생성일',x.generated_at?`${x.generated_at} · ${x.generated_at_precision||'정밀도 미확인'}`:'미확인'],['수집일',x.collected_at?`${x.collected_at} · ${x.collected_at_precision||'정밀도 미확인'}`:'미확인'],['원작 출처일',x.source_created_at?`${x.source_created_at} · ${x.source_created_at_precision||'정밀도 미확인'}`:'미확인'],['세트',b.suite_id||value(x,'job')],['장면',b.scene_label||x.scene_id],['직업',x.occupation],['카테고리',x.category],['카탈로그',x.catalog],['변형',x.variant],['평가',x.rating],['시드',benchValue(x,'seed')],['해상도',b.width!=null&&b.height!=null?`${b.width} × ${b.height}`:'미확인'],['단계',benchValue(x,'steps')],['CFG',benchValue(x,'cfg')],['샘플러',benchValue(x,'sampler')],['스케줄러',benchValue(x,'scheduler')],['체크포인트',benchValue(x,'checkpoint')],['정밀도',benchValue(x,'precision')],['백엔드',benchValue(x,'backend')],['장치',benchValue(x,'device')],['소프트웨어',benchValue(x,'software')],['실행 날짜',benchValue(x,'run_date')],['LoRA',benchValue(x,'loras')],['생성 설정',x.params],['태그',Array.isArray(x.tags)?x.tags.join(' · '):x.tags],['프롬프트',benchValue(x,'prompt')],['부정 프롬프트',benchValue(x,'negative_prompt')],['프롬프트 해시',benchValue(x,'prompt_sha256')],['부정 프롬프트 해시',benchValue(x,'negative_prompt_sha256')],['영문 프롬프트',x.prompt_en],['평가 요약',evaluationSummary(x.evaluation_summary)],['메타데이터 근거',x.metadata_provenance]]) addMeta(list,label,val);
  aside.append(fold);const sourceURL=linkURL(x.source_url);if(sourceURL){const a=node('a','출처 페이지 열기 ↗');a.href=sourceURL;a.target='_blank';a.rel='noopener noreferrer';aside.append(a);}
  lockModal($('#viewer'),focus);viewerZoom=1;setPanZoom($('#view-pan'),1,false);$('#view-zoom').textContent='100%';
}
function navigate(delta){openViewerRows(viewerRows,cursor+delta);}
function original(){const x=viewerRows[cursor],url=media(x,'original');if(!url)return;$('#image-status').textContent='원본 불러오는 중…';$('#large').src=url;$('#view-original').disabled=true;$('#view-original').textContent=isPublic?'원본 크기 표시 중':'원본 표시 중';$('#viewer-position').textContent=`${cursor+1} / ${viewerRows.length} · ${isPublic?'원본 크기':'원본'}`;viewerSetZoom(1);}
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
  if(x.asset_role==='reference')return {text:'해당 없음',confirmed:false};
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
    surface.append(img);pan.append(surface);img.onclick=()=>{if(!compareBlind||revealed)openViewerRows([x],0,pan);};const label=node('div',compareLabel(x,i),'compare-label');item.append(pan,label);grid.append(item);
    const activate=()=>{activePane=i;grid.querySelectorAll('.compare-item').forEach((el,j)=>el.classList.toggle('active',i===j));$('#compare-zoom').textContent=Math.round(Number(pan.dataset.zoom||1)*100)+'%';};
    pan.addEventListener('pointerdown',activate);pan.addEventListener('focus',activate);installPan(pan);
    pan.addEventListener('scroll',()=>syncPan(pan),{passive:true});
  });
  grid.firstElementChild?.classList.add('active');$('#compare-zoom').textContent='100%';$('#reveal').hidden=$('#reshuffle').hidden=!compareBlind;$('#reveal').textContent=revealed?'이름 숨기기':'이름 표시';updateConditionComparison();
}
function openCompare(blind){compareRows=[...selected].map(id=>byId.get(id)).filter(Boolean);if(compareRows.length<2||compareRows.length>4)return;if(document.body.classList.contains('prompt-view')){const info=compareRows.map(promptInfo);const keys=new Set(info.filter(Boolean).map(p=>`${p.prompt_sha256}|${p.scope==='reproduction'?p.prompt_label:'common'}|${p.seed}`));if(info.some(p=>!p?.match_verified)||keys.size!==1){$('#prompt-manual-count').textContent='같은 장면과 시드의 결과를 선택하세요.';return;}}compareBlind=blind;revealed=false;if(blind)compareRows=shuffled(compareRows);drawCompare();lockModal($('#compare-view'),document.activeElement);}
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
let viewerGestures=null;
function installPan(pan) {
  let drag=null;
  if(pan.id==='view-pan'&&window.AtlasGestures){viewerGestures=window.AtlasGestures.createGestureController({zoom:()=>Number(pan.dataset.zoom||1),capture:id=>{try{pan.setPointerCapture(id);}catch{}},captureAnchor:point=>{const rect=pan.getBoundingClientRect(),x=point.x-rect.left,y=point.y-rect.top;return{x:(pan.scrollLeft+x)/Math.max(1,pan.scrollWidth),y:(pan.scrollTop+y)/Math.max(1,pan.scrollHeight)};},setZoomAt:(next,point,anchor)=>{const rect=pan.getBoundingClientRect(),x=point.x-rect.left,y=point.y-rect.top;viewerZoom=setPanZoom(pan,next,false);pan.scrollLeft=Math.max(0,Math.min(pan.scrollWidth-pan.clientWidth,anchor.x*pan.scrollWidth-x));pan.scrollTop=Math.max(0,Math.min(pan.scrollHeight-pan.clientHeight,anchor.y*pan.scrollHeight-y));$('#view-zoom').textContent=Math.round(viewerZoom*100)+'%';},panBy:(x,y)=>{pan.scrollLeft+=x;pan.scrollTop+=y;},navigate,reset:()=>{viewerZoom=setPanZoom(pan,1,false);$('#view-zoom').textContent='100%';}}).attach(pan);}
  else {
    pan.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0||Number(pan.dataset.zoom||1)<=1)return;drag={x:event.clientX,y:event.clientY,left:pan.scrollLeft,top:pan.scrollTop};pan.classList.add('dragging');pan.setPointerCapture(event.pointerId);event.preventDefault();});
    pan.addEventListener('pointermove',event=>{if(drag){pan.scrollLeft=drag.left+drag.x-event.clientX;pan.scrollTop=drag.top+drag.y-event.clientY;}});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])pan.addEventListener(type,()=>{drag=null;pan.classList.remove('dragging');});
  }
  pan.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const z=Number(pan.dataset.zoom||1)+(event.deltaY<0?.25:-.25);if(pan.id==='view-pan')viewerSetZoom(z);else compareSetZoom(z);},{passive:false});
}
function populate(data) {
  isPublic=data.mode==='public';benchmarkCatalog=data.benchmark&&typeof data.benchmark==='object'?data.benchmark:{};installSemanticMetadata(data);$('#mode').textContent='';
  promptDiagnostics=data.diagnostics?.prompt_comparison_quality||{};
  if(isPublic){$('#q').placeholder='제목·모델·직업·장면 검색';}
  all=(Array.isArray(data.items)?data.items:[]).map((x,i)=>{const date=recordDate(x);return {...x,_conditions:isPublic?null:privateConditions(x),image_id:String(x.image_id),_index:i,_date:date?x[date[0]]:'',_search:[model(x),x.benchmark?.scene_label,x.benchmark?.prompt,x.benchmark?.model_id,x.title,x.prompt,x.prompt_en,x.model_id,x.model_label,x.catalog,x.source_group,x.source_kind,x.source_ref,x.scene_id,x.occupation,x.category,x.job_id,x.bench_slug,x.exp_id,x.image_id,x.run_id,x.execution_run_uuid,x.source_username,x.author,...(Array.isArray(x.source_relations)?x.source_relations.flatMap(r=>[r.image_id,r.source_ref,r.run_id,r.execution_run_uuid,r.model_label,r.catalog,r.job_id]):[]),...(Array.isArray(x.tags)?x.tags:[])].filter(v=>v!=null).join(' ').toLocaleLowerCase()};});
  benchmarkItems=all.filter(x=>x.benchmark&&typeof x.benchmark==='object');
  byId=new Map(all.map(x=>[x.image_id,x]));
  for(const k of fields.filter(k=>k!=='available')) {
    const values=[...new Set([...all.flatMap(x=>facetValues(x,k)).filter(v=>v!==''),...(semanticAxes.includes(k)?Object.keys(benchmarkCatalog.semantic_labels?.[k]||{}):[])])].sort((a,b)=>a.localeCompare(b,'ko'));
    const el=$('#'+k);for(const v of values){const levelLabels={SFW:'일상',NSFW:'성인',sfw:'일상',nsfw:'성인',unknown:'미분류',None:'미분류'};const label=k==='level'?(levelLabels[v]||'미분류'):labelFor(k,v);const option=node('option',label);option.value=v;option.title=label;el.append(option);}
    if(values.length>40&&['job','model','scene'].includes(k)){const search=node('input',null,'option-search');search.type='search';search.placeholder='옵션 찾기';search.setAttribute('aria-label',`${k==='job'?'세트':k==='model'?'모델':'장면'} 옵션 찾기`);el.parentElement.insertBefore(search,el);search.addEventListener('input',()=>{const needle=search.value.trim().toLocaleLowerCase();for(const option of el.options)option.hidden=!!option.value&&!option.textContent.toLocaleLowerCase().includes(needle);});}
    const mainFilters=['subject','role','model'];const advanced=!mainFilters.includes(k);const facet=$(`[data-facet="${k}"]`);facet.hidden=!values.length;facet.classList.toggle('advanced-field',advanced);
  }
  $('[data-facet="available"]').hidden=isPublic||!all.some(x=>x.available===false);
  if(!isPublic&&data.diagnostics) {const n=Number(data.diagnostics.missing_images)||0;$('#diag').textContent=n?`파일 확인 필요 ${n.toLocaleString()}건 · 목록은 사용 가능한 이미지 기준`:'';}
  benchmarkCatalog=data.benchmark&&typeof data.benchmark==='object'?data.benchmark:{};installSemanticMetadata(data);
  renderBenchmark(false);readUrl();renderSemantic();renderBreadcrumb();if(isPublic&&view==='bench')renderBenchmark(true);filtered({url:false});
}
$('#q').addEventListener('input',()=>{clearTimeout(searchTimer);$('#search-all').hidden=!(isPublic&&view==='bench'&&$('#q').value.trim());searchTimer=setTimeout(()=>filtered(),150);});
$('#semantic-query').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>filtered(),150);});$('#semantic-tree').addEventListener('keydown',handleTreeKeyboard);
for(const k of fields){const el=$('#'+k);el.addEventListener('change',()=>{if(k==='available'){filtered({push:true});return;}const v=el.value;if(v){const values=facetSelections.get(k)||new Set();values.add(v);facetSelections.set(k,values);el.value='';}clearTimeout(searchTimer);filtered({push:true});});}
$('#appreciate').onclick=()=>{setView('explore');renderSemantic();filtered({push:true});};$('#all-view').onclick=()=>{setView('all');filtered({push:true});};$('#to-all').onclick=()=>$('#all-view').click();$('#axis').onchange=()=>{axis=$('#axis').value;semanticNode='';semanticExpanded.add(`axis:${axis}`);renderBreadcrumb();filtered({push:true});$('#semantic-tree').querySelector(`[data-node-key="axis:${axis}"]`)?.scrollIntoView({block:'nearest'});};$('#tree-toggle').onclick=()=>{const open=$('#semantic-tree').classList.toggle('mobile-open');$('#tree-toggle').setAttribute('aria-expanded',String(open));$('#tree-toggle').textContent=open?'분류 닫기':'분류 열기';if(!open)$('#tree-toggle').focus();};$('#benchmark').onclick=()=>{if(!isPublic){setView('prompt');renderPrompt(false);filtered({push:true});return;}for(const k of ['q',...fields])$('#'+k).value=defaults[k];setView('bench');renderBenchmark(false);filtered({push:true});};$('#prompt-view').onclick=()=>{setView('prompt');renderPrompt(false);filtered({push:true});};for(const id of ['prompt-choice','prompt-seed','prompt-scope'])$('#'+id).addEventListener('change',()=>{renderPrompt(false);writeUrl(true);});$('#prompt-manual-compare').onclick=()=>openCompare(false);$('#prompt-clear-selection').onclick=()=>{clearSelected();renderPrompt(false);};$('#density').onchange=()=>filtered({push:true});
for(const id of ['date-kind','date-from','date-to','include-unknown-date'])$('#'+id).addEventListener('change',()=>filtered({push:true}));
$('#search-all').onclick=()=>{const q=$('#q').value;for(const key of fields)$('#'+key).value=defaults[key];for(const k of fields)if(k!=='available')facetSelections.set(k,new Set());$('#q').value=q;setView('explore');filtered({push:true});$('#q').focus();};
$('#bench-suite').onchange=()=>{selected.clear();renderBenchmark(false);filtered({push:true});};$('#bench-scene').onchange=()=>{selected.clear();renderBenchmark(false);filtered({push:true});};$('#bench-model').onchange=()=>{renderBenchmark(false);filtered({push:true});};
$('#compare-scene').onclick=()=>openCompare(false);$('#blind-scene').onclick=()=>openCompare(true);
$('#filter-toggle').onclick=()=>{$('#filters').classList.toggle('show-advanced');$('.tools').classList.toggle('filters-open',$('#filters').classList.contains('show-advanced'));updateFilterToggle();};
document.querySelectorAll('.option-search').forEach(input=>input.addEventListener('input',()=>{const select=$('#'+input.dataset.optionsFor),needle=input.value.trim().toLocaleLowerCase();for(const option of select.options)option.hidden=!!option.value&&!option.textContent.toLocaleLowerCase().includes(needle);}));
$('#reset').onclick=$('#empty-reset').onclick=reset;$('#more').onclick=()=>render();$('#clear-selected').onclick=clearSelected;$('#sort').addEventListener('change',()=>{if($('#sort').value==='shuffle'&&!shuffleSeed)shuffleSeed=Math.random().toString(36).slice(2);filtered({push:true});});$('#shuffle-again').onclick=()=>{shuffleSeed=Math.random().toString(36).slice(2);filtered({push:true});};
$('#compare').onclick=()=>openCompare(false);$('#blind').onclick=()=>openCompare(true);
$('#reshuffle').onclick=()=>{compareRows=shuffled(compareRows);revealed=false;drawCompare();};
$('#reveal').onclick=()=>{revealed=!revealed;$('#compare-grid').querySelectorAll('.compare-item').forEach((item,i)=>{item.querySelector('.compare-label').textContent=compareLabel(compareRows[i],i);item.querySelector('img').alt=compareBlind&&!revealed?`비교 이미지 ${String.fromCharCode(65+i)}`:title(compareRows[i]);});$('#reveal').textContent=revealed?'이름 숨기기':'이름 표시';updateConditionComparison();};
$('#compare-plus').onclick=()=>compareSetZoom(Number($('#compare-grid').querySelectorAll('.pan')[activePane]?.dataset.zoom||1)+.5);
$('#compare-minus').onclick=()=>compareSetZoom(Number($('#compare-grid').querySelectorAll('.pan')[activePane]?.dataset.zoom||1)-.5);
$('#zoom-reset').onclick=()=>{const sync=$('#sync-pan').checked;$('#sync-pan').checked=true;compareSetZoom(1);$('#sync-pan').checked=sync;};
$('#sync-pan').onchange=()=>{if($('#sync-pan').checked){const pan=$('#compare-grid').querySelectorAll('.pan')[activePane];if(pan){compareSetZoom(Number(pan.dataset.zoom||1));syncPan(pan);}}};
$('#view-plus').onclick=()=>viewerSetZoom(viewerZoom+.5);$('#view-minus').onclick=()=>viewerSetZoom(viewerZoom-.5);$('#view-fit').onclick=()=>viewerSetZoom(1);$('#view-original').onclick=original;
$('.prev').onclick=()=>navigate(-1);$('.next').onclick=()=>navigate(1);
for(const dialog of document.querySelectorAll('dialog')){dialog.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(dialog.id==='viewer')viewerGestures?.reset();unlockModal(dialog);});}
installPan($('#view-pan'));
document.addEventListener('keydown',event=>{const typing=/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)||event.target.isContentEditable;if(typing)return;if($('#viewer').open){if(event.key==='ArrowRight'){event.preventDefault();navigate(1);}if(event.key==='ArrowLeft'){event.preventDefault();navigate(-1);}if(event.key==='+')viewerSetZoom(viewerZoom+.5);if(event.key==='-')viewerSetZoom(viewerZoom-.5);}else if(!$('#compare-view').open&&event.key==='/'){event.preventDefault();$('#q').focus();}});
window.addEventListener('popstate',()=>{clearTimeout(searchTimer);document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());readUrl();filtered({url:false});});
// Keep semantic navigation beside the actual working list, not in a full-width header panel.
const browse=document.createElement('div');browse.className='browse-layout';browse.id='browse-layout';
const workspace=document.createElement('div');workspace.className='results-workspace';
const anchor=$('#explore-panel');anchor.before(browse);browse.append(anchor,workspace);
for(const el of [$('.tools'),$('.summary'),$('#grid'),$('#model-information'),$('#empty'),$('#more'),$('#batch')])if(el)workspace.append(el);
fetch('catalog.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('카탈로그를 불러오지 못했습니다. 새로고침해 주세요.');return response.json();}).then(populate).catch(error=>{$('#count').textContent=error.message;$('#empty').hidden=false;$('#empty strong').textContent='컬렉션을 불러오지 못했습니다.';});
