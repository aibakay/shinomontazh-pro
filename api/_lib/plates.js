// Проверка госномеров (11.11.2026): в поле «Госномер» иногда писали марку машины, имя или телефон.
// Здесь — как понять, что значение не номер, и куда его лучше перенести. Сам перенос делает api/crm.js
// (действие «plates»), владелец сначала видит список и подтверждает.
const { plate } = require('./schema');

const PL = 'АВЕКМНОРСТУХ', TW_LAT = 'ABEKMHOPCTYX';
const L = '[' + PL + ']';
// российские форматы (обычный, такси/прицеп, мото, полиция) и старые украинские (Крым до 2015 г.)
const FORMATS = [
  new RegExp('^' + L + '\\d{3}' + L + '{2}\\d{2,3}$'), new RegExp('^' + L + '{2}\\d{3,4}\\d{2,3}$'),
  new RegExp('^\\d{4}' + L + '{2}\\d{2,3}$'), new RegExp('^' + L + '\\d{4}\\d{2,3}$'), new RegExp('^' + L + '{2}\\d{4}' + L + '{2}$')
];

// [как показать, варианты написания] — сравниваются уже «по-госномерному» (заглавные, без пробелов, двойники → кириллица)
const BRANDS = [
  ['Toyota', 'ТОЙОТА TOYOTA ТАЙОТА'], ['Lada', 'ЛАДА LADA'], ['ВАЗ', 'ВАЗ VAZ'], ['Kia', 'КИА KIA'],
  ['Hyundai', 'ХЕНДАЙ ХУНДАЙ ХЁНДАЙ ХЕНДЭ ХЁНДЭ ХУНДАИ HYUNDAI HYUNDAY'], ['Renault', 'РЕНО RENAULT'],
  ['Volkswagen', 'ФОЛЬКСВАГЕН ФОЛЬКСВАГЕН ФОЛЬЦВАГЕН ФОЛЬЦ VOLKSWAGEN VW'], ['Skoda', 'ШКОДА SKODA'], ['Nissan', 'НИССАН НИСАН NISSAN'],
  ['Mitsubishi', 'МИЦУБИСИ МИЦУБИШИ МИТСУБИСИ МИТСУБИШИ MITSUBISHI'], ['Mazda', 'МАЗДА MAZDA'], ['Honda', 'ХОНДА HONDA'],
  ['Mercedes', 'МЕРСЕДЕС МЕРС MERCEDES BENZ'], ['BMW', 'БМВ БЭХА BMW'], ['Audi', 'АУДИ AUDI'], ['Ford', 'ФОРД FORD'],
  ['Chevrolet', 'ШЕВРОЛЕ ШЕВРОЛЕТ ШЕВИ CHEVROLET CHEVY'], ['Opel', 'ОПЕЛЬ OPEL'], ['Peugeot', 'ПЕЖО PEUGEOT'], ['Citroen', 'СИТРОЕН CITROEN'],
  ['Subaru', 'СУБАРУ SUBARU'], ['Suzuki', 'СУЗУКИ SUZUKI'], ['Lexus', 'ЛЕКСУС LEXUS'], ['Infiniti', 'ИНФИНИТИ INFINITI'], ['Volvo', 'ВОЛЬВО VOLVO'],
  ['Geely', 'ДЖИЛИ ЖИЛИ GEELY'], ['Chery', 'ЧЕРИ CHERY'], ['Haval', 'ХАВАЛ ХАВЕЙЛ ХАВЭЙЛ HAVAL'], ['Great Wall', 'ГРЕЙТВОЛ GREATWALL'],
  ['Changan', 'ЧАНГАН CHANGAN'], ['Exeed', 'ЭКСИД EXEED'], ['Omoda', 'ОМОДА OMODA'], ['Tank', 'ТАНК TANK'], ['Jetour', 'ДЖЕТУР JETOUR'],
  ['УАЗ', 'УАЗ UAZ'], ['Газель', 'ГАЗЕЛЬ GAZELLE'], ['ГАЗ', 'ГАЗ GAZ'], ['Нива', 'НИВА NIVA'], ['Daewoo', 'ДЭУ ДЕУ DAEWOO'], ['Land Rover', 'ЛЕНДРОВЕР ЛЭНДРОВЕР LANDROVER'],
  ['Range Rover', 'РЕНДЖРОВЕР РЭНДЖРОВЕР RANGEROVER'], ['Porsche', 'ПОРШЕ PORSCHE'], ['Jeep', 'ДЖИП JEEP'], ['Fiat', 'ФИАТ FIAT'],
  ['Datsun', 'ДАТСУН DATSUN'], ['Москвич', 'МОСКВИЧ'], ['Tesla', 'ТЕСЛА TESLA'], ['Zeekr', 'ЗИКР ZEEKR'], ['BYD', 'BYD'], ['JAC', 'ДЖАК JAC'],
  ['Dongfeng', 'ДОНГФЕНГ DONGFENG'], ['Belgee', 'БЕЛДЖИ BELGEE'], ['Cadillac', 'КАДИЛЛАК CADILLAC'], ['Acura', 'АКУРА ACURA'],
  ['Smart', 'СМАРТ SMART'], ['Mini', 'МИНИ MINI'], ['Ravon', 'РАВОН RAVON'], ['SsangYong', 'САНГЙОНГ ССАНГЙОНГ SSANGYONG'], ['Iveco', 'ИВЕКО IVECO'],
  ['КамАЗ', 'КАМАЗ KAMAZ'], ['Камри', 'КАМРИ CAMRY'], ['Королла', 'КОРОЛЛА КОРОЛА COROLLA'], ['Land Cruiser', 'КРУЗАК ЛЕНДКРУЗЕР ЛЭНДКРУЗЕР LANDCRUISER'],
  ['Прадо', 'ПРАДО PRADO'], ['RAV4', 'РАВ4 RAV4'], ['Гранта', 'ГРАНТА GRANTA'], ['Веста', 'ВЕСТА VESTA'], ['Приора', 'ПРИОРА PRIORA'],
  ['Калина', 'КАЛИНА KALINA'], ['Ларгус', 'ЛАРГУС LARGUS'], ['Логан', 'ЛОГАН LOGAN'], ['Сандеро', 'САНДЕРО SANDERO'], ['Дастер', 'ДАСТЕР DUSTER'],
  ['Каптюр', 'КАПТЮР KAPTUR CAPTUR'], ['Рио', 'РИО RIO'], ['Спортейдж', 'СПОРТЕЙДЖ СПОРТАЖ SPORTAGE'], ['Сид', 'СИД CEED'], ['Церато', 'ЦЕРАТО CERATO'],
  ['Соренто', 'СОРЕНТО SORENTO'], ['Солярис', 'СОЛЯРИС SOLARIS'], ['Крета', 'КРЕТА CRETA'], ['Туссан', 'ТУССАН ТУКСОН TUCSON'], ['Элантра', 'ЭЛАНТРА ELANTRA'],
  ['Акцент', 'АКЦЕНТ ACCENT'], ['Гетц', 'ГЕТЦ GETZ'], ['Поло', 'ПОЛО POLO'], ['Пассат', 'ПАССАТ PASSAT'], ['Гольф', 'ГОЛЬФ GOLF'], ['Джетта', 'ДЖЕТТА JETTA'],
  ['Тигуан', 'ТИГУАН TIGUAN'], ['Туарег', 'ТУАРЕГ TOUAREG'], ['Октавия', 'ОКТАВИЯ OCTAVIA'], ['Рапид', 'РАПИД RAPID'], ['Фабия', 'ФАБИЯ FABIA'],
  ['Фокус', 'ФОКУС FOCUS'], ['Мондео', 'МОНДЕО MONDEO'], ['Лансер', 'ЛАНСЕР LANCER'], ['Аутлендер', 'АУТЛЕНДЕР OUTLANDER'], ['Паджеро', 'ПАДЖЕРО PAJERO'],
  ['X-Trail', 'ИКСТРЕЙЛ XTRAIL'], ['Кашкай', 'КАШКАЙ QASHQAI'], ['Альмера', 'АЛЬМЕРА ALMERA'], ['Жук', 'ЖУК JUKE'], ['Цивик', 'ЦИВИК CIVIC'],
  ['Аккорд', 'АККОРД ACCORD'], ['Матиз', 'МАТИЗ MATIZ'], ['Нексия', 'НЕКСИЯ NEXIA'], ['Ланос', 'ЛАНОС LANOS'], ['Джентра', 'ДЖЕНТРА GENTRA'],
  ['Кобальт', 'КОБАЛЬТ COBALT'], ['Авео', 'АВЕО AVEO'], ['Круз', 'КРУЗ CRUZE'], ['Лачетти', 'ЛАЧЕТТИ LACETTI'], ['Астра', 'АСТРА ASTRA'],
  ['Корса', 'КОРСА CORSA'], ['Вектра', 'ВЕКТРА VECTRA'], ['Хайлюкс', 'ХАЙЛЮКС HILUX'], ['Приус', 'ПРИУС PRIUS']
].map(function (b) { return [b[0], b[1].split(' ').map(plate)]; });

const NAMES = ('АЛЕКСАНДР АЛЕКСЕЙ АНАТОЛИЙ АНДРЕЙ АНТОН АРКАДИЙ АРСЕН АРСЕНИЙ АРТЁМ АРТЕМ АРТУР БОГДАН БОРИС ВАДИМ ВАЛЕНТИН ВАЛЕРИЙ ВАСИЛИЙ ' +
  'ВИКТОР ВИТАЛИЙ ВЛАДИМИР ВЛАДИСЛАВ ВЯЧЕСЛАВ ГЕННАДИЙ ГЕОРГИЙ ГЛЕБ ГРИГОРИЙ ДАНИИЛ ДАНИЛ ДЕНИС ДМИТРИЙ ЕВГЕНИЙ ЕГОР ЭДУАРД ЭМИЛЬ ЭРНЕСТ ЗАУР ' +
  'ИВАН ИГОРЬ ИЛЬЯ ИЛЬЯС ИЛЬДАР ИСЛАМ КИРИЛЛ КОНСТАНТИН ЛЕОНИД ЛЕВ МАКСИМ МАРАТ МАРК МИХАИЛ НИКИТА НИКОЛАЙ ОЛЕГ ПАВЕЛ ПЁТР ПЕТР РАМИЛЬ РОМАН ' +
  'РУСЛАН РУСТЕМ РУСТАМ СЕРГЕЙ СЕЙРАН СТАНИСЛАВ СТЕПАН ТАРАС ТИМУР ТИМОФЕЙ ФЁДОР ФЕДОР ФИЛИПП ЮРИЙ ЯРОСЛАВ ЭСКЕНДЕР ЭНВЕР ЛЕНУР ЭДЕМ ДЖЕМИЛЬ ' +
  'АЛИ АЙДЕР АЗИЗ НАРИМАН РЕШАТ РЕФАТ САША САНЯ ШУРА ЛЁША ЛЕША ДИМА ВОВА ВОЛОДЯ СЕРЁЖА СЕРЕЖА ЖЕНЯ КОСТЯ КОЛЯ МИША ПАША ВАНЯ ВИТЯ ЮРА СЛАВА ' +
  'ГРИША ТОЛЯ ВАЛЕРА ГЕНА РОМА СТАС МАКС ДЕН ТЁМА ТЕМА ' +
  'АЛЕКСАНДРА АЛЁНА АЛЕНА АЛИНА АЛЛА АНАСТАСИЯ АННА АНЯ АНТОНИНА ВАЛЕНТИНА ВАЛЕРИЯ ВАРВАРА ВЕРА ВЕРОНИКА ВИКТОРИЯ ВИКА ГАЛИНА ГАЛЯ ДАРЬЯ ДАША ' +
  'ДИАНА ЕВГЕНИЯ ЕКАТЕРИНА КАТЯ ЕЛЕНА ЛЕНА ЕЛИЗАВЕТА ЛИЗА ЖАННА ЗИНАИДА ЗАРИНА ЗАРЕМА ЭЛЬМИРА ЭЛЬВИРА ЭЛЬВИНА ЛЕНИЕ ЛИЛИЯ ИННА ИРИНА ИРА ' +
  'КАРИНА КРИСТИНА КСЕНИЯ КСЮША ЛАРИСА ЛЮБОВЬ ЛЮБА ЛЮДМИЛА ЛЮДА МАРГАРИТА РИТА МАРИНА МАРИЯ МАША НАДЕЖДА НАДЯ НАТАЛЬЯ НАТАША НАТАЛИЯ НИНА ' +
  'ОКСАНА ОЛЬГА ОЛЯ ПОЛИНА РАИСА СВЕТЛАНА СВЕТА СОФИЯ СОФЬЯ ТАМАРА ТАТЬЯНА ТАНЯ ЭЛЬЗА ЮЛИЯ ЮЛЯ ЯНА').split(' ').map(plate);
// фамилия по окончанию (Иванов, Петрова, Шевченко, Ковальчук, Сафарян…)
const SURNAME = /(ОВ|ЕВ|ЁВ|ИН|ЫН|ОВА|ЕВА|ЁВА|ИНА|ЫНА|СКИЙ|ЦКИЙ|СКАЯ|ЦКАЯ|ЕНКО|ЧУК|ЩУК|ЯН|ВИЧ|ОВНА|ЕВНА|ИЧНА)$/;
const JUNK = /^(НЕТ|НЕТУ|БЕЗНОМЕРА|БЕЗНОМЕРОВ|БЕЗНОМ|БН|Б\/Н|НЕЗНАЮ|НЕИЗВЕСТНО|НОМЕР|ГОСНОМЕР|КЛИЕНТ|ТЕСТ|TEST|ТЕST|[?.,_*+\/0Х]+)$/;

// «ТОУОТА» → «TOYOTA», если в слове есть латиница, которой нет среди двойников (R, D, F, G…) — значит, писали латиницей
function unLatin(s, lat) {
  if (!(lat || /[A-Z]/.test(s)) || /[БГДЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯЁ]/.test(s)) return s;
  return s.replace(new RegExp('[' + PL + ']', 'g'), function (ch) { return TW_LAT[PL.indexOf(ch)]; });
}
function cap(s, lat) { s = unLatin(s, lat); return s.length <= 3 || /\d/.test(s) ? s : s[0] + s.slice(1).toLowerCase(); }

// марка или модель в начале значения: «ТОЙОТАКАМРИ» → «Toyota Камри». Короткие (КИА, СИД, ЖУК) — только целым словом,
// с цифрами (ВАЗ2107) или с моделью после них, чтобы «СИДОРОВ» не стал машиной
function brand(v) {
  for (const b of BRANDS) {
    for (const f of b[1]) {
      if (!f || v.indexOf(f) !== 0) continue;
      const rest = v.slice(f.length), lat = /[A-Z]/.test(v), more = rest && !/^\d/.test(rest) ? brand(rest) : '';
      if (f.length <= 4 && rest && !/\d/.test(rest) && !more) continue;
      // писали латиницей — и модель оставляем латиницей (Camry, а не Камри)
      const nm = lat && /[А-ЯЁ]/.test(b[0]) && b[1].some(function (x) { return /[A-Z]/.test(x); }) ? cap(f, true) : b[0];
      return nm + (more ? ' ' + (lat && /[A-Z]/.test(rest) ? cap(rest, true) : more) : rest ? ' ' + cap(rest, lat) : '');
    }
  }
  return '';
}

// Что за значение в поле «Госномер». kind: ok — номер; odd — похоже на номер, но не по форме (не трогаем без владельца);
// bad — не номер. to — куда перенести: car, name, phone, note (в комментарий) или clear (просто убрать, напр. «НЕТ»)
function classify(v) {
  v = String(v || '');
  if (!v) return { kind: 'ok' };
  if (FORMATS.some(function (re) { return re.test(v); })) return { kind: 'ok' };
  const digits = (v.match(/\d/g) || []).length;
  // телефон: 10–11 цифр, начинается на 9, 79, 89 (+7…)
  const ph = v.replace(/^\+/, '');
  if (/^\d+$/.test(ph) && (/^[78]9\d{9}$/.test(ph) || /^9\d{9}$/.test(ph))) {
    const d = ph.length === 10 ? '7' + ph : '7' + ph.slice(1);
    return { kind: 'bad', to: 'phone', text: '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9) };
  }
  if (JUNK.test(v)) return { kind: 'bad', to: 'clear', text: v };
  // только буквы-двойники и цифры — похоже на номер, просто неполный или с ошибкой (А123ВС, 777)
  if (new RegExp('^[' + PL + '\\d]+$').test(v) && digits) return { kind: 'odd', to: 'keep', text: v };
  // марка или модель — в начале значения
  const car = brand(v);
  if (car) return { kind: 'bad', to: 'car', text: car };
  // имя (может быть с фамилией: ИВАНПЕТРОВ) или фамилия (ИВАНОВ, ИВАНЕНКО)
  if (!digits && !/[A-Z]/.test(v)) {
    const n = NAMES.filter(function (x) { return v.indexOf(x) === 0; }).sort(function (a, b) { return b.length - a.length; })[0];
    if (n === v) return { kind: 'bad', to: 'name', text: cap(v) };
    if (n && v.length - n.length >= 5) return { kind: 'bad', to: 'name', text: cap(n) + ' ' + cap(v.slice(n.length)) };
    if ((v.length >= 5 && SURNAME.test(v)) || (n && n.length >= 4)) return { kind: 'bad', to: 'name', text: cap(v) };
  }
  // остальное: слово без цифр или с ними — скорее машина (так чаще пишут в поле номера)
  return { kind: 'bad', to: 'car', text: cap(v) };
}

// Куда в каждой коллекции можно перенести: [вариант, подпись, поле, приставка, если пишем в комментарий]
const TARGETS = {
  bookings: { car: ['Марка авто', 'car'], name: ['Имя', 'name'], phone: ['Телефон', 'phone'], note: ['В комментарий', 'comment', 'Было в госномере: '] },
  jobs: { car: ['Марка машины', 'car'], name: ['Имя (в комментарий)', 'comment', 'Клиент: '], phone: ['Телефон (в комментарий)', 'comment', 'Телефон: '], note: ['В комментарий', 'comment', 'Было в госномере: '] },
  clients: { car: ['Марка', 'make'], name: ['Имя', 'name'], phone: ['Телефон', 'phone'], note: ['В заметку', 'note', 'Было в госномере: '] },
  storage: { car: ['Машина (в заметку)', 'note', 'Машина: '], name: ['Имя', 'name'], phone: ['Телефон', 'phone'], note: ['В заметку', 'note', 'Было в госномере: '] },
  paint: { car: ['Машина', 'car'], name: ['Имя', 'name'], phone: ['Телефон', 'phone'], note: ['В заметку', 'note', 'Было в госномере: '] }
};
const COMMON = { clear: ['Просто убрать'], keep: ['Оставить как есть'] };
function options(coll) {
  const t = TARGETS[coll], out = [];
  for (const k of Object.keys(t)) out.push([k, t[k][0]]);
  out.push(['clear', COMMON.clear[0]], ['keep', COMMON.keep[0]]);
  return out;
}
function norm(s) { return plate(s).replace(/[^0-9A-ZА-ЯЁ]/g, ''); }

// Новая версия записи: госномер пустой, значение — в выбранное поле. Уже записанное в поле не затираем, а дописываем через запятую.
// max — длина поля по схеме. client — карточка клиента с этим же «номером»: из неё берём пустые имя/телефон/марку
function apply(coll, doc, to, text, max, client) {
  const t = TARGETS[coll], d = Object.assign({}, doc);
  text = String(text || '').trim();
  if (to !== 'clear' && to !== 'keep' && t[to] && text) {
    const f = t[to][1], pre = t[to][2] || '', cur = String(d[f] || '').trim();
    if (!cur) d[f] = (pre + text).slice(0, max[f] || 120);
    else if (norm(cur).indexOf(norm(text)) < 0) d[f] = (cur + ', ' + pre + text).slice(0, max[f] || 120);
  }
  if (client && coll !== 'clients' && coll !== 'jobs') {
    if (!d.name && client.name) d.name = client.name;
    if (!d.phone && client.phone) d.phone = client.phone;
  }
  if (client && (coll === 'bookings' || coll === 'paint' || coll === 'jobs') && !d.car && (client.make || client.model)) d.car = [client.make, client.model].filter(Boolean).join(' ');
  d.plate = '';
  return d;
}

module.exports = { classify: classify, options: options, apply: apply, TARGETS: TARGETS, COLLS: Object.keys(TARGETS) };
