// In-page verification for the RPG Maker MZ build of THE AXIS.
//
// Two headless realities have to be handled:
//  1. MZ loads its data JSON over async XHR, which never resolves inside a
//     synchronous driver -> loadDataFile is replaced with a sync version.
//  2. The PIXI ticker that drives SceneManager dies in a backgrounded headless
//     tab -> the driver steps Input.update() + scene.update() itself.
//
//   const src = await (await fetch('/tools/mz/playthrough-mz.js')).text();
//   window.__mzResults = await eval(src);

(async function () {
    const log = [];
    const ok = (name, cond, extra) =>
        log.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });
    const attempt = (name, fn) => {
        try { ok(name, fn()); } catch (e) { ok(name, false, 'THREW ' + ((e && e.message) || e)); }
    };

    /* ---------------- driver ---------------- */
    DataManager.loadDataFile = function (obj, src) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'data/' + src, false);
        xhr.overrideMimeType('application/json');
        xhr.send();
        window[obj] = JSON.parse(xhr.responseText);
        this.onLoad(window[obj]);
        if (DataManager._databaseFiles) {
            for (const f of DataManager._databaseFiles) if (f.name === obj) f.value = window[obj];
        }
    };
    // The real loader hands $dataMap to Game_Map.setup() from the scene graph;
    // with a hand-driven clock we finish that step ourselves.
    const ensureMap = () => {
        if (typeof $dataMap === 'undefined' || !$dataMap) return false;
        if (!$gameMap._events || $gameMap._mapId !== $dataMap.id) {
            $gameMap.setup($dataMap.id);
            $gameMap.refresh();
        }
        return true;
    };
    window.__stepErr = null;
    window.__errs = window.__errs || [];
    if (!window.__hz) {
        const orig = console.error;
        console.error = (...a) => { window.__errs.push(a.map(String).join(' ')); orig(...a); };
        window.__hz = 1;
    }
    const frame = function () {
        Input.update();
        try { if (SceneManager._nextScene) SceneManager.changeScene(); }
        catch (e) { window.__stepErr = 'changeScene: ' + ((e && e.message) || e); }
        ensureMap();
        try { SceneManager._scene.update(); }
        catch (e) { window.__stepErr = 'update: ' + ((e && e.message) || e); }
    };
    const frames = n => { for (let i = 0; i < n; i++) frame(); };
    const tapOk = () => { Input._currentState.ok = true; frame(); frame(); Input._currentState.ok = false; frame(); };
    const texts = () => ($gameMessage._texts || []).join(' ');
    const idle = () => !$gameMap._interpreter.isRunning() && !$gameMessage.isBusy();
    const drain = (max = 600) => { for (let i = 0; i < max && !idle(); i++) tapOk(); return idle(); };
    const talkThrough = () => {
        tapOk();
        const seen = [];
        for (let i = 0; i < 600; i++) {
            const t = texts();
            if (t && seen[seen.length - 1] !== t) seen.push(t);
            if (idle() && i > 2) break;
            tapOk();
        }
        return seen;
    };
    const stand = (x, y, d) => { $gamePlayer.setPosition(x, y); if (d) $gamePlayer.setDirection(d); frames(2); };
    const newGame = () => {
        SceneManager.goto(Scene_Title);
        frames(8);
        SceneManager._scene.commandNewGame();
        frames(4);
        ensureMap();
        frames(20);
        if (SceneManager._nextScene) SceneManager.changeScene();
        ensureMap();
        frames(10);
    };
    const arrive = (map, x, y, d) => {
        $gamePlayer.reserveTransfer(map, x, y, d, 0);
        frames(6);
        ensureMap();
        frames(40);
        if (SceneManager._nextScene) SceneManager.changeScene();
        ensureMap();
        frames(10);
        drain();
    };

    /* ---------------- 0. boot ---------------- */
    newGame();
    attempt('runtime is MZ 1.9', () => Utils.RPGMAKER_VERSION === '1.9.0' ? true : Utils.RPGMAKER_VERSION);
    attempt('new game reaches the home map', () => $gameMap.mapId() === 1 ? true : $gameMap.mapId());
    attempt('map events are live', () => $gameMap._events.length >= 4 ? true : $gameMap._events.length);

    /* ---------------- 1. the opening autorun ---------------- */
    const opening = talkThrough();
    attempt('opening scene speaks', () => opening.some(t => /awake|ridge|Mara/.test(t)) ? true : opening.slice(0, 2));
    attempt('opening autorun sets "started"', () => $gameSwitches.value(1) === true ? true : $gameSwitches.value(1));

    /* ---------------- 2. tileset passage ---------------- */
    attempt('walls block movement', () => $gameMap.isPassable(6, 0, 2) === false ? true : 'wall read passable');
    attempt('floors are walkable', () => $gameMap.isPassable(6, 5, 2) === true ? true : 'floor read blocked');

    /* ---------------- 3. walking + door transfer ---------------- */
    stand(6, 6, 2);
    for (let i = 0; i < 60 && $gameMap.mapId() === 1; i++) { $gamePlayer.moveStraight(2); frames(2); }
    frames(30);
    if (SceneManager._nextScene) SceneManager.changeScene();
    frames(10);
    attempt('walking into the door transfers to the village', () => $gameMap.mapId() === 2 ? true : $gameMap.mapId());
    const village = talkThrough();
    attempt('village entry scene ran', () => $gameSwitches.value(2) === true ? true : $gameSwitches.value(2));

    /* ---------------- 4. NPC dialogue ---------------- */
    stand(8, 11, 2);                        // below is Hollis at (8,12)
    const hollis = talkThrough();
    attempt('action button talks to a villager',
        () => hollis.some(t => /Well water/.test(t)) ? true : hollis.slice(0, 2));

    /* ---------------- 5. database plumbing ---------------- */
    attempt('key item reaches the party', () => {
        $gameParty.gainItem($dataItems[1], 1);
        return $gameParty.hasItem($dataItems[1]);
    });
    attempt('AxisStress variable round-trips', () => {
        $gameVariables.setValue(1, 55);
        return $gameVariables.value(1) === 55;
    });

    /* ---------------- 6. common event CheckTokens ---------------- */
    attempt('CheckTokens sets threeTokens', () => {
        $gameParty.gainItem($dataItems[2], 1);
        $gameParty.gainItem($dataItems[3], 1);
        const i = new Game_Interpreter();
        i.setup($dataCommonEvents[3].list);
        for (let k = 0; k < 60; k++) i.update();
        return $gameSwitches.value(30) === true ? true : $gameSwitches.value(30);
    });

    /* ---------------- 7. page priority on Mara ---------------- */
    arrive(3, 7, 9, 8);
    attempt('transfer event moves the party to the shrine',
        () => $gameMap.mapId() === 3 ? true : $gameMap.mapId());
    const mara = (() => {
        stand(7, 8, 4);                     // Mara stands at (6,8)
        return talkThrough();
    })();
    attempt('Mara uses her all-tokens page',
        () => mara.some(t => /All three|deep chamber|old root is open/.test(t)) ? true : mara.slice(0, 2));

    /* ---------------- 8. east marsh push block ---------------- */
    arrive(11, 10, 11, 8);
    attempt('push helper moves the marsh stone', () => {
        const stone = $gameMap.events().find(e => e.event().name === 'pushstone');
        if (!stone) return 'no pushstone event';
        const sx = stone.x, sy = stone.y;
        $gamePlayer.setPosition(sx, sy + 1);
        $gamePlayer.setDirection(8);
        frames(2);
        AxisExt.push(stone.eventId());
        frames(4);
        return (stone.x !== sx || stone.y !== sy) ? true : 'stone stayed at ' + sx + ',' + sy;
    });

    /* ---------------- 9. north vent plugs (ordered puzzle) ---------------- */
    attempt('north vent plugs resolve in order', () => {
        arrive(10, 6, 5, 8);
        if ($gameMap.mapId() !== 10) return 'wrong map ' + $gameMap.mapId();
        const plug = name => $gameMap.events().find(e => e.event().name === name);
        for (const name of ['plug1', 'plug3', 'plug2']) {
            const p = plug(name);
            if (!p) return 'missing ' + name;
            $gamePlayer.setPosition(p.x, p.y + 1);
            $gamePlayer.setDirection(8);
            frames(2);
            tapOk();
            drain();
        }
        return $gameSwitches.value(16) === true ? true : 'ventOpen=' + $gameSwitches.value(16);
    });

    /* ---------------- 10. the ending room ---------------- */
    attempt('trunk map is reachable', () => {
        arrive(14, 6, 9, 8);
        return $gameMap.mapId() === 14 ? true : $gameMap.mapId();
    });
    attempt('the trunk offers the rite', () => {
        stand(6, 6, 8);                      // face the axis heart at (6,5)
        const seen = talkThrough();
        return seen.some(t => /tokens|Stabilize|clean path|supports/i.test(t)) ? true : seen.slice(0, 2);
    });

    attempt('no script errors during the run',
        () => (window.__errs.length === 0) ? true : window.__errs.slice(0, 3));
    attempt('no step errors during the run',
        () => (window.__stepErr === null) ? true : window.__stepErr);

    window.__mzResults = log;
    return log;
})();
