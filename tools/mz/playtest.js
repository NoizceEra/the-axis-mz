// THE AXIS — in-engine playtest of the deepened systems.
//
// Loaded into the running game page (headless Chromium) and driven with a hand
// clock: MZ's own rAF loop is throttled in a background tab, so every frame here
// is pumped explicitly. Data loading is switched to synchronous XHR so a map
// transfer completes inside the pump instead of racing it.
//
// Returns a JSON result list. Nothing here is asserted by the harness — the
// parent process reads the results and decides.

window.__axisPlaytest = (function () {
    const results = [];
    const seenText = [];

    const ok = (name, cond, extra) => results.push({
        pass: !!cond, name, extra: extra === undefined ? '' : String(extra)
    });
    const sceneName = () => (SceneManager._scene ? SceneManager._scene.constructor.name : 'none');

    // ---- synchronous data loading ----
    DataManager.loadDataFile = function (name, src) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', src + '.json', false);
        xhr.overrideMimeType('application/json');
        xhr.send(null);
        window[name] = xhr.status < 400 ? JSON.parse(xhr.responseText) : null;
    };

    // ---- hand clock ----
    // Route frames through MZ's own updateMain so scene start/readiness gating
    // (isStarted / isReady / map-loaded) is honoured. Bypassing it is how you end
    // up updating a Scene_Map whose $dataMap is still null.
    SceneManager.isGameActive = function () { return true; };
    function pump(n) {
        for (let i = 0; i < (n || 1); i++) SceneManager.updateMain();
        return sceneName();
    }
    function okBtn() {
        Input._currentState.ok = true;
        pump(2);
        Input._currentState.ok = false;
        pump(2);
    }
    function choiceWindow() {
        const s = SceneManager._scene;
        return s && s._choiceWindow && s._choiceWindow.active ? s._choiceWindow : null;
    }
    function choose(index, maxFrames) {
        for (let i = 0; i < (maxFrames || 40); i++) {
            const w = choiceWindow();
            if (w && w.isOpenAndActive()) {
                w.select(index);
                pump(2);
                okBtn();
                return true;
            }
            okBtn();
        }
        return false;
    }
    function busy() {
        return $gameMessage.isBusy() ||
            ($gameMap._interpreter && $gameMap._interpreter.isRunning());
    }
    function drain(max, pick) {
        for (let i = 0; i < (max || 200); i++) {
            if (!busy()) return true;
            const w = choiceWindow();
            if (w && w.isOpenAndActive()) { choose(pick === undefined ? 0 : pick); continue; }
            okBtn();
        }
        return !busy();
    }

    // ---- text log: every message line that actually reaches the player ----
    const _add = Game_Message.prototype.add;
    Game_Message.prototype.add = function (text) {
        seenText.push(String(text));
        return _add.call(this, text);
    };

    function enterMap(id, x, y, dir) {
        $gamePlayer.reserveTransfer(id, x, y, dir || 2, 0);
        for (let i = 0; i < 400; i++) {
            pump(1);
            if ($gameMap.mapId() === id && !$gamePlayer.isTransferring() && !busy()) break;
        }
        return $gameMap.mapId() === id;
    }
    function eventNamed(name) {
        return $gameMap.events().find(e => e && e.event().name === name) || null;
    }
    function interact(name) {
        const ev = eventNamed(name);
        if (!ev) return false;
        $gamePlayer.setPosition(ev.x, ev.y + 1);
        $gamePlayer.setDirection(8);
        pump(2);
        $gamePlayer.checkEventTriggerThere([0, 1, 2]);
        pump(6);
        return true;
    }
    function sw(name) {
        const id = $dataSystem.switches.indexOf(name);
        return $gameSwitches.value(id);
    }
    function setSw(name, v) {
        $gameSwitches.setValue($dataSystem.switches.indexOf(name), v);
    }

    // ================= 0. boot =================
    for (let i = 0; i < 900; i++) {
        pump(1);
        if (sceneName() === 'Scene_Title') break;
    }
    ok('boots to the title screen', sceneName() === 'Scene_Title', sceneName());
    ok('title is THE AXIS', $dataSystem.gameTitle.indexOf('AXIS') >= 0, $dataSystem.gameTitle);

    SceneManager._scene.commandNewGame();
    pump(120);
    drain(60);
    ok('new game starts in Ashhollow\'s home', $gameMap.mapId() === 1, 'map ' + $gameMap.mapId());

    // ================= 1. the stress meter =================
    AxisExt.setStress(0);
    pump(3);
    ok('meter hides itself at zero stress',
        SceneManager._scene._axisMeter && SceneManager._scene._axisMeter.visible === false);

    const raised = AxisExt.stress(55);
    pump(3);
    const meter = SceneManager._scene._axisMeter;
    const bitmap = meter && meter.bitmap;
    let ink = 0;
    if (bitmap) {
        const d = bitmap.context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        for (let p = 3; p < d.length; p += 4) if (d[p] > 0) ink++;
    }
    ok('stress() writes the AxisStress variable', raised === 55 && $gameVariables.value(1) === 55, raised);
    ok('meter becomes visible above zero', meter && meter.visible === true);
    ok('meter actually draws pixels', ink > 400, ink + ' opaque px');
    ok('AxisHighStress switches on at 50', sw('AxisHighStress') === true);

    AxisExt.stress(-10);                       // 45 — inside the hysteresis band
    pump(2);
    ok('AxisHighStress holds at 45 (hysteresis)', sw('AxisHighStress') === true, $gameVariables.value(1));
    AxisExt.stress(-10);                       // 35
    pump(2);
    ok('AxisHighStress clears below 45', sw('AxisHighStress') === false, $gameVariables.value(1));

    AxisExt.stress(200);
    ok('stress clamps at 100', $gameVariables.value(1) === 100, $gameVariables.value(1));
    AxisExt.stress(-500);
    ok('stress clamps at 0', $gameVariables.value(1) === 0, $gameVariables.value(1));

    // ================= 2. real stress sources =================
    AxisExt.setStress(10);
    ok('enter the first hollow', enterMap(5, 6, 9, 8), 'map ' + $gameMap.mapId());
    interact('sap1');
    drain(120);
    ok('a hollow warning raises AxisStress', $gameVariables.value(1) > 10,
        '10 -> ' + $gameVariables.value(1));

    // ================= 3. optional combat, and losing it =================
    AxisExt.setStress(20);
    $gameParty.members().forEach(a => { a.setHp(a.mhp); a.setMp(a.mmp); });
    interact('hollowgrowth');
    drain(40);
    pump(30);
    ok('the optional creature starts a real battle', sceneName() === 'Scene_Battle', sceneName());
    ok('it is the Hollow Growth troop', $gameTroop.troop().name === 'Hollow Growth', $gameTroop.troop().name);
    ok('the fight can be escaped', BattleManager.canEscape() === true);
    ok('the fight can be lost without a game over', BattleManager.canLose() === true);

    const stressBeforeLoss = $gameVariables.value(1);
    $gameParty.members().forEach(a => a.setHp(0));      // wipe on purpose
    pump(400);
    drain(80);
    ok('losing returns you to the map, not the game over screen',
        sceneName() === 'Scene_Map' && $gameMap.mapId() === 5, sceneName());
    ok('losing costs stress instead of the run', $gameVariables.value(1) > stressBeforeLoss,
        stressBeforeLoss + ' -> ' + $gameVariables.value(1));
    ok('the encounter does not repeat (self switch A)', (() => {
        const ev = eventNamed('hollowgrowth');
        return ev ? $gameSelfSwitches.value([5, ev.eventId(), 'A']) === true : false;
    })());

    // ================= 4. high stress reads on the world =================
    AxisExt.setStress(80);
    enterMap(1, 6, 5, 2);
    enterMap(5, 6, 9, 8);
    pump(120);
    const tone = $gameScreen.tone();
    ok('high stress darkens the hollow', tone[0] < 0 || tone[1] < 0 || tone[3] > 0, JSON.stringify(tone));

    // ================= 5. the village reacts =================
    AxisExt.setStress(30);
    enterMap(2, 8, 12, 2);
    const v1 = eventNamed('v1');
    const pageEarly = v1 ? v1.page() : null;
    seenText.length = 0;
    interact('v1');
    drain(60);
    const lineEarly = seenText.join(' ');
    setSw('firstHollow', true);
    pump(6);
    const pageLate = v1 ? v1.page() : null;
    seenText.length = 0;
    interact('v1');
    drain(60);
    const lineLate = seenText.join(' ');
    ok('villager has more than one page', v1 && v1.event().pages.length > 1, v1 ? v1.event().pages.length : 0);
    ok('villager changes what they say after the hollow', lineEarly !== lineLate && !!lineLate,
        JSON.stringify({ before: lineEarly.slice(0, 48), after: lineLate.slice(0, 48) }));

    // ================= 6. save / load round trip =================
    const stressSaved = $gameVariables.value(1);
    $gameParty.gainItem($dataItems[1], 1);
    DataManager.saveGame(1);
    const savedMap = $gameMap.mapId();
    AxisExt.setStress(0);
    $gameParty.loseItem($dataItems[1], 1);
    DataManager.loadGame(1);
    SceneManager.goto(Scene_Map);
    pump(90);
    drain(60);
    ok('save and load restores the map', $gameMap.mapId() === savedMap, $gameMap.mapId() + ' vs ' + savedMap);
    ok('save and load restores AxisStress', $gameVariables.value(1) === stressSaved,
        $gameVariables.value(1) + ' vs ' + stressSaved);
    ok('save and load restores the token', $gameParty.numItems($dataItems[1]) === 1,
        $gameParty.numItems($dataItems[1]));

    // ================= 7. the ending at high stress =================
    setSw('firstHollow', true);
    setSw('caretakerMet', true);
    setSw('northToken', true);
    setSw('eastToken', true);
    setSw('westToken', true);
    setSw('threeTokens', true);
    ['northToken', 'eastToken', 'westToken'].forEach(() => {});
    [1, 2, 3].forEach(id => { if ($gameParty.numItems($dataItems[id]) < 1) $gameParty.gainItem($dataItems[id], 1); });
    AxisExt.setStress(75);
    ok('reach the trunk', enterMap(14, 6, 6, 2), 'map ' + $gameMap.mapId());
    seenText.length = 0;
    interact('axisheart');
    const chose = choose(0, 80);              // "Use the three tokens. Stabilize it."
    drain(400);
    const endingText = seenText.join('\n');
    ok('the stabilize ending runs', chose && endingText.length > 200, endingText.length + ' chars');
    ok('the ending sets its switches',
        sw('FinalChoiceStabilize') === true && sw('finalChoice') === true);
    ok('high stress adds its paragraph to the ending',
        endingText.indexOf('still shaking an hour later') >= 0,
        endingText.indexOf('still shaking') >= 0 ? 'found' : 'not found');
    ok('the ending returns to the title', sceneName() === 'Scene_Title' || sceneName() === 'Scene_Gameover',
        sceneName());

    return JSON.stringify(results);
})();
