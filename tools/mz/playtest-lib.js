// THE AXIS — resumable in-engine playtest harness.
//
// MZ's rAF loop is throttled in a background tab, so frames are pumped by hand.
// BUT anything that loads an image (battle scenes, pictures) needs real wall
// time between pumps, so this file only installs the harness; the parent process
// drives it stage by stage with real sleeps in between.
//
//   __A.pump(60)            advance frames through MZ's own updateMain
//   __A.ok()                press OK for a couple of frames
//   __A.drain(200)          clear messages/choices (optionally __A.drain(200, 1))
//   __A.enter(13, 6, 6, 2)  transfer and wait for the map
//   __A.talk('mara')        stand below the named event, face it, press OK
//   __A.results             accumulated {pass,name,extra}
//   __A.text                every message line the player was shown
//   __A.score()             JSON summary

window.__A = (function () {
    const results = [];
    const text = [];

    const sceneName = () => (SceneManager._scene ? SceneManager._scene.constructor.name : 'none');

    // synchronous data loading so a map transfer completes inside a pump
    DataManager.loadDataFile = function (name, src) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'data/' + src, false);
        xhr.overrideMimeType('application/json');
        xhr.send(null);
        if (xhr.status < 400) {
            window[name] = JSON.parse(xhr.responseText);
            DataManager.onLoad(window[name]);
        } else {
            window[name] = null;
        }
    };

    SceneManager.isGameActive = function () { return true; };

    function pump(n) {
        for (let i = 0; i < (n || 1); i++) SceneManager.updateMain();
        return sceneName();
    }
    function ok() {
        Input._currentState.ok = true;
        pump(2);
        Input._currentState.ok = false;
        pump(2);
    }
    function cancel() {
        Input._currentState.cancel = true;
        pump(2);
        Input._currentState.cancel = false;
        pump(2);
    }
    function choiceWindow() {
        const s = SceneManager._scene;
        return s && s._choiceWindow && s._choiceWindow.active ? s._choiceWindow : null;
    }
    function busy() {
        return $gameMessage.isBusy() || ($gameMap._interpreter && $gameMap._interpreter.isRunning());
    }
    function choose(index, maxFrames) {
        for (let i = 0; i < (maxFrames || 60); i++) {
            const w = choiceWindow();
            if (w && w.isOpenAndActive()) {
                w.select(index);
                pump(2);
                ok();
                return true;
            }
            ok();
        }
        return false;
    }
    function drain(max, pick) {
        for (let i = 0; i < (max || 200); i++) {
            if (!busy()) return true;
            const w = choiceWindow();
            if (w && w.isOpenAndActive()) { choose(pick === undefined ? 0 : pick); continue; }
            ok();
        }
        return !busy();
    }
    function enter(id, x, y, dir) {
        $gamePlayer.reserveTransfer(id, x, y, dir || 2, 0);
        for (let i = 0; i < 600; i++) {
            pump(1);
            if ($gameMap.mapId() === id && !$gamePlayer.isTransferring()) break;
        }
        return $gameMap.mapId() === id;
    }
    function eventNamed(name) {
        return $gameMap.events().find(e => e && e.event().name === name) || null;
    }
    function talk(name, fromDx, fromDy, dir) {
        const ev = eventNamed(name);
        if (!ev) return false;
        $gamePlayer.setPosition(ev.x + (fromDx || 0), ev.y + (fromDy === undefined ? 1 : fromDy));
        $gamePlayer.setDirection(dir === undefined ? 8 : dir);
        pump(3);
        $gamePlayer.checkEventTriggerThere([0, 1, 2]);
        pump(6);
        return true;
    }
    function sw(name) { return $gameSwitches.value($dataSystem.switches.indexOf(name)); }
    function setSw(name, v) { $gameSwitches.setValue($dataSystem.switches.indexOf(name), v); }
    function ok1(name, cond, extra) {
        results.push({ pass: !!cond, name, extra: extra === undefined ? '' : String(extra) });
    }

    // every message line that actually reaches the player
    const _add = Game_Message.prototype.add;
    Game_Message.prototype.add = function (t) {
        text.push(String(t));
        return _add.call(this, t);
    };

    return {
        pump, ok, cancel, choose, drain, enter, talk, sw, setSw, ok: ok, okBtn: ok,
        eventNamed, sceneName, busy, results, text, ok1,
        score: () => JSON.stringify(results),
        reset: () => { results.length = 0; text.length = 0; }
    };
})();
