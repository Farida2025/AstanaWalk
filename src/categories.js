export const typeLabels={sights:'Достопримечательности',park:'Парки',square:'Скверы',promenade:'Аллеи и прогулочные пространства',vr:'Виртуальная реальность',quest:'Квесты',kids:'Детские центры',museum:'Музеи',gallery:'Галереи и выставки',bowling:'Боулинг',boardgames:'Настольные игры',computer:'Компьютерные клубы',billiards:'Бильярд',karaoke:'Караоке',club:'Ночные клубы'};
export function placeTypes(place){
  const text=(place.rubrics??[]).map(r=>r.name).join(' ').toLowerCase();
  const types=[];
  if(/парки|скверы|аллеи|бульвар/.test(text)){
    const name=place.name.toLowerCase();
    types.push(/сквер/.test(name)?'square':/алле|бульвар|набереж/.test(name)?'promenade':'park');
  }
  for(const [key,pattern] of Object.entries({vr:/виртуальн/,quest:/квест/,kids:/детские игровые|детские развлекательные/,museum:/музе/,gallery:/галере|художественные выставки/,bowling:/боулинг/,boardgames:/настольных игр/,computer:/компьютерные клубы|видеоигр/,billiards:/бильярд/,karaoke:/караоке/,club:/ночные клубы/}))if(pattern.test(text))types.push(key);
  return types;
}
