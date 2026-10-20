import {updateMap,showMap,resizeMap} from '/map.js';
import {transitionAdvice} from '/route-weather.js';
const $=id=>document.getElementById(id);
const CENTER={lat:51.13213,lon:71.402828};
const featureNames={wifi:'Wi-Fi',laptop:'Можно с ноутбуком',kidsMenu:'Детское меню',dogFriendly:'Можно с собакой',accessibleEntrance:'Доступный вход'};
const opening={open_by_schedule:'Открыто по расписанию',closed_by_schedule:'Закрыто по расписанию',unknown:'Расписание не указано'};
const types={walk:{park:'Парки',square:'Скверы',promenade:'Аллеи и бульвары',sights:'Достопримечательности'},fun:{vr:'VR',quest:'Квесты',kids:'Детские центры',museum:'Музеи',gallery:'Галереи и выставки',bowling:'Боулинг',boardgames:'Настольные игры',computer:'Компьютерные клубы',billiards:'Бильярд',karaoke:'Караоке',club:'Ночные клубы'}};
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('ru-RU').format(value)+' ₸';
const localTime=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const routeURL=(point,p)=>'https://2gis.kz/astana/directions/points/'+encodeURIComponent(point.lon+','+point.lat+';'+p.point.lon+','+p.point.lat);
let category='any',items=[],currentPoint={...CENTER},context=null,weatherData=null;
let generation=0,controller=null,catalogParams=null,catalogOffset=0,closerRadius=null;
let capabilities={},history=[],factsRequest=0;

function safeSource(url) {
  try {const u=new URL(url);return u.protocol==='https:'&&['2gis.kz','ru.wikipedia.org'].includes(u.hostname)?u.href:'#';} catch {return '#';}
}
function newRequest() {
  controller?.abort();controller=new AbortController();generation++;
  $('submit').disabled=false;$('chat-send').disabled=false;
  if(document.querySelector('.chat-message.pending'))$('rag-state').textContent='Запрос отменён. Отправьте сообщение с новыми условиями.';
  document.querySelectorAll('.chat-message.pending').forEach(el=>{el.classList.remove('pending');el.textContent='Запрос отменён: условия изменились.';});
  return {id:generation,signal:controller.signal};
}
async function request(path,{params,body,signal}={}) {
  const timeout=AbortSignal.timeout(body?100000:18000);
  const response=await fetch(path+(params?'?'+params:''),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Не удалось получить данные.');
  return data;
}
function formParams() {
  const coords=$('location').value==='custom'?[$('lat').value,$('lon').value]:$('location').value.split(',');
  if(coords.some(v=>!String(v).trim()||!Number.isFinite(Number(v))))throw new Error('Укажите корректные координаты или выберите точку на карте.');
  const [lat,lon]=coords.map(Number);
  if(!insideArea({lat,lon}))throw new Error('Выберите точку в пределах 2 км от Хан Шатыра — это область нашего демо.');
  let at;
  if($('when').value==='custom') {
    if(!$('datetime').value)throw new Error('Выберите дату и время Астаны.');
    at=$('datetime').value+($('datetime').value.length===16?':00':'')+'+05:00';
  } else at=new Date(Date.now()+Number($('when').value==='now'?0:$('when').value)*3600000).toISOString();
  const p=new URLSearchParams({lat,lon,at,category,radius:closerRadius??$('radius').value,timeBudgetMinutes:$('available-time').value,
    features:[...$('features').querySelectorAll('input:checked')].map(i=>i.value).join(','),type:$('place-type').value,openOnly:$('open').checked});
  if((category==='eat'||category==='any')&&$('budget').value)p.set('maxAverageCheck',$('budget').value);
  return p;
}
function insideArea(p) {
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))return false;
  const r=x=>x*Math.PI/180,dlat=r(p.lat-CENTER.lat),dlon=r(p.lon-CENTER.lon);
  const h=Math.sin(dlat/2)**2+Math.cos(r(CENTER.lat))*Math.cos(r(p.lat))*Math.sin(dlon/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)))<=2000;
}
function featureFilters() {
  const group=types[category];$('type-label').hidden=!group;
  $('place-type').innerHTML='<option value="">Все виды</option>'+Object.entries(group||{}).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
  $('budget-label').hidden=!['eat','any'].includes(category);
  const keys=['eat','any'].includes(category)?['wifi','laptop','kidsMenu']:category==='walk'?['dogFriendly']:[];
  $('features').innerHTML=keys.map(key=>`<label class="check"><input type="checkbox" value="${key}">${featureNames[key]}</label>`).join('');
}
function syncMap() {updateMap({items,point:currentPoint,onDetail:detail,onPoint:pickPoint});}
function render() {
  $('results').innerHTML=items.map((p,i)=>{
    const travel=p.travel||p.route;
    const walk=travel?.durationSeconds!=null
      ?`≈ ${Math.ceil(travel.durationSeconds/60)} мин пешком`
      :`${Math.round(p.distanceMeters||0)} м по прямой`;
    const confirmed=Object.entries(p.features||{}).filter(([,value])=>value===true).slice(0,3);
    const price=p.categories?.includes('eat')?`<span class="stat"><span>Средний чек</span><strong>${p.averageCheck?money(p.averageCheck):'Не указан'}</strong></span>`:'';
    const status=opening[p.arrivalStatus||p.openingStatus]||'Расписание не указано';
    const why=p.why?.length?`<div class="card-reasons"><span class="mini-label">Почему подходит</span><p>${p.why.slice(0,2).map(text=>html(text)).join(' · ')}</p></div>`:'';
    const weather=placeWeather(p);
    const hasWeather=Boolean(p.weather||weatherData);
    const source=safeSource(p.source?.url);
    return `<article class="card" data-place-id="${html(p.id)}">
      <div class="card-top"><span class="place-symbol">${i+1}</span><span class="rubric">${html(p.rubrics?.find(r=>r.kind==='primary')?.name||p.rubrics?.[0]?.name||'Место')}</span></div>
      <h3>${html(p.name)}</h3><p class="address">${html(p.address||'Адрес не указан')}</p>
      <div class="card-stats"><span class="stat stat-walk"><span>От вас</span><strong>${html(walk)}</strong></span>${price}</div>
      <div class="card-status"><span class="status-dot ${p.arrivalStatus==='open_by_schedule'||p.openingStatus==='open_by_schedule'?'is-open':''}"></span>${html(status)}${p.bookingNote?' · нужна запись':''}</div>
      ${confirmed.length?`<div class="tags">${confirmed.map(([key])=>`<span class="tag">${html(featureNames[key])}</span>`).join('')}</div>`:''}
      ${why}
      ${p.visit?`<p class="visit-plan"><strong>${p.visit.minMinutes}–${p.visit.maxMinutes} мин</strong> на посещение <span>(примерно)</span></p>`:''}
      ${p.timeNote?`<p class="time-note">${html(p.timeNote)}</p>`:''}
      ${hasWeather?`<details class="card-extra"><summary>Погода в пути</summary><p>${html(weather)}</p></details>`:''}
      <div class="actions"><a class="action-main" href="${html(routeURL(currentPoint,p))}" target="_blank" rel="noopener noreferrer">Маршрут ↗</a><button data-detail="${i}">О месте</button><button data-closer="${i}" ${p.distanceMeters<=1?'disabled':''}>Ближе</button>${p.wikipediaTitle?`<button data-facts="${i}" title="История и факты">Факты ✧</button>`:''}</div>
      ${source!=='#'?`<a class="card-source" href="${html(source)}" target="_blank" rel="noopener noreferrer">Данные: 2ГИС ↗</a>`:''}
      </article>`;
  }).join('');
  syncMap();
}
function placeWeather(p) {
  if(p.weather)return p.weather.text+(p.weather.travelNote?' '+p.weather.travelNote:'');
  if(!weatherData)return capabilities.weather?'Погода загружается или недоступна. Проверьте прогноз перед выходом.':'Погода не подключена. Прогноз не учтён.';
  const travel=p.travel||p.route;
  return travel?transitionAdvice(weatherData.hours||[],context.at,travel.durationSeconds).text:weatherData.advice+' Время пешком не подтверждено.';
}
function contextFrom(params) {return {point:{lat:Number(params.get('lat')),lon:Number(params.get('lon'))},at:params.get('at'),radius:Number(params.get('radius'))};}
async function search({offset=0,params:provided,withRoutes=true}={}) {
  let params;
  try {params=provided?new URLSearchParams(provided):formParams();} catch(e){$('status').textContent=e.message;return;}
  const task=newRequest();params.set('limit','3');params.set('offset',String(offset));
  catalogParams=new URLSearchParams(params);catalogOffset=offset;context=contextFrom(params);currentPoint=context.point;
  items=[];weatherData=null;render();$('submit').disabled=true;$('load-more').hidden=true;
  $('status').textContent='Ищем подходящие места…';$('results-mode').textContent='РЕЗУЛЬТАТЫ ПО ФИЛЬТРАМ';$('count').textContent='';
  $('selection-note').textContent='Начало: '+localTime(context.at)+' · время Астаны · без обратной дороги.';
  void loadWeather(params,task);
  try {
    const data=await request('/api/places',{params,signal:task.signal});if(task.id!==generation)return;
    items=data.items;render();$('count').textContent=items.length?`${offset+1}–${offset+items.length} из ${data.total}`:'0 мест';
    $('status').textContent=items.length?'':'Ничего не нашлось. Попробуйте увеличить расстояние или убрать часть фильтров.';
    $('load-more').hidden=!data.hasMore;
    if(withRoutes&&capabilities.routes)await Promise.all(items.map(async p=>{
      try {const route=await request('/api/route',{params:new URLSearchParams({from_lat:currentPoint.lat,from_lon:currentPoint.lon,to_lat:p.point.lat,to_lon:p.point.lon}),signal:task.signal});if(task.id!==generation)return;p.route=route;}
      catch {if(task.id!==generation)return;p.routeFailed=true;}
      if(task.id===generation)render();
    }));
  } catch(e){if(task.id===generation)$('status').textContent=e.name==='TimeoutError'?'Поиск занял слишком много времени. Повторите запрос.':e.message;}
  finally{if(task.id===generation)$('submit').disabled=false;}
}
async function loadWeather(params,task) {
  $('weather-section').hidden=false;
  if(!capabilities.weather) {$('weather-section').textContent='Погода пока недоступна — места можно выбирать без прогноза.';return;}
  $('weather-section').textContent='Загружаем прогноз…';
  const query=new URLSearchParams({lat:params.get('lat'),lon:params.get('lon'),at:params.get('at'),durationMinutes:params.get('timeBudgetMinutes')==='0'?'240':params.get('timeBudgetMinutes')||'240'});
  try {
    const data=await request('/api/weather',{params:query,signal:task.signal});if(task.id!==generation)return;
    weatherData=data;renderWeather(data);render();
  } catch(e) {if(task.id!==generation)return;$('weather-section').textContent='Погода недоступна. Проверьте прогноз перед прогулкой.';render();}
}
function renderWeather(data) {
  const h=data.hours?.[0];
  const metric=(name,value,unit='')=>`<span class="weather-metric"><small>${name}</small><strong>${value==null?'—':html(value)+' '+unit}</strong></span>`;
  $('weather-section').innerHTML=`<div class="weather-summary"><div class="weather-summary-title"><span aria-hidden="true">◌</span><div><strong>Погода на ${html(localTime(data.period?.at||context.at))}</strong><p>${html(data.advice||'Проверьте прогноз перед выходом.')}</p></div></div>${h?`<div class="weather-metrics">${metric('Температура',h.temperature,'°C')}${metric('Ветер',h.windSpeed,'м/с')}${metric('Осадки',h.accumulatedPrec,'мм/ч')}</div>`:''}</div><details class="weather-details"><summary>Прогноз по часам</summary><p class="weather-coverage">${data.period?`Выбранное время: ${html(localTime(data.period.at))} — ${html(localTime(data.period.until))}. `:''}${data.forecastRange?`Прогноз доступен до ${html(localTime(data.forecastRange.until))}.`:''}</p><div class="forecast-scroll"><table><thead><tr><th>Время</th><th>°C</th><th>Ветер, м/с</th><th>Осадки, мм</th></tr></thead><tbody>${(data.outlook||[]).map(h=>`<tr><td>${html(localTime(h.time))}</td><td>${html(h.temperature??'—')}</td><td>${html(h.windSpeed??'—')}</td><td>${html(h.accumulatedPrec??'—')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function addMessage(text,who='assistant') {
  const el=document.createElement('div');el.className='chat-message '+who;el.textContent=text;$('chat-messages').append(el);
  $('chat-messages').scrollTop=$('chat-messages').scrollHeight;return el;
}
function reflectStart(at) {
  $('when').value='custom';$('date-label').hidden=false;$('datetime').required=true;
  $('datetime').value=new Date(Date.parse(at)+5*3600000).toISOString().slice(0,16);
}
$('chat-form').addEventListener('submit',async event=>{
  event.preventDefault();const message=$('chat-input').value.trim();if(!message||$('chat-send').disabled)return;
  let p;try{p=formParams();}catch(e){addMessage(e.message);return;}
  const task=newRequest();addMessage(message,'user');$('chat-input').value='';$('chat-send').disabled=true;
  const pending=addMessage('Подбираю варианты…','assistant pending');
  $('rag-state').textContent='Подбираем места…';
  try {
    const data=await request('/api/chat',{body:{message,history,radius:Number(p.get('radius')),lat:Number(p.get('lat')),lon:Number(p.get('lon')),at:p.get('at'),
      timeBudgetMinutes:Number(p.get('timeBudgetMinutes')),category,features:p.get('features').split(',').filter(Boolean),maxAverageCheck:Number(p.get('maxAverageCheck')||0),type:p.get('type'),openOnly:p.get('openOnly')==='true'},signal:task.signal});
    if(task.id!==generation)return;
    pending.classList.remove('pending');pending.textContent=data.message;history.push(message);history=history.slice(-4);
    if(data.unknowns?.length)addMessage('Пока не удалось проверить: '+data.unknowns.slice(0,2).join(' · '));
    if(data.usedData) {
      const u=data.usedData;p.set('at',u.at);if(u.startSource!=='form')reflectStart(u.at);
      if(data.timeBudgetMinutes)p.set('timeBudgetMinutes',String(data.timeBudgetMinutes));
    }
    items=data.items||[];context=contextFrom(p);currentPoint=context.point;catalogParams=null;weatherData=null;
    $('load-more').hidden=true;$('results-mode').textContent='ПОДОБРАНО ДЛЯ ВАС';$('count').textContent=items.length+' варианта';
    $('status').textContent=items.length?'':data.message;
    $('rag-state').textContent=data.generation==='grounded_model'?(data.retrieval==='hybrid_embeddings_and_structured_filters'?'Подобрано по базе · смысловой поиск':'Подобрано по базе · проверены условия'):data.generation==='verified_template_fallback'?'Подобрано по данным без ИИ':'Не удалось подтвердить подходящие места';
    render();void loadWeather(p,task);
    $('selection-note').textContent='Начало: '+localTime(context.at)+' · без обратной дороги.';
  } catch(e) {
    if(task.id!==generation)return;pending.classList.remove('pending');pending.textContent=e.name==='TimeoutError'?'Сервис не ответил вовремя. Используйте поиск по фильтрам или повторите запрос.':e.message;
    $('rag-state').textContent='Не удалось подобрать автоматически. Попробуйте фильтры.';
  } finally {if(task.id===generation)$('chat-send').disabled=false;}
});
function detail(i) {
  const p=items[i];if(!p)return;
  const schedule=Object.entries({Mon:'Пн',Tue:'Вт',Wed:'Ср',Thu:'Чт',Fri:'Пт',Sat:'Сб',Sun:'Вс'})
    .map(([day,name])=>`<li><strong>${name}</strong> ${(p.schedule?.[day]?.working_hours||[]).map(h=>html(h.from+'–'+h.to)).join(', ')||'не указано'}</li>`).join('');
  $('detail-content').innerHTML=`<p class="eyebrow">ИНФОРМАЦИЯ О МЕСТЕ</p><h2>${html(p.name)}</h2>
    <p class="detail-address">${html(p.address||'Адрес не указан')}</p>
    ${p.description?`<p>${html(p.description)}</p>`:''}
    <p class="detail-important"><strong>Режим работы:</strong> ${html(opening[p.arrivalStatus||p.openingStatus]||'Не указан')}${p.bookingNote?' · '+html(p.bookingNote):''}</p>
    <h3>Что известно</h3><ul class="detail-tags">${(p.attributes||[]).map(a=>`<li>${html(a.name)}</li>`).join('')||'<li>Дополнительных данных нет.</li>'}</ul>
    <details class="detail-schedule"><summary>Расписание по дням</summary><ul>${schedule}</ul></details>
    <p class="notice">Отсутствие данных не означает отсутствие услуги. Цены и свободные места уточняйте перед визитом. Данные 2ГИС${p.source?.fetchedAt?' · '+html(p.source.fetchedAt):''}.</p>
    <div class="detail-links"><a href="${html(routeURL(currentPoint,p))}" target="_blank" rel="noopener noreferrer">Открыть маршрут ↗</a>${safeSource(p.source?.url)!=='#'?`<a href="${html(safeSource(p.source?.url))}" target="_blank" rel="noopener noreferrer">Проверить в 2ГИС ↗</a>`:''}</div>
    ${p.wikipediaTitle?'<p><button id="detail-facts" class="small-button">Факты об этом месте ↗</button></p>':''}`;
  $('details').showModal();$('detail-facts')?.addEventListener('click',showFacts);
}
async function showFacts() {
  const id=++factsRequest;$('detail-content').innerHTML='<h2>Хан Шатыр</h2><p>Загружаем выдержку из Wikipedia…</p>';if(!$('details').open)$('details').showModal();
  try {
    const data=await request('/api/facts',{params:new URLSearchParams({title:'Хан Шатыр'})});
    if(id!==factsRequest||!$('details').open)return;
    // Verbatim sentences from the returned introductory extract, not invented history.
    const paragraphs=(data.text||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const facts=paragraphs.slice(0,3);
    $('detail-content').innerHTML=`<p class="eyebrow">WIKIPEDIA · ВЫДЕРЖКА ИЗ ВВЕДЕНИЯ</p><h2>${html(data.title||'Хан Шатыр')}</h2>${facts.length?facts.map(text=>`<p>${html(text)}</p>`).join(''):'<p>Описание не найдено.</p>'}${data.url?`<a href="${html(safeSource(data.url))}" target="_blank" rel="noopener noreferrer">Полная статья и авторы ↗</a>`:''}<p class="notice">Текст Wikipedia: атрибуция и лицензия указаны в исходной статье. История здания не подтверждает актуальные цены, услуги и расписание.</p>`;
  } catch {if(id===factsRequest&&$('details').open)$('detail-content').textContent='Не удалось загрузить Wikipedia. Повторите позже.';}
}
async function pickPoint(point) {
  if(!insideArea(point)){$('map-status').textContent='Эта точка вне области демо. Выберите точку внутри круга 2 км.';return;}
  $('location').value='custom';$('coordinates').hidden=false;$('lat').value=point.lat;$('lon').value=point.lon;closerRadius=null;
  await search({withRoutes:false});$('map-status').textContent='Исходная точка обновлена. Поиск и чат используют эту точку.';
}
function mobileView(map) {
  $('workspace').classList.toggle('mobile-map',map);$('view-chat').setAttribute('aria-pressed',String(!map));$('view-map').setAttribute('aria-pressed',String(map));resizeMap();
}
$('view-chat').addEventListener('click',()=>mobileView(false));$('view-map').addEventListener('click',()=>mobileView(true));
$('load-map').addEventListener('click',()=>void showMap());
$('pick-point').addEventListener('click',()=>{mobileView(true);$('workspace').scrollIntoView({block:'start',behavior:'smooth'});void showMap();});
$('results').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.detail!==undefined)detail(Number(b.dataset.detail));
  if(b.dataset.facts!==undefined)void showFacts();
  if(b.dataset.closer!==undefined) {
    const p=items[Number(b.dataset.closer)];closerRadius=Math.max(1,p.distanceMeters-1);
    // Preserve the applied context, not a newer unsubmitted form time.
    const query=catalogParams?new URLSearchParams(catalogParams):formParams();query.set('radius',String(closerRadius));if(context)query.set('at',context.at);
    // For a chat result, retain explicit evidence constraints through a follow-up request instead of silently dropping them.
    if(!catalogParams) {if(context)reflectStart(context.at);$('chat-input').value='Покажи варианты ближе с теми же условиями.';$('chat-form').requestSubmit();}
    else void search({params:query});
  }
});
$('search').addEventListener('submit',event=>{event.preventDefault();closerRadius=null;void search();});
$('load-more').addEventListener('click',()=>{if(catalogParams)void search({offset:catalogOffset+3,params:catalogParams});});
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{
  category=button.dataset.category;closerRadius=null;
  document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});featureFilters();void search({withRoutes:false});
}));
$('location').addEventListener('change',()=>{$('coordinates').hidden=$('location').value!=='custom';});
$('when').addEventListener('change',()=>{$('date-label').hidden=$('when').value!=='custom';$('datetime').required=$('when').value==='custom';});
// A pending chat must never overwrite results after its input context has changed.
$('search').addEventListener('change',()=>{
  newRequest();$('selection-note').textContent='Условия изменились. Нажмите «Найти по фильтрам» или отправьте новое сообщение.';
});
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('chat-input').value=button.dataset.example;$('chat-input').focus();}));
$('clear-chat').addEventListener('click',()=>{newRequest();history=[];$('chat-messages').replaceChildren();$('chat-input').value='';addMessage('Переписка очищена. Выбранная точка и фильтры не изменились.');$('rag-state').textContent='';});
$('landmark-facts').addEventListener('click',showFacts);
$('close-details').addEventListener('click',()=>{$('details').close();factsRequest++;});
$('details').addEventListener('close',()=>factsRequest++);
function information(title,paragraphs) {$('detail-content').innerHTML=`<h2>${html(title)}</h2>${paragraphs.map(text=>`<p>${html(text)}</p>`).join('')}`;factsRequest++;$('details').showModal();}
$('about').addEventListener('click',()=>information('Город под ваши планы',[
  'AstanaWalk — прототип для Build with AI / НИЦ Smart City. Три направления: еда, прогулки и развлечения. Достопримечательности входят в прогулки.',
  'База ограничена территорией в 2 км от Хан Шатыра. Пользователь выбирает одно из 1–3 мест; маршрут из нескольких остановок не строится.',
  'RAG: сначала ограничения и поиск по собранной базе, затем погода и маршруты, затем Gemini выбирает найденные ID и ключи фактов. Сервер проверяет ответ. При сбое генерации показывается явная отметка резервного режима.',
  'Длительность визита — оценка прототипа по категории. Время включает переход в одну сторону, без возвращения. Тарифы такси и расписания автобусов не подключены.',
]));
$('footer-about').addEventListener('click',()=>$('about').click());
$('footer-sources').addEventListener('click',()=>information('Источники данных',[
  '2ГИС: имена, адреса, координаты, рубрики, расписание, доступные признаки и средний чек. Сбор автоматизирован, но выборка не гарантирует полноты. Карточки содержат ссылки на источник.',
  '2ГИС Routing: оценка пешего пути. Яндекс Погода: почасовой прогноз на время начала, перехода и визита. Прогноз проверяется на непрерывное покрытие периода.',
  'Wikipedia: факты об архитектуре Хан Шатыра. Leaflet отображает карту; картографическая подложка поступает от настроенного поставщика (например, MapTiler). При открытии карты ему передаётся область просмотра.',
  'Gemini: извлечение условий и выбор по найденным данным; Gemini Embedding: поиск по смыслу. Наличие ключа и индекса не гарантирует доступность внешнего API.',
]));
const privacy=()=>information('Конфиденциальность',[
  'Мы не запрашиваем GPS. Вы выбираете точку вручную на карте или вводите координаты. Сообщение и до четырёх предыдущих сообщений передаются Gemini; не отправляйте личные данные.',
  'Приложение не добавляет точные координаты выбранной точки к запросу языковой модели. Однако места, расстояния и сам текст сообщения могут раскрывать приблизительный район; это не анонимизация.',
  'Точка передаётся Яндекс Погоде; начальная и конечная точки — 2ГИС Routing. Прогноз описывает район исходной точки, а не каждую улицу маршрута.',
  'Переписка хранится в памяти вкладки, без cookies и localStorage. Очистка удаляет её из интерфейса и будущего контекста, но не удаляет данные, уже переданные провайдерам.',
  'Сервер не пишет координаты и текст чата в файлы. Ответы маршрутов и погоды кешируются в памяти до пяти минут; временные хеши сетевых адресов используются для ограничения частоты. Логи хостинга и политика хранения внешних сервисов контролируются отдельно.',
  'При загрузке карты Leaflet CDN и выбранный поставщик картографической подложки могут получать IP-адрес и область просмотра. Ссылки на маршруты передают выбранные точки 2ГИС.',
]);
$('footer-privacy').addEventListener('click',privacy);$('privacy-inline').addEventListener('click',privacy);
async function boot() {
  featureFilters();syncMap();
  try {
    const health=await request('/api/health');capabilities=health.capabilities||{};
    $('health').textContent=health.places?`${health.places} мест рядом`:'Список мест пока пуст';
    if(!capabilities.aiChat)$('rag-state').textContent='Подбор по описанию временно недоступен. Поиск по фильтрам работает.';
  } catch {$('health').textContent='Нет связи с сервером';}
  await search({withRoutes:false});
}
void boot();
