"""Offline browser integration tests, with synthetic HTTP + Leaflet contract fixtures.
Run: python test/browser-smoke.py
Requires Python Playwright and a Chromium binary. No navigation, external requests,
API credentials, genuine provider responses, or live map tiles are used here.
"""
from pathlib import Path
import json
import os
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('BROWSER_TEST_OUTPUT', ROOT / 'test-results'))
OUTPUT.mkdir(parents=True, exist_ok=True)
html = (ROOT / 'public/index.html').read_text()
html = re.sub(r'<script.*?</script>', '', html, flags=re.S)
html = re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
# The modules are concatenated only for this network-free harness. Production serves real ES modules.
source = ''
for name in ['route-weather.js', 'map.js', 'app.js']:
    part = (ROOT / 'public' / name).read_text()
    part = re.sub(r'^import .*?;\n', '', part, flags=re.M)
    part = re.sub(r'\bexport ', '', part)
    source += part + '\n'
fixtures = r'''
window.__calls=[]; window.__mode='ok'; window.__delay=0; window.__xss=false;
const fixture = (id,name) => ({id,name,address:'ТЕСТОВЫЙ АДРЕС',point:{lat:51.134,lon:71.405},categories:['eat'],
 rubrics:[{name:'Кофейни',kind:'primary'}],features:{wifi:true,laptop:true,kidsMenu:null},averageCheck:3000,
 distanceMeters:300,openingStatus:'open_by_schedule',attributes:[{name:'Wi-Fi',tag:'wifi'}],
 schedule:{Tue:{working_hours:[{from:'09:00',to:'23:00'}]}},bookingNote:null,
 description:'СИНТЕТИЧЕСКАЯ ЗАПИСЬ ДЛЯ АВТОТЕСТА',source:{provider:'fixture',fetchedAt:'2026-10-20',url:'https://2gis.kz/astana/firm/test'},
 visit:{minMinutes:25,maxMinutes:60,action:'ТЕСТОВОЕ ДЕЙСТВИЕ'},why:['Wi-Fi'],timeNote:'ТЕСТОВОЕ ВРЕМЯ',recommendationSource:'ТЕСТОВЫЙ ОТВЕТ'});
window.fetch=async(path,options={})=>{
 const url=new URL(path,'https://test.invalid');const body=options.body?JSON.parse(options.body):null;
 window.__calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),body});
 if(window.__delay&&url.pathname==='/api/chat')await new Promise((resolve,reject)=>{
   const t=setTimeout(resolve,window.__delay);options.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});
 });
 let result={};
 if(url.pathname==='/api/health')result={places:105,index:{ready:true},capabilities:{routes:true,weather:true,aiChat:true}};
 if(url.pathname==='/api/places')result={items:[fixture('fixture-1','Тестовая кофейня A'),fixture('fixture-2','Тестовая кофейня B'),fixture('fixture-3','Тестовая кофейня C')],total:3,hasMore:false};
 if(url.pathname==='/api/route')result={durationSeconds:600,lengthMeters:700};
 if(url.pathname==='/api/weather'){
  if(window.__mode==='weather-failure')throw new Error('Simulated outage');
  const at=url.searchParams.get('at');const start=Math.floor(Date.parse(at)/3600000)*3600000;
  const hours=Array.from({length:24},(_,i)=>({timestamp:(start+i*3600000)/1000,time:new Date(start+i*3600000).toISOString(),temperature:9,windSpeed:3,windGust:5,accumulatedPrec:0}));
  result={coverage:'complete',hours,outlook:hours.slice(0,6),advice:'СИНТЕТИЧЕСКИЙ ПРОГНОЗ ДЛЯ АВТОТЕСТА',period:{at,until:new Date(Date.parse(at)+90*60000).toISOString()},forecastRange:{from:hours[0].time,until:hours.at(-1).time}};
 }
 if(url.pathname==='/api/chat'){
  const at=new Date(Date.parse(body.at)+2*3600000).toISOString();
  const name=window.__mode==='xss'?'<img src=x onerror="window.__xss=true">':'Тестовый выбор ИИ';
  result={message:'СИНТЕТИЧЕСКИЙ ОТВЕТ ЧАТА ДЛЯ АВТОТЕСТА',items:[fixture('fixture-chat',name)],unknowns:[],generation:'grounded_model',retrieval:'hybrid_embeddings_and_structured_filters',timeBudgetMinutes:90,
    usedData:{at,startSource:'message_relative',radius:body.radius,features:body.features,maxAverageCheck:body.maxAverageCheck},weather:{text:'ТЕСТОВАЯ ПОГОДА'}};
 }
 if(url.pathname==='/api/facts')result={title:'Хан Шатыр',text:'СИНТЕТИЧЕСКИЙ ТЕКСТ ДЛЯ АВТОТЕСТА',url:'https://ru.wikipedia.org/wiki/Хан_Шатыр'};
 return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
};
// Minimal Leaflet contract double: verifies map state wiring, not cartography or tiles.
window.__markers=[];
const testLayer={clearLayers(){window.__markers=[];},addTo(){return this;}};
window.L={
 map(){window.__map={handlers:{},setView(){return this;},on(name,fn){this.handlers[name]=fn;return this;},invalidateSize(){},fitBounds(){}};return window.__map;},
 tileLayer(){return {addTo(){return this;},on(){}};},circle(){return {addTo(){return this;}};},
 layerGroup(){return testLayer;},divIcon(value){return value;},latLngBounds(value){return value;},
 marker(coord,options){window.__markers.push({coord,options});return {addTo(){return this;},bindPopup(){return this;}};},
};
'''
checks = []
def check(name, condition):
    assert condition, name
    checks.append(name)

with sync_playwright() as p:
    binary = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
    launch = {'headless': True, 'args': ['--no-sandbox']}
    if binary:
        launch['executable_path'] = binary
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.set_default_timeout(7000)
    page.on('pageerror', lambda error: (errors.append(str(error)), print('BROWSER ERROR:',str(error))))
    page.set_content(html)
    page.add_style_tag(content=(ROOT/'public/style.css').read_text())
    page.add_script_tag(content=fixtures)
    page.add_script_tag(content=source)
    page.wait_for_function("document.querySelectorAll('.card').length===3")
    check('initial catalog renders three cards', page.locator('.card').count() == 3)
    check('desktop has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
    page.locator('#load-map').click()
    page.wait_for_function('window.__markers.length===4')
    check('map receives origin and the same three cards', page.evaluate('window.__markers.length') == 4)
    page.locator('[data-category="eat"]').click()
    page.wait_for_function("document.querySelectorAll('.card').length===3")
    page.locator('.filter-details summary').click()
    page.locator('#budget').select_option('5000')
    page.locator('#features input[value="wifi"]').check()
    page.locator('#chat-input').fill('Через два часа хочу кофе. У меня 90 минут.')
    page.locator('#chat-send').click()
    page.wait_for_function("document.querySelector('#results').textContent.includes('Тестовый выбор ИИ')")
    sent=page.evaluate("window.__calls.filter(c=>c.path==='/api/chat').at(-1).body")
    check('chat payload includes selected category, budget and Wi-Fi', sent['category']=='eat' and sent['maxAverageCheck']==5000 and sent['features']==['wifi'])
    check('chat cards and map replace catalog together', page.locator('.card').count()==1 and page.evaluate('window.__markers.length')==2)
    check('effective start time is reflected in the form', page.locator('#when').input_value()=='custom' and bool(page.locator('#datetime').input_value()))
    check('actual retrieval mode is visible', 'смысловой поиск' in page.locator('#rag-state').inner_text())
    page.evaluate("window.__map.handlers.click({latlng:{lat:51.133,lng:71.403}})")
    page.wait_for_function("document.querySelector('#lat').value==='51.133' && document.querySelectorAll('.card').length===3")
    check('map click changes the form point', page.locator('#location').input_value()=='custom')
    check('map click searches with that point', page.evaluate("window.__calls.filter(c=>c.path==='/api/places').at(-1).query.lat")=='51.133')
    page.evaluate("window.__map.handlers.click({latlng:{lat:0,lng:0}})")
    check('out-of-area click cannot change the origin', page.locator('#lat').input_value()=='51.133' and 'вне области' in page.locator('#map-status').inner_text())
    page.locator('#clear-chat').click()
    page.locator('#chat-input').fill('Кофе')
    page.locator('#chat-send').click()
    page.wait_for_function("document.querySelector('#results').textContent.includes('Тестовый выбор ИИ')")
    check('clear chat removes previous context from next request', page.evaluate("window.__calls.filter(c=>c.path==='/api/chat').at(-1).body.history.length")==0)
    page.evaluate("window.__mode='xss'")
    page.locator('#chat-input').fill('Тест экранирования')
    page.locator('#chat-send').click()
    page.wait_for_function("document.querySelector('#results').textContent.includes('<img')")
    check('source text is escaped and cannot execute HTML', not page.evaluate('window.__xss') and page.locator('#results img').count()==0)
    page.evaluate("window.__mode='ok';window.__delay=250")
    page.locator('#chat-input').fill('Задержанный ответ')
    page.locator('#chat-send').click()
    page.locator('#radius').select_option('1000')
    page.wait_for_timeout(400)
    check('changing conditions cancels a pending response', 'условия изменились' in page.locator('#chat-messages').inner_text())
    check('cancellation clears the loading indicator', 'Выполняется запрос' not in page.locator('#rag-state').inner_text())
    check('cancelled pending response does not replace cards', '<img' in page.locator('#results').inner_text())
    page.evaluate("window.__mode='weather-failure';window.__delay=0")
    page.locator('#submit').click()
    page.wait_for_function("document.querySelectorAll('.card').length===3 && document.querySelector('#weather-section').textContent.includes('недоступна')")
    check('weather failure preserves catalog and explicit warning', page.locator('.card').count()==3)
    page.evaluate("window.__mode='ok'")
    page.set_viewport_size({'width':390,'height':844})
    check('mobile has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
    page.locator('#view-map').click()
    check('mobile map tab hides chat and shows map', page.locator('#map-panel').is_visible() and not page.locator('#chat-panel').is_visible())
    page.locator('#view-chat').click()
    check('mobile chat tab restores chat', page.locator('#chat-panel').is_visible() and not page.locator('#map-panel').is_visible())
    page.screenshot(path=str(OUTPUT/'mobile-fixture.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    page.screenshot(path=str(OUTPUT/'desktop-fixture.png'),full_page=True)
    check('no browser JavaScript exceptions', not errors)
    browser.close()
report={'passed':len(checks),'checks':checks,'errors':errors,'mode':'offline synthetic HTTP fixtures and Leaflet contract double; not live provider or real tile verification'}
(OUTPUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
