/*:
 * @plugindesc THE AXIS — objective line, toasts, and the marsh push-block helper.
 * @author REVUNDA
 * @target MZ
 * @help
 * Everything else in this project is native RPG Maker MZ events, switches,
 * variables and common events, editable in the editor. This plugin adds the one
 * thing events cannot draw: a persistent on-screen meter for AxisStress
 * (variable 1, 0–100).
 *
 *   AxisExt.stress(n)          shift AxisStress by n (clamped 0–100).
 *   AxisExt.stress()           read it. AxisExt.setStress(n) sets it outright.
 *                              AxisHighStress goes ON at 50, OFF at 45.
 *
 *   AxisExt.objective("text")  set the objective line drawn under the map name.
 *                              An empty string clears it.
 *   AxisExt.toast("text")      brief centred notice, fades after ~3 seconds.
 *   AxisExt.push(eventId)      shove the event one tile in the direction the
 *                              player faces, if that tile is passable. Used by
 *                              the East Marsh stone. Call as:
 *                                 AxisExt.push(this._eventId)
 *
 * No other behaviour is hidden here: the endings, transfers, puzzles, tremor
 * and dialogue are all ordinary event commands.
 */

var AxisExt = AxisExt || {};

(function () {
    var STRESS_VAR = 1;                  // AxisStress, 0–100
    var HIGH_SWITCH = "AxisHighStress";
    var HIGH_ON = 50;
    var HIGH_OFF = 45;                   // hysteresis: a value on the line cannot chatter
    var HOLLOW_MAPS = [5, 6, 7, 8, 13, 14];

    var objectiveText = "";
    var toastText = "";
    var toastFrames = 0;
    var shownStress = -1;
    var pulse = 0;

    function stressSwitchId() {
        var i = $dataSystem.switches.indexOf(HIGH_SWITCH);
        return i > 0 ? i : 0;
    }

    function applySwitch(value) {
        var id = stressSwitchId();
        if (!id) return;
        if (value >= HIGH_ON && !$gameSwitches.value(id)) $gameSwitches.setValue(id, true);
        if (value < HIGH_OFF && $gameSwitches.value(id)) $gameSwitches.setValue(id, false);
    }

    function meterColour(v) {
        if (v >= 70) return "#b4653f";        // rust — failing
        if (v >= HIGH_OFF) return "#c8b06a";  // ochre — uneasy
        return "#8aa06a";                     // moss — calm
    }

    function redrawMeter(scene) {
        if (!scene || !scene._axisMeter) return;
        var bitmap = scene._axisMeter.bitmap;
        var v = $gameVariables.value(STRESS_VAR);
        shownStress = v;
        bitmap.clear();
        if (v <= 0) {
            scene._axisMeter.visible = false;
            return;
        }
        scene._axisMeter.visible = true;
        var barX = 44;
        var barW = bitmap.width - barX - 34;
        var barY = 6;
        var barH = 12;

        bitmap.fontSize = 15;
        bitmap.textColor = "#a8a488";
        bitmap.outlineColor = "rgba(0,0,0,0.85)";
        bitmap.outlineWidth = 3;
        bitmap.drawText("AXIS", 0, barY - 3, 42, 20, "left");

        bitmap.fillRect(barX - 1, barY - 1, barW + 2, barH + 2, "rgba(0,0,0,0.72)");
        bitmap.fillRect(barX, barY, barW, barH, "#232b21");
        bitmap.fillRect(barX, barY, Math.round(barW * (v / 100)), barH, meterColour(v));
        for (var s = 1; s < 4; s++) {
            bitmap.fillRect(barX + Math.round(barW * (s / 4)), barY, 1, barH, "rgba(0,0,0,0.55)");
        }
        bitmap.fontSize = 13;
        bitmap.textColor = meterColour(v);
        bitmap.drawText(String(v), barX + barW + 4, barY - 4, 30, 18, "right");
        scene._axisMeter.opacity = pulse > 0 ? 200 + Math.round(55 * (pulse / 30)) : 255;
    }

    function makeTextSprite(size, colour) {
        var sprite = new Sprite(new Bitmap(Graphics.width, size + 16));
        sprite.bitmap.fontSize = size;
        sprite.bitmap.textColor = colour;
        sprite.bitmap.outlineColor = "rgba(0,0,0,0.85)";
        sprite.bitmap.outlineWidth = 4;
        return sprite;
    }

    function redrawObjective(scene) {
        var sprite = scene._axisObjective;
        if (!sprite) return;
        sprite.bitmap.clear();
        if (!objectiveText) return;
        sprite.bitmap.drawText("OBJECTIVE  " + objectiveText, 0, 0, Graphics.width - 40, 32, "left");
    }

    function redrawToast(scene) {
        var sprite = scene._axisToast;
        if (!sprite) return;
        sprite.bitmap.clear();
        if (!toastText || toastFrames <= 0) return;
        sprite.bitmap.drawText(toastText, 0, 0, Graphics.width, 32, "center");
        sprite.opacity = Math.min(255, toastFrames * 6);
    }

    // AxisExt.stress() reads; AxisExt.stress(n) shifts by n and returns the new value.
    AxisExt.stress = function (delta) {
        if (delta === undefined) return $gameVariables.value(STRESS_VAR);
        var next = Math.max(0, Math.min(100, $gameVariables.value(STRESS_VAR) + delta));
        $gameVariables.setValue(STRESS_VAR, next);
        applySwitch(next);
        pulse = 30;
        redrawMeter(SceneManager._scene);
        return next;
    };

    AxisExt.setStress = function (value) {
        var next = Math.max(0, Math.min(100, value | 0));
        $gameVariables.setValue(STRESS_VAR, next);
        applySwitch(next);
        shownStress = -1;
        redrawMeter(SceneManager._scene);
        return next;
    };

    AxisExt.objective = function (text) {
        objectiveText = text || "";
        if (SceneManager._scene instanceof Scene_Map) redrawObjective(SceneManager._scene);
    };

    AxisExt.toast = function (text) {
        toastText = text || "";
        toastFrames = 180;
        if (SceneManager._scene instanceof Scene_Map) redrawToast(SceneManager._scene);
    };

    AxisExt.push = function (eventId) {
        var event = $gameMap.event(eventId);
        var player = $gamePlayer;
        if (!event) return false;
        var d = player.direction();
        var dx = d === 6 ? 1 : d === 4 ? -1 : 0;
        var dy = d === 2 ? 1 : d === 8 ? -1 : 0;
        // the player has to be behind the stone, not beside it
        if (player.x !== event.x - dx || player.y !== event.y - dy) {
            $gameMessage.add("You would have to be behind it to push it.");
            return false;
        }
        var tx = event.x + dx;
        var ty = event.y + dy;
        if (!$gameMap.isPassable(tx, ty, d) || $gameMap.eventIdXy(tx, ty) > 0) {
            $gameMessage.add("It will not move that way.");
            return false;
        }
        event.setPosition(tx, ty);
        event.setDirection(d);
        SoundManager.playCursor();
        return true;
    };

    var _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function () {
        _Scene_Map_createDisplayObjects.call(this);
        this._axisObjective = makeTextSprite(18, "#a8a488");
        this._axisObjective.x = 20;
        this._axisObjective.y = Graphics.height - 96;
        this.addChild(this._axisObjective);
        this._axisMeter = new Sprite(new Bitmap(220, 28));
        this._axisMeter.x = Graphics.width - 232;
        this._axisMeter.y = 10;
        this.addChild(this._axisMeter);

        this._axisToast = makeTextSprite(22, "#e8e4cf");
        this._axisToast.x = 0;
        this._axisToast.y = 44;
        this.addChild(this._axisToast);
        redrawObjective(this);
        redrawToast(this);
        redrawMeter(this);
    };

    // High stress reads on the world in the deep places: a cold darkening that
    // holds for the map. Presentation only — nothing is ever locked out.
    var _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _Scene_Map_onMapLoaded.call(this);
        if (HOLLOW_MAPS.indexOf($gameMap.mapId()) >= 0 &&
            $gameVariables.value(STRESS_VAR) >= HIGH_ON) {
            $gameScreen.startTint([-24, -22, -14, 0], 90);
        }
    };

    var _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _Scene_Map_update.call(this);
        if (toastFrames > 0) {
            toastFrames--;
            redrawToast(this);
        }
        if (pulse > 0) {
            pulse--;
            if (pulse === 0) redrawMeter(this);
        }
        if ($gameVariables.value(STRESS_VAR) !== shownStress) redrawMeter(this);
    };
})();
