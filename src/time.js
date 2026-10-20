/** Dates crossing the API boundary always have an explicit offset. */
export function validInstant(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [,y,m,d,h,min,sec] = match;
  return +m>=1 && +m<=12 && +d>=1 && +d<=new Date(Date.UTC(+y,+m,0)).getUTCDate() && +h<24 && +min<60 && +(sec||0)<60;
}

// Explicit, common relative phrases are resolved independently of the model.
// Less common/absolute expressions are extracted by Gemini and validated below.
export function resolveStart(message, intent, selectedAt, now = new Date()) {
  const text = message.toLowerCase();
  const values = {полчаса: 0.5,полтора:1.5,один:1,одну:1,два:2,две:2,три:3,четыре:4,пять:5,one:1,two:2,three:3};
  const match = text.match(/(?:через|in)\s+(полчаса|полтора|один|одну|два|две|три|четыре|пять|one|two|three|\d+(?:[.,]\d+)?)\s*(час\w*|мин\w*|hours?|minutes?)?/u);
  let delay = -1;
  if (match && (match[2] || match[1] === 'полчаса')) {
    const n = values[match[1]] ?? Number(match[1].replace(',', '.'));
    delay = n * (/^(мин|minute)/.test(match[2] || '') ? 1 : 60);
  } else if (Number.isInteger(intent.startOffsetMinutes) && intent.startOffsetMinutes >= 0) {
    delay = intent.startOffsetMinutes;
  }
  if (delay >= 0) {
    if (delay > 20160) throw new Error('Время начала слишком далеко. Выберите время в форме.');
    return {at: new Date(now.getTime() + delay * 60000).toISOString(), source: 'message_relative'};
  }
  if (intent.startAt) {
    if (!validInstant(intent.startAt)) throw new Error('Не удалось разобрать дату. Выберите время в форме.');
    return {at: new Date(intent.startAt).toISOString(), source: 'message_absolute'};
  }
  return {at: selectedAt, source: 'form'};
}
