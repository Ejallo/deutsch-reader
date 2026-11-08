import type { ChunkExample } from './store';

// Grammar topics. Everything here is the hand-checked reference: Gemini writes lessons and examples,
// and the critic must agree with these rules before anything reaches the learner.

export interface GrammarItem {
  key: string;
  label: string;
  ru: string;
  rule: string;
  /** Word forms that bring this item up in the reader. */
  triggers?: string[];
  /** Same-class wrong fillers for a sentence saved from a text, where the gap is the tapped trigger. */
  wrong?: string[];
  example: ChunkExample;
}

export interface GrammarTopic {
  id: string;
  title: string;
  level: 'A2' | 'B1';
  emoji: string;
  summary: string;
  rules: string[];
  head: [string, string];
  table: [string, string][];
  items: GrammarItem[];
}

const ex = (de: string, ru: string, gap: string, wrong: string[]): ChunkExample => ({ de, ru, gap, wrong });

export const TOPICS: GrammarTopic[] = [
  {
    id: 'connectors',
    title: 'Коннекторы',
    level: 'A2',
    emoji: '🔗',
    summary: 'weil, dass, obwohl, deshalb, denn',
    rules: [
      'After the subordinating conjunctions weil, dass, obwohl, wenn the conjugated verb goes to the very end of the clause.',
      'After the adverbs deshalb, trotzdem (position 1) the conjugated verb follows immediately, then the subject.',
      'After denn, aber, und, oder (position 0) the normal word order stays: subject, then verb.',
    ],
    head: ['Союзы', 'Куда идёт глагол'],
    table: [
      ['weil, dass, obwohl, wenn', 'в самый конец'],
      ['deshalb, trotzdem', 'сразу после союза'],
      ['denn, aber, und, oder', 'порядок не меняется'],
    ],
    items: [
      { key: 'weil', label: 'weil', ru: 'потому что', rule: 'После weil глагол уходит в самый конец.', triggers: ['weil'], wrong: ['deshalb', 'denn', 'trotzdem'], example: ex('Ich bleibe zu Hause, weil ich krank bin.', 'Я остаюсь дома, потому что я болен.', 'weil', ['deshalb', 'denn', 'trotzdem']) },
      { key: 'dass', label: 'dass', ru: 'что', rule: 'После dass глагол уходит в самый конец.', triggers: ['dass'], wrong: ['wenn', 'denn', 'deshalb'], example: ex('Ich glaube, dass er heute kommt.', 'Я думаю, что он сегодня придёт.', 'dass', ['wenn', 'denn', 'deshalb']) },
      { key: 'obwohl', label: 'obwohl', ru: 'хотя', rule: 'После obwohl глагол уходит в самый конец.', triggers: ['obwohl'], wrong: ['deshalb', 'denn', 'dass'], example: ex('Sie geht spazieren, obwohl es regnet.', 'Она идёт гулять, хотя идёт дождь.', 'obwohl', ['deshalb', 'denn', 'dass']) },
      { key: 'wenn', label: 'wenn', ru: 'если, когда', rule: 'После wenn глагол уходит в самый конец.', triggers: ['wenn'], wrong: ['dass', 'denn', 'deshalb'], example: ex('Ruf mich an, wenn du Zeit hast.', 'Позвони мне, если у тебя будет время.', 'wenn', ['dass', 'denn', 'deshalb']) },
      { key: 'deshalb', label: 'deshalb', ru: 'поэтому', rule: 'После deshalb сразу идёт глагол, потом подлежащее.', triggers: ['deshalb'], wrong: ['weil', 'denn', 'obwohl'], example: ex('Ich bin müde, deshalb gehe ich ins Bett.', 'Я устал, поэтому иду спать.', 'deshalb', ['weil', 'denn', 'obwohl']) },
      { key: 'trotzdem', label: 'trotzdem', ru: 'всё равно, тем не менее', rule: 'После trotzdem сразу идёт глагол, потом подлежащее.', triggers: ['trotzdem'], wrong: ['obwohl', 'weil', 'denn'], example: ex('Es regnet, trotzdem gehen wir raus.', 'Идёт дождь, но мы всё равно выходим.', 'trotzdem', ['obwohl', 'weil', 'denn']) },
      { key: 'denn', label: 'denn', ru: 'так как, ведь', rule: 'После denn порядок слов обычный: подлежащее, потом глагол.', triggers: ['denn'], wrong: ['weil', 'deshalb', 'obwohl'], example: ex('Ich esse nichts, denn ich habe keinen Hunger.', 'Я ничего не ем, ведь я не голоден.', 'denn', ['weil', 'deshalb', 'obwohl']) },
      { key: 'aber', label: 'aber', ru: 'но', rule: 'После aber порядок слов обычный: подлежащее, потом глагол.', triggers: ['aber'], wrong: ['obwohl', 'weil', 'deshalb'], example: ex('Das Auto ist alt, aber es fährt gut.', 'Машина старая, но ездит хорошо.', 'aber', ['obwohl', 'weil', 'deshalb']) },
    ],
  },
  {
    id: 'perfekt',
    title: 'Perfekt',
    level: 'A2',
    emoji: '⏱️',
    summary: 'haben / sein + Partizip II',
    rules: [
      'Perfekt = conjugated haben or sein in position 2 + Partizip II at the end of the clause.',
      'sein is used with verbs of motion and change of state and with sein, bleiben, werden; most other verbs take haben.',
      'Separable verbs put ge between prefix and stem (aufgestanden). Verbs in -ieren and verbs with the prefixes be-, ver-, er-, ent-, zer-, ge-, emp-, miss- have no ge- (studiert, verkauft).',
    ],
    head: ['Что', 'Как'],
    table: [
      ['большинство глаголов', 'haben + Partizip II'],
      ['движение, смена состояния', 'sein + Partizip II'],
      ['отделяемая приставка', 'auf·ge·standen'],
      ['-ieren, be-, ver-, er-', 'без ge-: studiert'],
    ],
    items: [
      { key: 'haben', label: 'haben + Partizip II', ru: 'большинство глаголов', rule: 'Большинство глаголов образуют Perfekt с haben, причастие стоит в конце.', example: ex('Ich habe gestern Pizza gegessen.', 'Вчера я ел пиццу.', 'habe', ['bin', 'hat', 'haben']) },
      { key: 'sein', label: 'sein + Partizip II', ru: 'движение и смена состояния', rule: 'Глаголы движения и смены состояния образуют Perfekt с sein.', example: ex('Wir sind nach Berlin gefahren.', 'Мы поехали в Берлин.', 'sind', ['haben', 'seid', 'hat']) },
      { key: 'separable', label: 'auf·ge·standen', ru: 'отделяемые приставки', rule: 'У отделяемых глаголов ge стоит между приставкой и основой.', example: ex('Ich bin um sieben aufgestanden.', 'Я встал в семь.', 'aufgestanden', ['geaufstanden', 'aufgestehen', 'aufstanden']) },
      { key: 'no-ge', label: 'Partizip без ge-', ru: '-ieren, be-, ver-, er-', rule: 'У глаголов на -ieren и с приставками be-, ver-, er- нет ge-.', example: ex('Sie hat in Wien studiert.', 'Она училась в Вене.', 'studiert', ['gestudiert', 'studieren', 'gestudieren']) },
    ],
  },
  {
    id: 'prepositions',
    title: 'Предлоги и падежи',
    level: 'A2',
    emoji: '📍',
    summary: 'Dativ, Akkusativ, wo? / wohin?',
    rules: [
      'mit, nach, bei, seit, von, zu, aus always take the dative.',
      'für, ohne, gegen, durch, um always take the accusative.',
      'in, an, auf, über, unter, vor, hinter, neben, zwischen take the dative for location (wo?) and the accusative for direction (wohin?).',
    ],
    head: ['Предлоги', 'Падеж'],
    table: [
      ['mit, nach, bei, seit, von, zu, aus', 'Dativ'],
      ['für, ohne, gegen, durch, um', 'Akkusativ'],
      ['in, an, auf… где?', 'Dativ'],
      ['in, an, auf… куда?', 'Akkusativ'],
    ],
    items: [
      { key: 'dativ', label: 'mit, nach, bei, von, aus', ru: 'всегда Dativ', rule: 'После mit, nach, bei, seit, von, zu, aus всегда Dativ.', triggers: ['mit', 'nach', 'bei', 'seit', 'von', 'aus'], wrong: ['für', 'ohne', 'gegen'], example: ex('Ich fahre mit dem Bus.', 'Я еду на автобусе.', 'dem', ['den', 'der', 'das']) },
      { key: 'akkusativ', label: 'für, ohne, gegen, durch', ru: 'всегда Akkusativ', rule: 'После für, ohne, gegen, durch, um всегда Akkusativ.', triggers: ['für', 'ohne', 'gegen', 'durch'], wrong: ['mit', 'von', 'bei'], example: ex('Das Geschenk ist für meinen Bruder.', 'Подарок для моего брата.', 'meinen', ['meinem', 'mein', 'meiner']) },
      { key: 'two-way', label: 'in, an, auf: где / куда', ru: 'wo? Dativ, wohin? Akkusativ', rule: 'Где? — Dativ. Куда? — Akkusativ.', example: ex('Das Buch liegt auf dem Tisch.', 'Книга лежит на столе.', 'dem', ['den', 'die', 'das']) },
    ],
  },
  {
    id: 'separable',
    title: 'Отделяемые глаголы',
    level: 'A2',
    emoji: '✂️',
    summary: 'aufstehen, anrufen, einkaufen',
    rules: [
      'In a main clause in the present or Präteritum the separable prefix goes to the end of the clause.',
      'In a subordinate clause the verb stays whole at the end (dass er früh aufsteht).',
      'With a modal verb the infinitive stays whole at the end. With zu, the zu goes between prefix and stem (aufzustehen).',
    ],
    head: ['Где', 'Форма'],
    table: [
      ['главное предложение', 'Ich stehe früh auf.'],
      ['придаточное', '…dass ich früh aufstehe.'],
      ['с модальным глаголом', 'Ich muss früh aufstehen.'],
      ['с zu', 'Ich versuche, aufzustehen.'],
    ],
    items: [
      { key: 'main', label: 'приставка в конец', ru: 'главное предложение', rule: 'В главном предложении приставка уходит в конец.', example: ex('Ich stehe um sieben auf.', 'Я встаю в семь.', 'auf', ['an', 'aus', 'ab']) },
      { key: 'sub', label: 'в придаточном слитно', ru: 'придаточное', rule: 'В придаточном глагол стоит в конце и пишется слитно.', example: ex('Ich weiß, dass er früh aufsteht.', 'Я знаю, что он рано встаёт.', 'aufsteht', ['steht auf', 'auf steht', 'aufstehen']) },
      { key: 'modal', label: 'с модальным глаголом', ru: 'инфинитив слитно', rule: 'С модальным глаголом инфинитив стоит в конце и пишется слитно.', example: ex('Ich muss früh aufstehen.', 'Мне нужно рано вставать.', 'aufstehen', ['aufsteht', 'stehe auf', 'aufgestanden']) },
      { key: 'zu', label: 'zu внутри глагола', ru: 'инфинитив с zu', rule: 'zu стоит между приставкой и основой.', example: ex('Ich versuche, früh aufzustehen.', 'Я стараюсь рано вставать.', 'aufzustehen', ['zu aufstehen', 'aufstehen', 'auf zu stehen']) },
    ],
  },
  {
    id: 'word-order',
    title: 'Порядок слов',
    level: 'B1',
    emoji: '🧭',
    summary: 'глагол второй, рамка, TeKaMoLo',
    rules: [
      'In a statement the conjugated verb is always the second element; if something else comes first, the subject moves right after the verb.',
      'In a yes/no question the conjugated verb comes first.',
      'In a sentence with two verb parts the second part (participle, infinitive, prefix) goes to the end: the sentence bracket.',
      'The usual order of adverbials is time, reason, manner, place (TeKaMoLo).',
    ],
    head: ['Правило', 'Пример'],
    table: [
      ['глагол на 2 месте', 'Am Montag gehe ich…'],
      ['вопрос да/нет', 'Kommst du mit?'],
      ['рамка', 'Ich habe… gearbeitet.'],
      ['когда → как → куда', 'morgen mit dem Zug nach Berlin'],
    ],
    items: [
      { key: 'v2', label: 'глагол на втором месте', ru: 'утверждение', rule: 'Глагол всегда второй. Если первым стоит не подлежащее, оно идёт сразу после глагола.', example: ex('Am Montag gehe ich ins Kino.', 'В понедельник я иду в кино.', 'gehe', ['gehen', 'geht', 'gehst']) },
      { key: 'question', label: 'глагол первый', ru: 'вопрос да/нет', rule: 'В вопросе без вопросительного слова глагол стоит первым.', example: ex('Kommst du heute mit?', 'Ты пойдёшь сегодня с нами?', 'Kommst', ['Kommt', 'Kommen', 'Komme']) },
      { key: 'bracket', label: 'рамка', ru: 'вторая часть в конце', rule: 'Вторая часть глагола уходит в конец предложения.', example: ex('Ich habe heute viel gearbeitet.', 'Я сегодня много работал.', 'gearbeitet', ['arbeiten', 'arbeitet', 'arbeite']) },
      { key: 'tekamolo', label: 'когда → как → куда', ru: 'TeKaMoLo', rule: 'Обычный порядок: время, причина, способ, место.', example: ex('Ich fahre morgen mit dem Zug nach Berlin.', 'Завтра я еду на поезде в Берлин.', 'nach', ['zu', 'in', 'bei']) },
    ],
  },
  {
    id: 'adjectives',
    title: 'Окончания прилагательных',
    level: 'B1',
    emoji: '🎨',
    summary: 'der kleine, ein kleiner, kleiner',
    rules: [
      'After der/die/das-words the ending is -e in nominative singular and in accusative feminine and neuter; otherwise -en.',
      'After ein-words the adjective shows the gender where the article does not: -er (masculine nominative), -es (neuter nominative and accusative), -e (feminine nominative and accusative); otherwise -en.',
      'Without an article the adjective takes the endings of the der-words, except masculine and neuter genitive -en.',
      'After any article in the dative the ending is always -en.',
    ],
    head: ['Перед прилагательным', 'Окончание'],
    table: [
      ['der, die, das', '-e или -en'],
      ['ein, kein, mein', 'показывает род: -er, -es, -e'],
      ['нет артикля', 'как у der-слов'],
      ['артикль в Dativ', 'всегда -en'],
    ],
    items: [
      { key: 'definite', label: 'после der, die, das', ru: 'определённый артикль', rule: 'После определённого артикля окончание -e или -en.', example: ex('Der kleine Hund schläft.', 'Маленькая собака спит.', 'kleine', ['kleiner', 'kleinen', 'kleines']) },
      { key: 'indefinite', label: 'после ein, kein, mein', ru: 'окончание показывает род', rule: 'После ein окончание прилагательного показывает род.', example: ex('Das ist ein neues Auto.', 'Это новая машина.', 'neues', ['neue', 'neuen', 'neuer']) },
      { key: 'none', label: 'без артикля', ru: 'как окончания der-слов', rule: 'Без артикля прилагательное берёт окончание der-слов.', example: ex('Ich trinke gern kalten Kaffee.', 'Я люблю холодный кофе.', 'kalten', ['kalter', 'kaltes', 'kalte']) },
      { key: 'dative', label: 'артикль в Dativ', ru: 'всегда -en', rule: 'После артикля в дательном падеже всегда -en.', example: ex('Er wohnt in einem kleinen Dorf.', 'Он живёт в маленькой деревне.', 'kleinen', ['kleines', 'kleine', 'kleiner']) },
    ],
  },
  {
    id: 'konjunktiv',
    title: 'Konjunktiv II',
    level: 'B1',
    emoji: '💭',
    summary: 'würde, hätte, wäre, könnte',
    rules: [
      'Most verbs form Konjunktiv II as würde + infinitive at the end.',
      'haben, sein and the modal verbs use their own forms: hätte, wäre, könnte, müsste, dürfte.',
      'It expresses unreal conditions, wishes and polite requests.',
    ],
    head: ['Глагол', 'Форма'],
    table: [
      ['большинство глаголов', 'würde + инфинитив'],
      ['haben', 'hätte'],
      ['sein', 'wäre'],
      ['können', 'könnte'],
    ],
    items: [
      { key: 'wuerde', label: 'würde + инфинитив', ru: 'бы + глагол', rule: 'Большинство глаголов: würde + инфинитив в конце.', triggers: ['würde', 'würdest', 'würden', 'würdet'], wrong: ['werde', 'wurde', 'wird'], example: ex('Ich würde gern nach Italien fahren.', 'Я бы с удовольствием съездил в Италию.', 'würde', ['werde', 'wurde', 'wird']) },
      { key: 'haette', label: 'hätte', ru: 'имел бы', rule: 'У haben своя форма: hätte.', triggers: ['hätte', 'hättest', 'hätten', 'hättet'], wrong: ['habe', 'hatte', 'hat'], example: ex('Wenn ich mehr Zeit hätte, würde ich Sport machen.', 'Если бы у меня было больше времени, я бы занимался спортом.', 'hätte', ['habe', 'hatte', 'hat']) },
      { key: 'waere', label: 'wäre', ru: 'был бы', rule: 'У sein своя форма: wäre.', triggers: ['wäre', 'wärst', 'wären', 'wärt'], wrong: ['ist', 'war', 'wird'], example: ex('Es wäre schön, dich zu sehen.', 'Было бы здорово тебя увидеть.', 'wäre', ['ist', 'war', 'wird']) },
      { key: 'koennte', label: 'könnte', ru: 'мог бы', rule: 'У модальных глаголов своя форма: könnte, müsste, dürfte.', triggers: ['könnte', 'könntest', 'könnten', 'könntet'], wrong: ['kann', 'konnte', 'kannst'], example: ex('Könnten Sie mir bitte helfen?', 'Не могли бы вы мне помочь?', 'Könnten', ['Können', 'Konnten', 'Kann']) },
    ],
  },
  {
    id: 'relative',
    title: 'Относительные придаточные',
    level: 'B1',
    emoji: '🪢',
    summary: 'der Mann, der / den / dem',
    rules: [
      'A relative clause starts with a relative pronoun and its conjugated verb goes to the end.',
      'The pronoun takes gender and number from the noun it refers to, and its case from its role inside the relative clause.',
      'A preposition stands before the relative pronoun and sets its case.',
    ],
    head: ['Роль в придаточном', 'Мужской / женский / средний'],
    table: [
      ['Nominativ', 'der / die / das'],
      ['Akkusativ', 'den / die / das'],
      ['Dativ', 'dem / der / dem'],
    ],
    items: [
      { key: 'nominative', label: 'Nominativ', ru: 'кто? что?', rule: 'Местоимение — подлежащее придаточного. Глагол в конце.', example: ex('Der Mann, der dort steht, ist mein Vater.', 'Мужчина, который там стоит, мой отец.', 'der', ['den', 'dem', 'das']) },
      { key: 'accusative', label: 'Akkusativ', ru: 'кого? что?', rule: 'Местоимение — прямое дополнение придаточного.', example: ex('Das ist der Film, den ich gestern gesehen habe.', 'Это фильм, который я вчера посмотрел.', 'den', ['der', 'dem', 'das']) },
      { key: 'dative', label: 'Dativ', ru: 'кому? чему?', rule: 'Падеж определяет глагол придаточного.', example: ex('Die Frau, der ich geholfen habe, ist Ärztin.', 'Женщина, которой я помог, врач.', 'der', ['die', 'den', 'dem']) },
      { key: 'preposition', label: 'с предлогом', ru: 'предлог задаёт падеж', rule: 'Предлог стоит перед местоимением и задаёт падеж.', example: ex('Das ist die Stadt, in der ich wohne.', 'Это город, в котором я живу.', 'der', ['die', 'den', 'dem']) },
    ],
  },
  {
    id: 'passive',
    title: 'Passiv',
    level: 'B1',
    emoji: '⚙️',
    summary: 'wird gebaut, wurde gebaut',
    rules: [
      'Present passive = conjugated werden + Partizip II at the end.',
      'Präteritum passive = wurde + Partizip II.',
      'Perfekt passive = sein + Partizip II + worden (not geworden).',
      'Passive with a modal verb = modal verb + Partizip II + werden at the end.',
    ],
    head: ['Время', 'Форма'],
    table: [
      ['Präsens', 'wird gebaut'],
      ['Präteritum', 'wurde gebaut'],
      ['Perfekt', 'ist gebaut worden'],
      ['с модальным', 'muss gebaut werden'],
    ],
    items: [
      { key: 'present', label: 'wird + Partizip II', ru: 'настоящее', rule: 'Настоящее время: werden + Partizip II.', example: ex('Das Haus wird gerade gebaut.', 'Дом сейчас строится.', 'wird', ['ist', 'hat', 'werden']) },
      { key: 'past', label: 'wurde + Partizip II', ru: 'прошедшее', rule: 'Прошедшее время: wurde + Partizip II.', example: ex('Das Buch wurde 1900 geschrieben.', 'Книга была написана в 1900 году.', 'wurde', ['wird', 'war', 'hat']) },
      { key: 'perfect', label: 'ist … worden', ru: 'Perfekt', rule: 'В Perfekt пассива worden, а не geworden.', example: ex('Der Brief ist gestern geschickt worden.', 'Письмо было отправлено вчера.', 'worden', ['geworden', 'wurde', 'werden']) },
      { key: 'modal', label: 'muss … werden', ru: 'с модальным глаголом', rule: 'Модальный глагол + Partizip II + werden в конце.', example: ex('Das Problem muss gelöst werden.', 'Проблема должна быть решена.', 'werden', ['worden', 'wird', 'wurde']) },
    ],
  },
];

const byId = new Map(TOPICS.map((t) => [t.id, t]));
export const topicById = (id: string | undefined) => (id ? byId.get(id) : undefined);

/** A topic id from a model's answer, or '' for anything that isn't one of ours. */
export const normalizeTopic = (id: string | undefined) => (byId.has((id ?? '').trim()) ? (id as string).trim() : '');

/** Topic ids with what they cover, for prompts that tag a mistake with its topic. */
export const topicTags = () => TOPICS.map((t) => `${t.id} (${t.summary})`).join('; ');

/** The hand-checked rules of a topic, for prompts. */
export const topicReference = (t: GrammarTopic) =>
  `${t.rules.map((r) => `- ${r}`).join('\n')}\nItems:\n${t.items.map((i) => `- ${i.key}: ${i.label} (${i.ru})`).join('\n')}`;

export interface GrammarHint {
  topic: GrammarTopic;
  item: GrammarItem;
}

const triggers = new Map<string, GrammarHint>();
for (const topic of TOPICS) for (const item of topic.items) for (const t of item.triggers ?? []) triggers.set(t, { topic, item });

/** The grammar point a tapped word belongs to, if it is a form we can explain. */
export const grammarHintFor = (word: string) => triggers.get(word.trim().toLowerCase()) ?? null;

const LETTER = /[\p{L}\p{N}]/u;

/** True when the first occurrence of gap in de is a whole word: that occurrence is the one hidden on the card. */
export function gapIsWholeWord(de: string, gap: string): boolean {
  const i = de.indexOf(gap);
  if (i < 0 || !gap) return false;
  const before = de[i - 1] ?? '';
  const after = de[i + gap.length] ?? '';
  return !LETTER.test(before) && !LETTER.test(after);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[„“"«»(]+|[.,!?;:„“"«»)]+$/g, ''))
    .filter(Boolean)
    .sort()
    .join(' ');

/** Drops a model's example unless the card built from it would work; returns it trimmed. */
export function cleanExample(e: Partial<ChunkExample> | undefined): ChunkExample | null {
  const de = e?.de?.trim();
  const ru = e?.ru?.trim();
  const gap = e?.gap?.trim();
  if (!de || !ru || !gap || !gapIsWholeWord(de, gap)) return null;
  const wrong = [...new Set((e?.wrong ?? []).map((w) => w.trim()).filter((w) => w && w.toLowerCase() !== gap.toLowerCase()))].slice(0, 3);
  if (wrong.length < 2) return null;
  // Other valid orders must be made of exactly the sentence's tiles
  const alt = [...new Set((e?.alt ?? []).map((a) => a.trim()).filter((a) => a && words(a) === words(de) && a !== de))];
  return { de, ru, gap, wrong, ...(alt.length ? { alt } : {}) };
}

export interface GrammarCardInput {
  item: string;
  text: string;
  translation: string;
  note: string;
  examples: ChunkExample[];
}

/** Cards of a topic: the hand-checked example first, then the model's that passed validation. */
export function buildCards(t: GrammarTopic, drafted: { item: string; examples: Partial<ChunkExample>[] }[] = []): GrammarCardInput[] {
  return t.items.map((i) => {
    const seen = new Set([i.example.de]);
    const extra = (drafted.find((c) => c.item === i.key)?.examples ?? []).flatMap((e) => {
      const ok = cleanExample(e);
      if (!ok || seen.has(ok.de)) return [];
      seen.add(ok.de);
      return [ok];
    });
    return { item: i.key, text: i.label, translation: i.ru, note: i.rule, examples: [i.example, ...extra] };
  });
}

/** The wrong fillers for a saved sentence, in the same capitalization as the tapped word. */
export function fillersFor(item: GrammarItem, gap: string): string[] {
  const upper = gap[0] !== gap[0].toLowerCase();
  return (item.wrong ?? []).map((w) => (upper ? w[0].toUpperCase() + w.slice(1) : w));
}
