// cards.js
// База карт «Мир Данилов 2» — версия БЕЗ DLC.
// Коричневые (тестовые) карты не участвуют по правилам.
//
// ПРИМЕЧАНИЕ О ДОПУЩЕНИЯХ (в тексте правил количество копий карт в колоде
// не указано, так что оно подобрано вручную, чтобы колода была играбельного
// размера):
//   - белые / зелёные / синие карты: по 3 копии каждой
//   - фиолетовые карты: по 2 копии каждой
//   - жёлтые (боссы): по 3 копии каждой в отдельной колоде боссов

const CARDS = {
  // ───────────────── БЕЛЫЕ ─────────────────
  w_danil: {
    id: 'w_danil', name: 'Обычный Данил', color: 'white', hp: 2, atk: 1,
    text: 'Рост: в начале вашего хода +1 HP и +2 ATK (макс. +3 HP / +6 ATK суммарно).',
  },
  w_sudya: {
    id: 'w_sudya', name: 'Судья', color: 'white', hp: 2, atk: 1,
    text: 'При выходе: выдаёт вам в руку фиолетовую карту «Орест».',
  },
  w_boleyushiy: {
    id: 'w_boleyushiy', name: 'Болеющий', color: 'white', hp: 3, atk: 1,
    text: 'При выходе: наложите вирус на 1 вражескую карту.',
  },
  w_medic: {
    id: 'w_medic', name: 'Медик', color: 'white', hp: 3, atk: 0, evasive: true,
    text: 'В конце вашего хода лечит все ваши карты на 1 HP. Неуловимость.',
  },
  w_stroitel: {
    id: 'w_stroitel', name: 'Строитель', color: 'white', hp: 5, atk: 1,
    text: 'При выходе: дайте одной вашей карте Стену (50%), пока Строитель жив.',
  },
  w_ribak: {
    id: 'w_ribak', name: 'Рыбак', color: 'white', hp: 1, atk: 3,
    text: 'Пока жив: все ваши зелёные карты имеют +1 HP и блокируют одну (первую) атаку по себе.',
  },
  w_sniper: {
    id: 'w_sniper', name: 'Снайпер', color: 'white', hp: 2, atk: 2, sniper: true,
    text: 'Меткий: игнорирует все приоритеты и неуловимость. Может бить любую цель, кроме неуязвимых.',
  },

  // ───────────────── ЗЕЛЁНЫЕ ─────────────────
  g_assassin: {
    id: 'g_assassin', name: 'Ассасин', color: 'green', hp: 2, atk: 3,
    text: 'При выходе: наложите яд (2/2) на 1 вражескую карту и на вражеского игрока.',
  },
  g_policeman: {
    id: 'g_policeman', name: 'Полицейский', color: 'green', hp: 2, atk: 4,
    text: 'При выходе: верните 1 вражескую карту со стола в руку владельца.',
  },
  g_antimiting: {
    id: 'g_antimiting', name: 'Антимитинг', color: 'green', hp: 2, atk: 4,
    text: 'При выходе: если у врага >3 карт на столе, верните 2 из них в руку.',
  },
  g_homyak: {
    id: 'g_homyak', name: 'Хомяк', color: 'green', hp: 4, atk: 3,
    text: 'При выходе: оглушите 2 вражеские карты.',
  },
  g_flagonosec: {
    id: 'g_flagonosec', name: 'Флагоносец', color: 'green', hp: 2, atk: 3,
    text: 'При выходе: следующая выложенная вами карта получает +2 ATK.',
  },
  g_vampire: {
    id: 'g_vampire', name: 'Вампир', color: 'green', hp: 3, atk: 4,
    text: 'После атаки лечит себя на 1 HP.',
  },
  g_rikoshet: {
    id: 'g_rikoshet', name: 'Рикошетер', color: 'green', hp: 2, atk: 2,
    text: 'При атаке: наносит 2 урона не только цели, но и соседней вражеской карте (если есть).',
  },

  // ───────────────── СИНИЕ ─────────────────
  b_tank: {
    id: 'b_tank', name: 'Танк', color: 'blue', hp: 15, atk: 2,
    text: 'При выходе: следующая выложенная вами карта получает +3 HP.',
  },
  b_soldier: {
    id: 'b_soldier', name: 'Солдат Данил', color: 'blue', hp: 4, atk: 5,
    text: 'Если выжил 1 ход после выхода — +2 HP (единоразово).',
  },
  b_plague: {
    id: 'b_plague', name: 'Чумной доктор', color: 'blue', hp: 3, atk: 2,
    text: 'При выходе и при смерти: снимите все негативные эффекты со всех ваших карт.',
  },
  b_danilolog: {
    id: 'b_danilolog', name: 'Данилоолог', color: 'blue', hp: 5, atk: 2,
    text: 'При выходе: посмотрите 2 случайные карты в руке врага. Если там есть белая карта — +2 ATK.',
  },
  b_stick: {
    id: 'b_stick', name: 'Данил с длинной палкой', color: 'blue', hp: 4, atk: 2,
    text: 'Отражает 50% полученного урона обратно атакующему (округление вниз).',
  },
  b_maso: {
    id: 'b_maso', name: 'Мазохист', color: 'blue', hp: 7, atk: 1,
    text: 'ATK = количеству потерянных HP (макс. 4). При лечении бонус снижается.',
  },
  b_ucheniy: {
    id: 'b_ucheniy', name: 'Учёный', color: 'blue', hp: 3, atk: 1,
    text: 'Вместо атаки: заморозьте 1 вражескую карту на 1 ход.',
  },

  // ───────────────── ЖЁЛТЫЕ (боссы) ─────────────────
  y_king: {
    id: 'y_king', name: 'Король Данилов', color: 'yellow', hp: 7, atk: 3, priority: 2,
    text: 'При выходе призывает Дана (1/0, Приоритет 3). Каждый ваш ход призывает ещё 1 (макс. 3 Данов).',
  },
  y_titan: {
    id: 'y_titan', name: 'Титан', color: 'yellow', hp: 28, atk: 1, priority: 1,
    text: 'Приоритет 1: обязаны атаковать его первым (после Данов и боссов). В свой ход лечится на 1 HP.',
  },
  y_ratatouy: {
    id: 'y_ratatouy', name: 'Рататуй', color: 'yellow', hp: 15, atk: 9, priority: 2,
    text: 'Первые 2 атаки ATK 9, затем ATK 7. Пока жив — все ваши остальные карты получают +1 ATK.',
  },
  y_infected: {
    id: 'y_infected', name: 'Инфицированный', color: 'yellow', hp: 3, atk: 3, priority: 2,
    text: 'При выходе: вирус на все вражеские карты. После смерти призывает Обычного Данила 3 ур. (4/3).',
  },

  // ───────────────── ТОКЕНЫ (не в колоде, только по эффектам) ─────────────────
  tok_dan: {
    id: 'tok_dan', name: 'Дан', color: 'yellow', hp: 3, atk: 0, priority: 2, token: true,
    text: 'Призванный прислужник Короля Данилов.',
  },
  tok_danil3: {
    id: 'tok_danil3', name: 'Обычный Данил (3 ур.)', color: 'yellow', hp: 4, atk: 3, token: true,
    text: 'Появляется после смерти Инфицированного.',
  },

  // ───────────────── ФИОЛЕТОВЫЕ (расходники) ─────────────────
  p_yad: { id: 'p_yad', name: 'Яд', color: 'purple', text: 'Наложите яд (2/2) на 2 вражеские карты.' },
  p_kolotushka: { id: 'p_kolotushka', name: 'Колотушка', color: 'purple', text: 'Уничтожьте 1 белую/зелёную вражескую карту. Остальные карты этого врага оглушаются.' },
  p_perchatka: { id: 'p_perchatka', name: 'Перчатка', color: 'purple', text: 'Заберите 1 не-жёлтую и не-белую вражескую карту себе на стол.' },
  p_joker: { id: 'p_joker', name: 'Джокер', color: 'purple', text: 'Возьмите случайную карту из руки врага (кроме жёлтых).' },
  p_zerkalo: { id: 'p_zerkalo', name: 'Зеркало', color: 'purple', text: 'Если в этом ходу ваша белая/синяя карта погибла — верните её с 75% от макс. HP.' },
  p_ukol: { id: 'p_ukol', name: 'Укол', color: 'purple', text: 'Наложите вирус на 1 вражескую карту.' },
  p_angel: { id: 'p_angel', name: 'Ангел-хранитель', color: 'purple', text: 'Выберите свою карту. Если она умрёт — вернётся с ATK / 2 (округление вниз).' },
  p_ukus: { id: 'p_ukus', name: 'Укус', color: 'purple', text: 'Нанесите 4 урона любой вражеской карте (кроме жёлтой).' },
  p_orest: { id: 'p_orest', name: 'Орест', color: 'purple', noDeck: true, text: 'Выберите карту (белую/зелёную/синюю) из вашего сброса — на 1 ход на стол выходит её копия, затем исчезает.' },
  p_shutka: { id: 'p_shutka', name: 'Шутка!', color: 'purple', text: 'Сделайте одного игрока (можно себя) неуязвимым и оглушённым на 1 ход (он пропускает следующий ход).' },
};

const DECK_COUNTS = {
  white: 3, green: 3, blue: 3, purple: 2,
};

const BOSS_COPIES = 3;

function buildMainDeckDefIds() {
  const ids = [];
  for (const c of Object.values(CARDS)) {
    if (c.token) continue;
    if (c.color === 'yellow') continue;
    if (c.noDeck) continue;
    const copies = DECK_COUNTS[c.color] || 1;
    for (let i = 0; i < copies; i++) ids.push(c.id);
  }
  return ids;
}

function buildBossDeckDefIds() {
  const ids = [];
  for (const c of Object.values(CARDS)) {
    if (c.color === 'yellow' && !c.token) {
      for (let i = 0; i < BOSS_COPIES; i++) ids.push(c.id);
    }
  }
  return ids;
}

module.exports = { CARDS, buildMainDeckDefIds, buildBossDeckDefIds };
