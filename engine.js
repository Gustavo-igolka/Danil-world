// engine.js
// Движок правил «Мир Данилов 2» (без DLC). Полностью авторитетен на сервере —
// клиент только отправляет намерения (какую карту сыграть, куда атаковать)
// и получает готовое состояние для отрисовки.
//
// Допущения там, где правила неоднозначны (см. README «Известные допущения»):
//  - Порядок применения защиты при уроне: Рыбак-блок (полный блок, разовый) →
//    Стена (50%) → вычитание из HP → отражение (Палка) считается отдельно от
//    исходного урона, не уменьшает его.
//  - «Судья» и активация способностей, которые не являются картой на столе,
//    занимают всю фазу действия (нельзя в тот же ход ещё и выложить карту).
//  - Атака "самим собой", когда стол пуст — доступна каждый ход, база 1 урона.

const { CARDS, buildMainDeckDefIds, buildBossDeckDefIds } = require('./cards');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let uidCounter = 1;
function nextUid() { return 'c' + (uidCounter++); }

function makeCardInstance(defId, ownerId) {
  const def = CARDS[defId];
  return {
    uid: nextUid(),
    defId,
    ownerId,
    hp: def.hp,
    maxHp: def.hp,
    atk: def.atk,
    statuses: {
      poison: null,      // { turnsLeft, dmg }
      virus: false,
      stun: 0,            // turns remaining, skip actions
      freeze: 0,           // turns remaining
      invuln: 0,            // turns remaining
      wall: null,             // { builderUid }
      guardianAngel: false,
      guardianAngelUsed: false,
      ribakShieldUsed: false,
    },
    growthCount: 0,          // Обычный Данил
    danCount: 0,               // Король Данилов
    attackCount: 0,              // Рататуй
    enteredRound: null,
    soldierBonusApplied: false,
    soldierEnteredRound: null,
  };
}

class Player {
  constructor(id, ws, name) {
    this.id = id;
    this.ws = ws;
    this.name = name;
    this.hp = 100;
    this.maxHp = 100;
    this.hand = [];      // card instances (hidden from others)
    this.table = [];     // card instances
    this.eliminated = false;
    this.connected = true;
    this.bossChoices = null; // pending {a,b} defIds during setup
    this.judgeUsed = false;
    this.purpleDiscard = []; // defIds of purple cards this player has played
    this.nextPlayBuff = { atk: 0, hp: 0 };
    this.playerPoison = null; // { turnsLeft, dmg }
    this.diedThisTurn = [];   // card instances (snapshot) that died on player's own most recent turn
  }
}

class Game {
  constructor(broadcastFn) {
    this.players = new Map(); // id -> Player
    this.order = [];          // turn order (ids)
    this.turnIndex = 0;
    this.round = 0;
    this.phase = 'lobby';     // lobby | boss_pick | draw | action | attack | ended
    this.deck = [];
    this.discard = [];
    this.bossDeck = [];
    this.log = [];
    this.winnerId = null;
    this.broadcast = broadcastFn; // callback(game) -> pushes state to all sockets
    this._nextPlayerId = 1;
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }

  addPlayer(ws, name) {
    const id = this._nextPlayerId++;
    const p = new Player(id, ws, name || `Игрок ${id}`);
    this.players.set(id, p);
    this.addLog(`${p.name} присоединился к игре.`);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.order = this.order.filter((x) => x !== id);
      this.addLog(`${p.name} покинул лобби.`);
    } else {
      p.connected = false;
      this.addLog(`${p.name} отключился.`);
    }
  }

  alivePlayers() {
    return [...this.players.values()].filter((p) => !p.eliminated);
  }

  currentPlayer() {
    return this.players.get(this.order[this.turnIndex]);
  }

  // ─────────────────────────── SETUP ───────────────────────────

  startGame() {
    if (this.phase !== 'lobby') return { error: 'Игра уже началась.' };
    const players = [...this.players.values()];
    if (players.length < 2) return { error: 'Нужно минимум 2 игрока.' };

    const maxHp = players.length <= 3 ? 100 : 50;
    for (const p of players) { p.hp = maxHp; p.maxHp = maxHp; }

    this.deck = shuffle(buildMainDeckDefIds()).map((defId) => ({ defId }));
    this.bossDeck = shuffle(buildBossDeckDefIds());
    this.discard = [];

    // начальная рука: по 3 карты
    for (const p of players) {
      for (let i = 0; i < 3; i++) this.drawCardInto(p);
    }

    this.order = shuffle(players.map((p) => p.id));
    this.turnIndex = 0;
    this.round = 0;
    this.phase = 'boss_pick';

    // раздать выбор боссов
    for (const p of players) this.offerBossChoice(p);

    this.addLog('Игра началась! Выбирайте боссов.');
    return { ok: true };
  }

  offerBossChoice(player) {
    if (this.bossDeck.length < 2) shuffle(this.bossDeck.push(...[])); // no-op guard
    const a = this.bossDeck.pop();
    const b = this.bossDeck.pop();
    player.bossChoices = { a, b };
  }

  pickBoss(player, choice) {
    if (this.phase !== 'boss_pick') return { error: 'Сейчас не идёт выбор боссов.' };
    if (!player.bossChoices) return { error: 'Нет карт для выбора.' };
    const picked = choice === 'a' ? player.bossChoices.a : player.bossChoices.b;
    const returned = choice === 'a' ? player.bossChoices.b : player.bossChoices.a;
    if (!picked) return { error: 'Некорректный выбор.' };
    this.bossDeck.push(returned);
    shuffle(this.bossDeck);
    const card = makeCardInstance(picked, player.id);
    player.hand.push(card);
    player.bossChoices = null;
    this.addLog(`${player.name} выбрал(а) босса: ${CARDS[picked].name}.`);

    const allDone = [...this.players.values()].every((p) => !p.bossChoices);
    if (allDone) {
      this.phase = 'draw';
      this.addLog('Все боссы выбраны. Начинаем!');
      this.beginTurn();
    }
    return { ok: true };
  }

  // ─────────────────────────── DECK / DRAW ───────────────────────────

  drawCardInto(player) {
    if (this.deck.length === 0) {
      if (this.discard.length === 0) return null; // нечего мешать
      this.deck = shuffle(this.discard.splice(0).map((defId) => ({ defId })));
      this.addLog('Колода опустела — сброс перемешан в новую колоду.');
    }
    const { defId } = this.deck.pop();
    const card = makeCardInstance(defId, player.id);
    player.hand.push(card);
    return card;
  }

  // ─────────────────────────── TURN FLOW ───────────────────────────

  beginTurn() {
    if (this.phase === 'ended') return;
    if (this.alivePlayers().length <= 1) {
      this.phase = 'ended';
      const alive = this.alivePlayers();
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      return;
    }
    let guard = 0;
    while (this.currentPlayer() && this.currentPlayer().eliminated) {
      this.advanceTurnIndex();
      guard++;
      if (guard > this.order.length + 2) break;
    }
    const player = this.currentPlayer();
    if (!player) return;
    this.phase = 'draw';
    player.diedThisTurn = [];

    this.runTurnStartTriggers(player);
    this.drawCardInto(player);
    this.phase = 'action';
    this.addLog(`Ход игрока ${player.name} (раунд ${this.round + 1}).`);
  }

  runTurnStartTriggers(player) {
    // яд по игроку
    if (player.playerPoison && player.playerPoison.turnsLeft > 0) {
      this.damagePlayer(player, player.playerPoison.dmg, 'яд');
      player.playerPoison.turnsLeft--;
      if (player.playerPoison.turnsLeft <= 0) player.playerPoison = null;
    }

    for (const card of [...player.table]) {
      if (card.hp <= 0) continue;
      const def = CARDS[card.defId];

      // яд
      if (card.statuses.poison && card.statuses.poison.turnsLeft > 0) {
        this.damageCard(card, card.statuses.poison.dmg, 'яд');
        if (card.hp > 0) {
          card.statuses.poison.turnsLeft--;
          if (card.statuses.poison.turnsLeft <= 0) card.statuses.poison = null;
        }
      }
      if (card.hp <= 0) { this.handleCardDeath(card); continue; }

      // заморозка — снятие и разовый бонус
      if (card.statuses.freeze > 0) {
        card.statuses.freeze--;
        if (card.statuses.freeze === 0) {
          card.hp += 1; card.maxHp += 1; card.atk += 1;
          this.addLog(`${def.name} разморожен(а): +1 ко всем характеристикам.`);
        }
      }
      // оглушение — тикает в начале хода владельца
      if (card.statuses.stun > 0) card.statuses.stun--;
      if (card.statuses.invuln > 0) card.statuses.invuln--;

      // рост (Обычный Данил)
      if (card.defId === 'w_danil' && card.growthCount < 3) {
        card.hp += 1; card.atk += 2; card.growthCount++;
      }

      // Титан лечится
      if (card.defId === 'y_titan') {
        card.hp = Math.min(card.maxHp, card.hp + 1);
      }

      // Король Данилов призывает Дана
      if (card.defId === 'y_king' && card.danCount < 3) {
        const dan = makeCardInstance('tok_dan', player.id);
        player.table.push(dan);
        card.danCount++;
        this.addLog(`Король Данилов призывает Дана.`);
      }

      // Солдат Данил — бонус за выживание 1 ход
      if (card.defId === 'b_soldier' && !card.soldierBonusApplied &&
          card.soldierEnteredRound !== null && card.soldierEnteredRound < this.round) {
        card.hp += 4; card.maxHp += 4; card.soldierBonusApplied = true;
        this.addLog(`Солдат Данил выжил ход: +4 HP.`);
      }
    }
  }

  advanceTurnIndex() {
    this.turnIndex++;
    if (this.turnIndex >= this.order.length) {
      this.turnIndex = 0;
      this.round++;
      this.applyAcceleration();
    }
  }

  applyAcceleration() {
    if (this.round > 0 && this.round % 5 === 0) {
      this.addLog(`⚡ Ускорение! Все игроки теряют 5 HP.`);
      for (const p of this.alivePlayers()) {
        this.damagePlayer(p, 5, 'ускорение', true);
      }
      this.checkEliminations();
    }
  }

  endTurn() {
    const player = this.currentPlayer();
    if (!player) return;
    // Медик лечит все свои карты в конце хода
    const medic = player.table.find((c) => c.defId === 'w_medic' && c.hp > 0);
    if (medic) {
      for (const c of player.table) {
        if (c.hp > 0) this.healCard(c, 1);
      }
      this.addLog(`Медик лечит все ваши карты на 1 HP.`);
    }

    this.checkEliminations();
    if (this.phase === 'ended') return;

    this.advanceTurnIndex();
    if (this.phase === 'ended') return;
    this.beginTurn();
  }

  checkEliminations() {
    for (const p of this.players.values()) {
      if (!p.eliminated && p.hp <= 0) {
        p.eliminated = true;
        p.hp = 0;
        this.addLog(`💀 ${p.name} выбывает из игры!`);
        // карты возвращаются в колоды
        for (const c of p.table) this.returnCardToDeck(c);
        for (const c of p.hand) this.returnCardToDeck(c);
        p.table = [];
        p.hand = [];
      }
    }
    const alive = this.alivePlayers();
    if (alive.length <= 1 && this.players.size > 1) {
      this.phase = 'ended';
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      this.addLog(alive.length === 1 ? `🏆 ${alive[0].name} побеждает!` : 'Игра окончена вничью.');
    }
  }

  returnCardToDeck(card) {
    const def = CARDS[card.defId];
    if (def.token) return; // токены просто исчезают
    if (def.color === 'yellow') { this.bossDeck.push(card.defId); shuffle(this.bossDeck); }
    else { this.deck.push({ defId: card.defId }); shuffle(this.deck); }
  }

  // ─────────────────────────── DAMAGE / DEATH ───────────────────────────

  damagePlayer(player, amount, sourceLabel, unblockable) {
    if (amount <= 0) return;
    player.hp = Math.max(0, player.hp - amount);
    this.addLog(`${player.name} получает ${amount} урона${sourceLabel ? ' (' + sourceLabel + ')' : ''}. HP: ${player.hp}/${player.maxHp}`);
  }

  healPlayer(player, amount) {
    player.hp = Math.min(player.maxHp, player.hp + amount);
  }

  damageCard(card, amount, sourceLabel, attackerCard) {
    if (amount <= 0) return 0;
    if (card.statuses.invuln > 0) {
      this.addLog(`${CARDS[card.defId].name} неуязвим(а) — урон не проходит.`);
      return 0;
    }
    // Рыбак — разовый полный блок для зелёных карт владельца
    const owner = this.players.get(card.ownerId);
    if (owner && CARDS[card.defId].color === 'green' && !card.statuses.ribakShieldUsed) {
      const ribak = owner.table.find((c) => c.defId === 'w_ribak' && c.hp > 0);
      if (ribak) {
        card.statuses.ribakShieldUsed = true;
        this.addLog(`Рыбак блокирует атаку по ${CARDS[card.defId].name}.`);
        return 0;
      }
    }
    let dmg = amount;
    if (card.statuses.wall) {
      dmg = Math.floor(dmg * 0.5);
    }
    card.hp -= dmg;
    this.addLog(`${CARDS[card.defId].name} получает ${dmg} урона${sourceLabel ? ' (' + sourceLabel + ')' : ''}. HP: ${Math.max(card.hp, 0)}/${card.maxHp}`);

    // Данил с длинной палкой — отражение 50%, не уменьшает исходный урон
    if (card.defId === 'b_stick' && attackerCard) {
      const reflect = Math.floor(dmg * 0.5);
      if (reflect > 0) {
        this.addLog(`Палка отражает ${reflect} урона обратно.`);
        this.damageCard(attackerCard, reflect, 'отражение');
      }
    }

    if (card.hp <= 0) this.handleCardDeath(card);
    return dmg;
  }

  healCard(card, amount) {
    if (card.statuses.poison) return; // яд блокирует лечение
    card.hp = Math.min(card.maxHp, card.hp + amount);
  }

  handleCardDeath(card) {
    if (card._dead) return;
    card._dead = true;
    const owner = this.players.get(card.ownerId);
    const def = CARDS[card.defId];
    this.addLog(`☠️ ${def.name} (${owner ? owner.name : '?'}) погибает.`);

    if (owner) {
      owner.table = owner.table.filter((c) => c.uid !== card.uid);
      owner.diedThisTurn.push({ defId: card.defId, ownerId: card.ownerId });
    }

    // снять Стену со связанных карт, если умер строитель
    if (def.id === 'w_stroitel' && owner) {
      for (const c of owner.table) {
        if (c.statuses.wall && c.statuses.wall.builderUid === card.uid) c.statuses.wall = null;
      }
    }
    // снять стену, привязанную к самой умершей карте
    // (уже удалена со стола, поэтому ничего доп. делать не нужно)

    // Ангел-хранитель — воскрешение с ATK/2
    if (card.statuses.guardianAngel && !card.statuses.guardianAngelUsed && owner) {
      card.statuses.guardianAngelUsed = true;
      const revived = makeCardInstance(card.defId, owner.id);
      revived.atk = Math.floor(card.atk / 2);
      revived.hp = revived.maxHp;
      revived.enteredRound = this.round;
      owner.table.push(revived);
      this.addLog(`👼 Ангел-хранитель возвращает ${def.name} с ATK ${revived.atk}.`);
      // не считаем это "обычной смертью" для чумного доктора/зеркала повторно — но триггеры смерти всё равно применимы ниже
    }

    // Чумной доктор — при смерти снимает негативные эффекты со всех своих карт
    if (def.id === 'b_plague' && owner) {
      this.cleanseAll(owner);
    }

    // Инфицированный — призвать Обычного Данила 3 уровня
    if (def.id === 'y_infected' && owner) {
      const tok = makeCardInstance('tok_danil3', owner.id);
      owner.table.push(tok);
      this.addLog(`Инфицированный призывает Обычного Данила (3 ур.) перед смертью.`);
    }

    if (!def.token && owner) this.discard.push(card.defId);
  }

  cleanseAll(player) {
    for (const c of player.table) {
      c.statuses.poison = null;
      c.statuses.virus = false;
      c.statuses.stun = 0;
      c.statuses.freeze = 0;
    }
    this.addLog(`${player.name}: все негативные эффекты сняты (Чумной доктор).`);
  }

  // ─────────────────────────── EFFECTIVE STATS ───────────────────────────

  effectiveAtk(card) {
    if (card.hp <= 0) return 0;
    if (card.defId === 'b_maso') {
      return Math.max(1, Math.min(card.maxHp - card.hp, 4));
    }
    let atk = card.atk;
    if (card.statuses.virus) atk = Math.max(0, atk - 2);
    const owner = this.players.get(card.ownerId);
    if (owner && card.defId !== 'y_ratatouy') {
      const rat = owner.table.find((c) => c.defId === 'y_ratatouy' && c.hp > 0);
      if (rat) atk += 1;
    }
    if (card.defId === 'y_ratatouy') {
      atk = card.attackCount < 2 ? 9 : 7;
    }
    return Math.max(0, atk);
  }

  cardPriority(card) {
    const def = CARDS[card.defId];
    return def.priority || null;
  }

  // ─────────────────────────── TARGETING ───────────────────────────

  getValidTargets(attackerCard, defenderPlayer) {
    const isSniperAttacker = false; // текущий набор карт не содержит Снайпера (DLC)
    const alive = defenderPlayer.table.filter((c) => c.hp > 0 && c.statuses.invuln <= 0);
    if (alive.length === 0) {
      return { mode: 'player' };
    }
    if (isSniperAttacker) return { mode: 'card', options: alive };

    const nonEvasive = alive.filter((c) => !CARDS[c.defId].evasive);
    const basis = nonEvasive.length > 0 ? nonEvasive : alive;

    for (const p of [3, 2, 1]) {
      const subset = basis.filter((c) => this.cardPriority(c) === p);
      if (subset.length > 0) return { mode: 'card', options: subset };
    }
    return { mode: 'card', options: basis };
  }

  // ─────────────────────────── ACTIONS ───────────────────────────

  playCard(player, { cardUid, purpleUid, mainTargets, purpleTargets }) {
    if (this.phase !== 'action') return { error: 'Сейчас не фаза действия.' };
    if (this.currentPlayer().id !== player.id) return { error: 'Сейчас не ваш ход.' };
    if (!cardUid && !purpleUid) return { error: 'Не выбрана карта.' };

    let mainCard = null;
    if (cardUid) {
      const idx = player.hand.findIndex((c) => c.uid === cardUid);
      if (idx === -1) return { error: 'Карта не найдена в руке.' };
      mainCard = player.hand[idx];
      if (CARDS[mainCard.defId].color === 'purple') {
        return { error: 'Основная карта не может быть фиолетовой (используйте поле purpleUid).' };
      }
      player.hand.splice(idx, 1);
    }
    let purpleCard = null;
    if (purpleUid) {
      const idx = player.hand.findIndex((c) => c.uid === purpleUid);
      if (idx === -1) return { error: 'Фиолетовая карта не найдена в руке.' };
      purpleCard = player.hand[idx];
      if (CARDS[purpleCard.defId].color !== 'purple') return { error: 'Это не фиолетовая карта.' };
      player.hand.splice(idx, 1);
    }

    if (mainCard) this.resolvePlayMainCard(player, mainCard, mainTargets || {});
    if (purpleCard) this.resolvePurple(player, purpleCard, purpleTargets || {});

    this.phase = 'attack';
    return { ok: true };
  }

  resolvePlayMainCard(player, card, targets) {
    // buff "следующая карта" (Флагоносец / Танк)
    if (player.nextPlayBuff.atk) { card.atk += player.nextPlayBuff.atk; player.nextPlayBuff.atk = 0; }
    if (player.nextPlayBuff.hp) { card.hp += player.nextPlayBuff.hp; card.maxHp += player.nextPlayBuff.hp; player.nextPlayBuff.hp = 0; }

    card.enteredRound = this.round;
    if (card.defId === 'b_soldier') card.soldierEnteredRound = this.round;
    player.table.push(card);
    this.addLog(`${player.name} выкладывает ${CARDS[card.defId].name}.`);

    this.runOnPlay(player, card, targets);
  }

  findOpponent(player, opponentId) {
    const p = this.players.get(opponentId);
    if (!p || p.id === player.id || p.eliminated) return null;
    return p;
  }

  runOnPlay(player, card, targets) {
    const def = CARDS[card.defId];
    switch (card.defId) {
      case 'w_boleyushiy': {
        const t = this.resolveCardTarget(targets);
        if (t) { t.statuses.virus = true; this.addLog(`Вирус на ${CARDS[t.defId].name}.`); }
        break;
      }
      case 'w_stroitel': {
        const t = targets.wallTargetUid ? [...player.table].find((c) => c.uid === targets.wallTargetUid) : card;
        if (t) { t.statuses.wall = { builderUid: card.uid }; this.addLog(`Стена (50%) на ${CARDS[t.defId].name}.`); }
        break;
      }
      case 'g_assassin': {
        const opp = this.findOpponent(player, targets.opponentId);
        const t = this.resolveCardTarget(targets);
        if (t) t.statuses.poison = { turnsLeft: 2, dmg: 2 };
        if (opp) opp.playerPoison = { turnsLeft: 2, dmg: 2 };
        this.addLog(`Ассасин травит цель и игрока ядом (2/2).`);
        break;
      }
      case 'g_policeman': {
        const t = this.resolveCardTarget(targets);
        if (t) {
          const owner = this.players.get(t.ownerId);
          owner.table = owner.table.filter((c) => c.uid !== t.uid);
          owner.hand.push(t);
          this.addLog(`${CARDS[t.defId].name} возвращается в руку ${owner.name}.`);
        }
        break;
      }
      case 'g_antimiting': {
        const opp = this.findOpponent(player, targets.opponentId);
        if (opp && opp.table.length > 3) {
          const uids = (targets.cardUids || []).slice(0, 2);
          for (const uid of uids) {
            const t = opp.table.find((c) => c.uid === uid);
            if (t) { opp.table = opp.table.filter((c) => c.uid !== uid); opp.hand.push(t); }
          }
          this.addLog(`Антимитинг возвращает карты сопернику в руку.`);
        }
        break;
      }
      case 'g_homyak': {
        const uids = (targets.cardUids || []).slice(0, 2);
        for (const uid of uids) {
          const owner = [...this.players.values()].find((p) => p.table.some((c) => c.uid === uid));
          const t = owner && owner.table.find((c) => c.uid === uid);
          if (t) { t.statuses.stun = Math.max(t.statuses.stun, 1); }
        }
        this.addLog(`Хомяк оглушает 2 карты.`);
        break;
      }
      case 'g_flagonosec': {
        player.nextPlayBuff.atk += 2;
        this.addLog(`Следующая карта получит +2 ATK.`);
        break;
      }
      case 'b_tank': {
        player.nextPlayBuff.hp += 3;
        this.addLog(`Следующая карта получит +3 HP.`);
        break;
      }
      case 'b_plague': {
        this.cleanseAll(player);
        break;
      }
      case 'b_danilolog': {
        const opp = this.findOpponent(player, targets.opponentId);
        if (opp && opp.hand.length > 0) {
          const n = Math.min(2, opp.hand.length);
          const shuffled = shuffle([...opp.hand]).slice(0, n);
          const hasWhite = shuffled.some((c) => CARDS[c.defId].color === 'white');
          if (hasWhite) { card.atk += 2; this.addLog(`Данилоолог находит белую карту: +2 ATK.`); }
          else this.addLog(`Данилоолог не находит белых карт.`);
        }
        break;
      }
      case 'y_king': {
        const dan = makeCardInstance('tok_dan', player.id);
        player.table.push(dan);
        card.danCount = 1;
        this.addLog(`Король Данилов призывает первого Дана.`);
        break;
      }
      case 'y_infected': {
        for (const p of this.players.values()) {
          if (p.id === player.id || p.eliminated) continue;
          for (const c of p.table) c.statuses.virus = true;
        }
        this.addLog(`Инфицированный заражает вирусом все вражеские карты.`);
        break;
      }
      default:
        break;
    }
  }

  resolveCardTarget(targets) {
    if (!targets || !targets.cardUid) return null;
    for (const p of this.players.values()) {
      const t = p.table.find((c) => c.uid === targets.cardUid);
      if (t) return t;
    }
    return null;
  }

  activateJudge(player) {
    if (this.phase !== 'action') return { error: 'Сейчас не фаза действия.' };
    if (this.currentPlayer().id !== player.id) return { error: 'Не ваш ход.' };
    const judge = player.table.find((c) => c.defId === 'w_sudya' && c.hp > 0);
    if (!judge) return { error: 'У вас нет Судьи на столе.' };
    if (judge._judgeUsed) return { error: 'Судья уже использовал способность.' };
    if (player.purpleDiscard.length === 0) return { error: 'В вашем сбросе нет сыгранных фиолетовых карт.' };
    const defId = player.purpleDiscard.pop();
    const card = makeCardInstance(defId, player.id);
    player.hand.push(card);
    judge._judgeUsed = true;
    this.addLog(`Судья возвращает ${CARDS[defId].name} из сброса в руку.`);
    this.phase = 'attack';
    return { ok: true };
  }

  passAction(player) {
    if (this.phase !== 'action') return { error: 'Сейчас не фаза действия.' };
    if (this.currentPlayer().id !== player.id) return { error: 'Не ваш ход.' };
    this.phase = 'attack';
    this.addLog(`${player.name} пропускает фазу действия.`);
    return { ok: true };
  }

  resolvePurple(player, card, targets) {
    player.purpleDiscard.push(card.defId);
    switch (card.defId) {
      case 'p_yad': {
        const uids = (targets.cardUids || []).slice(0, 2);
        for (const uid of uids) {
          const t = this.findAnyCard(uid);
          if (t) t.statuses.poison = { turnsLeft: 2, dmg: 2 };
        }
        this.addLog(`Яд наложен на 2 карты.`);
        break;
      }
      case 'p_kolotushka': {
        const opp = this.findOpponent(player, targets.opponentId);
        const t = opp && opp.table.find((c) => c.uid === targets.cardUid &&
          (CARDS[c.defId].color === 'white' || CARDS[c.defId].color === 'green'));
        if (t) {
          this.damageCard(t, t.hp + 999, 'Колотушка');
          if (opp) for (const c of opp.table) if (c.uid !== t.uid) c.statuses.stun = Math.max(c.statuses.stun, 1);
          this.addLog(`Колотушка уничтожает ${CARDS[t.defId].name}, остальные карты соперника оглушены.`);
        }
        break;
      }
      case 'p_perchatka': {
        const t = this.findAnyCard(targets.cardUid);
        if (t && t.ownerId !== player.id) {
          const def = CARDS[t.defId];
          if (def.color === 'green' || def.color === 'blue') {
            const owner = this.players.get(t.ownerId);
            owner.table = owner.table.filter((c) => c.uid !== t.uid);
            t.ownerId = player.id;
            player.table.push(t);
            this.addLog(`Перчатка забирает ${def.name} себе.`);
          }
        }
        break;
      }
      case 'p_joker': {
        const opp = this.findOpponent(player, targets.opponentId);
        if (opp) {
          const pool = opp.hand.filter((c) => CARDS[c.defId].color !== 'yellow');
          if (pool.length > 0) {
            const stolen = pool[Math.floor(Math.random() * pool.length)];
            opp.hand = opp.hand.filter((c) => c.uid !== stolen.uid);
            stolen.ownerId = player.id;
            player.hand.push(stolen);
            this.addLog(`Джокер крадёт карту из руки ${opp.name}.`);
          }
        }
        break;
      }
      case 'p_zerkalo': {
        const died = player.diedThisTurn.filter((d) => CARDS[d.defId].color === 'white' || CARDS[d.defId].color === 'blue');
        const pick = died.find((d) => d.defId === targets.reviveDefId) || died[0];
        if (pick) {
          const revived = makeCardInstance(pick.defId, player.id);
          revived.hp = Math.floor(revived.maxHp * 0.75);
          revived.enteredRound = this.round;
          player.table.push(revived);
          this.addLog(`Зеркало возвращает ${CARDS[pick.defId].name} с 75% HP.`);
        } else {
          this.addLog(`Зеркало: подходящей погибшей карты в этом ходу нет.`);
        }
        break;
      }
      case 'p_ukol': {
        const t = this.findAnyCard(targets.cardUid);
        if (t) { t.statuses.virus = true; this.addLog(`Укол накладывает вирус.`); }
        break;
      }
      case 'p_angel': {
        const t = player.table.find((c) => c.uid === targets.cardUid);
        if (t) { t.statuses.guardianAngel = true; this.addLog(`Ангел-хранитель защищает ${CARDS[t.defId].name}.`); }
        break;
      }
      case 'p_ukus': {
        const t = this.findAnyCard(targets.cardUid);
        if (t && CARDS[t.defId].color !== 'yellow') {
          this.damageCard(t, 4, 'Укус');
        }
        break;
      }
      default:
        break;
    }
  }

  findAnyCard(uid) {
    if (!uid) return null;
    for (const p of this.players.values()) {
      const t = p.table.find((c) => c.uid === uid);
      if (t) return t;
    }
    return null;
  }

  // ─────────────────────────── ATTACK ───────────────────────────

  attack(player, { attackerUid, defenderId, targetUid }) {
    if (this.phase !== 'attack') return { error: 'Сейчас не фаза атаки.' };
    if (this.currentPlayer().id !== player.id) return { error: 'Не ваш ход.' };
    const defender = this.players.get(defenderId);
    if (!defender || defender.eliminated || defender.id === player.id) return { error: 'Некорректная цель.' };

    let atkValue;
    let attackerCard = null;
    if (attackerUid === 'SELF') {
      if (player.table.some((c) => c.hp > 0)) return { error: 'У вас есть карты на столе — атакуйте картой.' };
      atkValue = 1;
    } else {
      attackerCard = player.table.find((c) => c.uid === attackerUid && c.hp > 0);
      if (!attackerCard) return { error: 'Карта-атакующий не найдена.' };
      if (attackerCard.statuses.stun > 0) return { error: 'Эта карта оглушена.' };
      if (attackerCard.statuses.freeze > 0) return { error: 'Эта карта заморожена.' };
      atkValue = this.effectiveAtk(attackerCard);
      if (atkValue <= 0) return { error: 'У этой карты 0 атаки — она не может атаковать.' };
    }

    const validity = this.getValidTargets(attackerCard, defender);
    if (validity.mode === 'player') {
      this.damagePlayer(defender, atkValue, attackerCard ? CARDS[attackerCard.defId].name : `${player.name} (без карт)`);
    } else {
      const target = validity.options.find((c) => c.uid === targetUid);
      if (!target) return { error: 'Недопустимая цель по правилам приоритета.' };
      this.damageCard(target, atkValue, attackerCard ? CARDS[attackerCard.defId].name : player.name, attackerCard);
    }

    if (attackerCard) {
      attackerCard.attackCount++;
      if (attackerCard.defId === 'g_vampire' && attackerCard.hp > 0) this.healCard(attackerCard, 1);
      if (attackerCard.statuses.virus && attackerCard.hp > 0) {
        // вирус переходит на цель при атаке карты
        const target = this.findAnyCard(targetUid);
        attackerCard.statuses.virus = false;
        if (target && target.hp > 0) target.statuses.virus = true;
      }
    }

    this.checkEliminations();
    if (this.phase === 'ended') return { ok: true };
    this.endTurn();
    return { ok: true };
  }

  skipAttack(player) {
    if (this.phase !== 'attack') return { error: 'Сейчас не фаза атаки.' };
    if (this.currentPlayer().id !== player.id) return { error: 'Не ваш ход.' };
    this.addLog(`${player.name} не атакует в этот ход.`);
    this.checkEliminations();
    if (this.phase === 'ended') return { ok: true };
    this.endTurn();
    return { ok: true };
  }

  // ─────────────────────────── STATE FOR CLIENT ───────────────────────────

  publicCard(card) {
    const def = CARDS[card.defId];
    return {
      uid: card.uid, defId: card.defId, name: def.name, color: def.color,
      hp: card.hp, maxHp: card.maxHp, atk: this.effectiveAtk(card),
      priority: def.priority || null, evasive: !!def.evasive,
      statuses: {
        poison: card.statuses.poison ? { ...card.statuses.poison } : null,
        virus: card.statuses.virus,
        stun: card.statuses.stun,
        freeze: card.statuses.freeze,
        invuln: card.statuses.invuln,
        wall: !!card.statuses.wall,
        guardianAngel: card.statuses.guardianAngel && !card.statuses.guardianAngelUsed,
      },
      text: def.text,
    };
  }

  stateFor(viewerId) {
    const players = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp,
      eliminated: p.eliminated, connected: p.connected,
      handCount: p.hand.length,
      table: p.table.map((c) => this.publicCard(c)),
      isMe: p.id === viewerId,
      hasPendingBossChoice: !!p.bossChoices,
      playerPoison: p.playerPoison,
    }));
    const me = this.players.get(viewerId);
    return {
      type: 'state',
      phase: this.phase,
      round: this.round,
      currentPlayerId: this.order[this.turnIndex] || null,
      players,
      log: this.log.slice(-40),
      winnerId: this.winnerId,
      deckCount: this.deck.length,
      me: me ? {
        id: me.id,
        hand: me.hand.map((c) => this.publicCard(c)),
        bossChoices: me.bossChoices ? {
          a: { defId: me.bossChoices.a, name: CARDS[me.bossChoices.a].name, text: CARDS[me.bossChoices.a].text, hp: CARDS[me.bossChoices.a].hp, atk: CARDS[me.bossChoices.a].atk },
          b: { defId: me.bossChoices.b, name: CARDS[me.bossChoices.b].name, text: CARDS[me.bossChoices.b].text, hp: CARDS[me.bossChoices.b].hp, atk: CARDS[me.bossChoices.b].atk },
        } : null,
        canActivateJudge: this.phase === 'action' && this.order[this.turnIndex] === me.id &&
          me.table.some((c) => c.defId === 'w_sudya' && c.hp > 0 && !c._judgeUsed) &&
          me.purpleDiscard.length > 0,
        revivableThisTurn: me.diedThisTurn
          .filter((d) => CARDS[d.defId].color === 'white' || CARDS[d.defId].color === 'blue')
          .map((d) => ({ defId: d.defId, name: CARDS[d.defId].name })),
      } : null,
    };
  }
}

module.exports = { Game, CARDS };
