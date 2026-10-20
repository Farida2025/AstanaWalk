import {placeTypes} from './categories.js';
import {openingStatus} from './places.js';

// Descriptions are assembled from source fields, never inferred amenities.
export function describePlace(p){
 const category=p.rubrics?.find(r=>r.kind==='primary')?.name||p.rubrics?.[0]?.name||'Место';
 const features=(p.attributes||[]).slice(0,3).map(a=>a.name);
 return `${p.name}. Категория: ${category}.${p.address?' Адрес: '+p.address+'.':''}${features.length?' В справочнике указано: '+features.join('; ')+'.':''}`;
}
export function visitOptions(p){
 const types=placeTypes(p);let min=20,max=40,action='Осмотреть место и сделать фотографии с общедоступной территории.';
 if(p.categories.includes('eat')){min=25;max=60;action='Выбрать напиток или блюдо по меню и сделать перерыв. Меню и наличие уточните на месте.';}
 else if(p.categories.includes('walk')){min=15;max=45;action='Пройтись по доступной части парка или сквера. Длину прогулки выбрать по самочувствию и погоде.';}
 else if(types.includes('museum')||types.includes('gallery')){min=40;max=90;action='Посмотреть экспозицию, предварительно уточнив доступ и билеты.';}
 else if(types.includes('quest')){min=60;max=90;action='Уточнить свободный сеанс, длительность и правила игры перед бронированием.';}
 else if(types.includes('vr')){min=30;max=60;action='Уточнить доступные игры, возрастные ограничения и свободный сеанс.';}
 else if(p.categories.includes('fun')){min=40;max=90;action='Выбрать занятие по профилю заведения, уточнив цену, правила и свободное время.';}
 return {minMinutes:min,maxMinutes:max,action,source:'Оценка прототипа по категории, не расписание и не длительность сеанса'};
}
export function weatherContext(data){
 if(!data||data.coverage!=='complete'||!data.hours?.length||data.hours.some(h=>['temperature','windGust','accumulatedPrec'].some(k=>typeof h[k]!=='number'||!Number.isFinite(h[k]))))return {available:false,adverse:false,text:'Прогноз на выбранное время недоступен. Погода не учтена при подборе.'};
 const hours=data.hours||[];
 const adverse=hours.some(h=>Number(h.temperature)<=-15||Number(h.temperature)>=30||Number(h.windGust)>=15||Number(h.accumulatedPrec)>0);
 return {available:true,adverse,text:data.advice,source:'Яндекс Погода',hours,period:data.period,forecastRange:data.forecastRange};
}
export function settingFor(p){
 if(p.categories.includes('walk'))return 'outdoor';
 if(p.categories.includes('eat')||placeTypes(p).some(t=>['museum','gallery','vr','quest','bowling','computer','boardgames','billiards','karaoke','club','kids'].includes(t)))return 'likely_indoor';
 return 'unknown';
}
export function contextualCandidates(places,{at,timeBudgetMinutes=0,withChild=false,weather}={}){
 return places.map(p=>{
 const visit=visitOptions(p);
 // Straight-line distance is a lower bound, never an ETA or a promise of feasibility.
 const minimumTravelMinutes=Math.ceil(p.distanceMeters/90);
 const budgetPossible=!timeBudgetMinutes||minimumTravelMinutes+visit.minMinutes<=timeBudgetMinutes;
 const setting=settingFor(p);
 const childMatch=placeTypes(p).some(t=>['kids','museum','park','square'].includes(t))||p.features?.kidsMenu===true;
 return {...p,visit,setting,minimumTravelMinutes,budgetPossible,childMatch};
 }).filter(p=>p.budgetPossible&&(!withChild||p.childMatch))
 .sort((a,b)=>(a.openingStatus==='closed_by_schedule')-(b.openingStatus==='closed_by_schedule')||
 (weather?.adverse?(a.setting==='outdoor')-(b.setting==='outdoor'):0)||0);
}
export function routePlan(p,route,at,timeBudgetMinutes=0){
 const original=p.visit||visitOptions(p);
 if(!route||!Number.isFinite(route.durationSeconds)||route.durationSeconds<0)return {...p,visit:original,travel:null,timeFit:timeBudgetMinutes?'unconfirmed':'not_requested',timeNote:'Время дороги не подтверждено. Расстояние по прямой не определяет длительность перехода.'};
 const travelMinutes=Math.ceil(route.durationSeconds/60);
 const arrivalMs=Date.parse(at)+route.durationSeconds*1000;
 const arrival=new Date(arrivalMs).toISOString();
 const allowed=timeBudgetMinutes ? Math.max(original.minMinutes,Math.min(original.maxMinutes,timeBudgetMinutes-travelMinutes)) : original.maxMinutes;
 const statuses=[];
 for(let minute=0;minute<allowed;minute++)statuses.push(openingStatus(p,new Date(arrivalMs+minute*60000).toISOString()));
 const minStatuses=statuses.slice(0,original.minMinutes);
 const visitOpen=minStatuses.every(s=>s==='open_by_schedule');
 const visitScheduleStatus=minStatuses.includes('closed_by_schedule')?'closed_by_schedule':visitOpen?'open_by_schedule':'unknown';
 const arrivalStatus=openingStatus(p,arrival);
 const fits=!timeBudgetMinutes||travelMinutes+original.minMinutes<=timeBudgetMinutes;
 const firstNotOpen=statuses.findIndex(s=>s!=='open_by_schedule');
 const maxMinutes=visitOpen&&firstNotOpen>=0?Math.max(original.minMinutes,firstNotOpen):allowed;
 const visit={...original,maxMinutes};
 return {...p,visit,travel:{...route,minutes:travelMinutes},arrival,arrivalStatus,visitOpen,visitScheduleStatus,
  timeFit:!fits?'exceeds':!visitOpen?'unconfirmed':'estimated_fit',
  timeNote:`Дорога около ${travelMinutes} мин, посещение ориентировочно ${visit.minMinutes}–${visit.maxMinutes} мин. Обратная дорога не включена.${!visitOpen?' Расписание не подтверждает, что место будет открыто всё время визита.':''}`};
}
