export function weatherMessage(hours,{walking=false,longWalk=false}={}){
  if(!hours.length||hours.some(h=>['temperature','windGust','accumulatedPrec'].some(k=>typeof h[k]!=='number'||!Number.isFinite(h[k]))))return 'Погодные данные неполные. Нельзя подтвердить отсутствие осадков или сильного ветра.';
  const minTemp=Math.min(...hours.map(h=>Number(h.temperature)).filter(Number.isFinite));
  const maxTemp=Math.max(...hours.map(h=>Number(h.temperature)).filter(Number.isFinite));
  const gust=Math.max(...hours.map(h=>Number(h.windGust)||0));
  const rain=Math.max(...hours.map(h=>Number(h.accumulatedPrec)||0));
  const wet=hours.filter(h=>Number(h.accumulatedPrec)>0);
  const types=new Set(wet.map(h=>h.precType));
  const wetSnow=types.has('SLEET')||(types.has('SNOW')&&types.has('RAIN'));
  const snow=types.has('SNOW')&&!types.has('RAIN');
  const liquid=types.has('RAIN')&&!wetSnow;
  if(gust>=20)return 'Прогнозируются очень сильные порывы ветра. Лучше сократить пребывание на улице и рассмотреть место в помещении; перед выходом проверьте официальные предупреждения.';
  if(types.has('HAIL'))return 'По прогнозу возможен град. Лучше выбрать место в помещении и сократить переходы по улице; перед выходом уточните прогноз.';
  if(wetSnow)return 'Ожидается дождь со снегом. Возьмите непромокаемую куртку с капюшоном и тёплую обувь; длинный переход можно заменить транспортом.';
  if(snow)return `По прогнозу ожидается снег${minTemp<=-10?' и мороз':''}. Наденьте тёплую куртку, перчатки и подходящую обувь.${longWalk?' Переход долгий: можно выбрать место ближе.':''}`;
  if(liquid){
    if(gust>=10)return 'Ожидается дождь с порывистым ветром. Куртка с капюшоном или дождевик удобнее зонта; можно выбрать место ближе или добраться транспортом.';
    if(rain>=2)return 'Ожидается дождь с заметным количеством осадков. Возьмите зонт и непромокаемую обувь; для долгой дороги лучше рассмотреть транспорт.';
    return `По прогнозу ожидается дождь. Возьмите зонт или лёгкий дождевик.${longWalk?' До места больше 20 минут пешком: можно выбрать вариант ближе.':''}`;
  }
  if(minTemp<=-15)return `Прогнозируется мороз до ${minTemp} °C${gust>=10?' и порывистый ветер':''}. Для досуга лучше выбрать помещение, а длинный пеший переход заменить транспортом.`;
  if(rain>=2)return walking?'На время перехода прогнозируются заметные осадки. Показать место ближе? До выбранного можно рассмотреть такси или общественный транспорт.':'Прогнозируются заметные осадки. Для прогулки лучше выбрать другое время, а сейчас посмотреть развлечения в помещении.';
  if(rain>0&&gust>=10)return 'Прогнозируются осадки и порывистый ветер. Короткий переход будет удобнее долгой прогулки; можно выбрать место ближе или добраться транспортом.';
  if(rain>0)return walking?`На время перехода прогнозируются осадки. ${longWalk?'Дорога займёт больше 20 минут: можно выбрать место ближе или рассмотреть транспорт.':'Переход короткий, но стоит взять зонт или непромокаемую одежду.'}`:'В выбранный час ожидаются осадки. Можно перенести прогулку или выбрать кафе, галерею либо другое место в помещении.';
  if(maxTemp>=30)return 'Прогнозируется жара. Для прогулки выбирайте короткие переходы и перерывы в помещении, возьмите воду.';
  if(gust>=15)return 'Прогнозируются сильные порывы ветра. Можно выбрать место ближе или рассмотреть транспорт вместо долгого перехода.';
  if(minTemp<=0)return `Прогнозируется ${minTemp} °C, осадков не ожидается. Для прогулки стоит одеться теплее${longWalk?' и запланировать перерыв в помещении':''}.`;
  if(minTemp<=8)return walking?'На время перехода осадков не ожидается, но будет прохладно. Возьмите тёплый слой одежды.':'Будет прохладно, без осадков по прогнозу. Можно совместить короткую прогулку с отдыхом в кафе.';
  if(gust>=10)return 'Осадков по прогнозу нет, но ветер будет порывистым. Для прогулки пригодится верхняя одежда.';
  return walking?'По почасовому прогнозу на время перехода осадков не ожидается и сильных порывов нет. Можно идти пешком, если вам подходит расстояние.':'В выбранный час осадков и сильных порывов не ожидается. Хороший повод посмотреть парки и прогулочные места.';
}
export function transitionAdvice(hours,startTime,durationSeconds) {
  const start=new Date(startTime).getTime(),end=start+durationSeconds*1000;
  if(!Number.isFinite(start)||!Number.isFinite(durationSeconds)||durationSeconds<=0)return {available:false,text:'Недостаточно данных для оценки погоды во время перехода.'};
  const relevant=hours.filter(h=>Number(h.timestamp)*1000<end&&Number(h.timestamp)*1000+3600000>start).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
  let coveredUntil=start;
  for(const h of relevant){const t=Number(h.timestamp)*1000;if(t>coveredUntil)break;coveredUntil=Math.max(coveredUntil,t+3600000);}
  if(coveredUntil<end)return {available:false,text:'Прогноз не покрывает весь переход. Проверьте погоду перед выходом.'};
  if(relevant.some(h=>['temperature','windGust','accumulatedPrec'].some(k=>typeof h[k]!=='number'||!Number.isFinite(h[k]))))return {available:false,text:'Данные погоды во время перехода неполные.'};
  return {available:true,text:weatherMessage(relevant,{walking:true,longWalk:durationSeconds>1200})};
}
